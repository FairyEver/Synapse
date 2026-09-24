import { randomUUID } from "node:crypto"
import type { SynapseAppUpdateState } from "../../../src/types/update"
import type { DispatchContext } from "../../../synapse-capabilities/shared/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"

const RESTART_GRACE_MS = 3_000
const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1_000
const PROCESS_BOOT_ID = randomUUID()
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1_000).toISOString()

type RemoteOperation = {
  readonly id: string
  readonly kind: "update" | "restart"
  phase: "scheduled" | "checking" | "downloading" | "installing" | "restarting" | "failed" | "completed"
  error: string | null
}

type UpdateBackend = {
  getState(): SynapseAppUpdateState
  checkForUpdates(options?: { refreshAvailable?: boolean }): Promise<SynapseAppUpdateState>
  downloadUpdate(): Promise<SynapseAppUpdateState>
  installUpdate(): Promise<void>
  subscribeState(listener: (state: SynapseAppUpdateState) => void): () => void
}

type Logger = {
  error(message: string, error: unknown): void
}

export class DesktopControlService {
  private operation: RemoteOperation | null = null
  private operationContext: DispatchContext | null = null
  private restart: (() => void) | null = null

  constructor(private readonly deps: {
    readonly update: UpdateBackend
    readonly permissionGuard: PermissionGuard
    readonly auditSink: AuditSink
    readonly logger: Logger
    readonly isUpdateReady?: () => boolean
    readonly schedule?: (callback: () => void, delay: number) => unknown
  }) {}

  setRestartHandler(handler: () => void): void {
    this.restart = handler
  }

  getState() {
    return {
      ...this.deps.update.getState(),
      bootId: PROCESS_BOOT_ID,
      startedAt: PROCESS_STARTED_AT,
      remoteOperation: this.operation ? { ...this.operation } : null,
    }
  }

  async check(context: DispatchContext) {
    this.requireUpdateReady()
    await this.authorize("network.connect", "update-check", context)
    if (this.hasActiveOperation()) return this.getState()
    this.record("network.connect", "update-check", "allowed", context)
    await this.deps.update.checkForUpdates({ refreshAvailable: true })
    return this.getState()
  }

  async runUpdate(context: DispatchContext) {
    this.requireUpdateReady()
    await this.authorize("network.connect", "update-run", context)
    await this.authorize("shell.exec", "update-run", context)
    if (this.hasActiveOperation()) return this.admission("update")

    const state = this.deps.update.getState()
    if (state.status === "unsupported") throw new Error(state.message)
    if (state.installRecovery?.phase === "manual-required") throw new Error(state.message)
    this.operation = { id: randomUUID(), kind: "update", phase: "scheduled", error: null }
    this.operationContext = context
    this.schedule(() => { void this.executeUpdate() }, RESTART_GRACE_MS)
    this.record("network.connect", "update-run", "allowed", context)
    this.record("shell.exec", "update-run", "allowed", context)
    return this.admission("update")
  }

  async restartDesktop(context: DispatchContext) {
    await this.authorize("shell.exec", "desktop-restart", context)
    if (this.hasActiveOperation()) return this.admission("restart")
    if (!this.restart) throw new Error("桌面端重启服务尚未就绪。")
    this.operation = { id: randomUUID(), kind: "restart", phase: "scheduled", error: null }
    this.operationContext = context
    this.schedule(() => {
      if (!this.operation || this.operation.kind !== "restart") return
      this.operation.phase = "restarting"
      try {
        this.restart?.()
      } catch (error) {
        this.fail(error)
      }
    }, RESTART_GRACE_MS)
    this.record("shell.exec", "desktop-restart", "allowed", context)
    return this.admission("restart")
  }

  private admission(kind: RemoteOperation["kind"]) {
    const operation = this.operation
    if (!operation) throw new Error("远程操作状态不可用。")
    if (operation.kind !== kind) throw new Error("另一项桌面更新或重启操作正在进行。")
    return { accepted: true as const, operationId: operation.id, phase: operation.phase }
  }

  private hasActiveOperation(): boolean {
    return this.operation !== null
      && this.operation.phase !== "failed"
      && this.operation.phase !== "completed"
  }

  private async executeUpdate(): Promise<void> {
    try {
      let state = this.deps.update.getState()
      if (state.status !== "downloaded" && state.status !== "downloading") {
        if (state.status !== "available") {
          this.setPhase("checking")
          state = await this.deps.update.checkForUpdates({ refreshAvailable: true })
          if (state.status === "checking") {
            state = await this.waitForState((next) => next.status !== "checking")
          }
        }
        if (state.status === "not-available") {
          this.setPhase("completed")
          return
        }
        if (state.status === "error" || state.status === "unsupported") throw new Error(state.error ?? state.message)
        if (state.status === "available") state = await this.deps.update.downloadUpdate()
      }

      if (state.status === "downloading" || state.status === "checking") {
        this.setPhase("downloading")
        state = await this.waitForState((next) => next.status !== "downloading" && next.status !== "checking")
      }
      if (state.status !== "downloaded") throw new Error(state.error ?? state.message)

      this.setPhase("installing")
      await this.deps.update.installUpdate()
      // On success the native updater owns process exit. A surviving process must
      // never report that installation or restart completed.
    } catch (error) {
      this.fail(error)
    }
  }

  private waitForState(done: (state: SynapseAppUpdateState) => boolean): Promise<SynapseAppUpdateState> {
    return new Promise((resolve, reject) => {
      let settled = false
      let unsubscribe: (() => void) | null = null
      const finish = (state: SynapseAppUpdateState | null, error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        unsubscribe?.()
        if (error) reject(error)
        else resolve(state!)
      }
      const timeout = setTimeout(() => finish(null, new Error("等待更新状态超时。")), DOWNLOAD_TIMEOUT_MS)
      unsubscribe = this.deps.update.subscribeState((state) => {
        if (done(state)) finish(state)
      })
      const current = this.deps.update.getState()
      if (done(current)) finish(current)
    })
  }

  private setPhase(phase: RemoteOperation["phase"]): void {
    if (this.operation?.kind === "update") this.operation.phase = phase
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    if (this.operation) {
      this.operation.phase = "failed"
      this.operation.error = message
      if (this.operationContext) {
        this.record("shell.exec", this.operation.kind === "update" ? "update-run" : "desktop-restart", "failed", this.operationContext)
      }
    }
    this.deps.logger.error("Remote desktop operation failed.", error)
  }

  private schedule(callback: () => void, delay: number): void {
    const schedule = this.deps.schedule ?? setTimeout
    schedule(callback, delay)
  }

  private requireUpdateReady(): void {
    if (this.deps.isUpdateReady && !this.deps.isUpdateReady()) {
      throw new Error("桌面更新服务尚未就绪，请稍后重试。")
    }
  }

  private async authorize(action: PermissionAction, resource: string, context: DispatchContext): Promise<void> {
    const actor = context.actor ?? { kind: "user" as const, id: "synapse-mcp" }
    const permission = await this.deps.permissionGuard.check({
      action,
      actor,
      resource,
      context: { source: context.source ?? "mcp", operation: resource },
    })
    if (permission.allowed) return
    this.record(action, resource, "denied", context)
    throw new Error("没有执行桌面更新或重启的权限。")
  }

  private record(action: PermissionAction, resource: string, outcome: "allowed" | "denied" | "failed", context: DispatchContext): void {
    this.deps.auditSink.record({
      action,
      actor: context.actor ?? { kind: "user", id: "synapse-mcp" },
      resource,
      outcome,
      metadata: { source: context.source ?? "mcp" },
    })
  }
}
