/**
 * Phase 0.6 — PermissionGuard + AuditSink.
 * SPEC §15.5.
 *
 * The runtime ships:
 *   - PermissionGuard: "should this action go through?" with pluggable policies
 *   - AuditSink: append-only outcome record (in-memory by default; T0.2's
 *     JsonLines backend is the production target for `audit` namespace)
 *
 * SPEC default policy: user-initiated allowed; extension/agent prompted by
 * default; concrete policy registration is consumer-driven.
 */

export type PermissionAction =
  | "database.read"
  | "database.mutate"
  | "fs.write"
  | "fs.read.outside-userdata"
  | "fs.write.outside-userdata"
  | "shell.exec"
  /**
   * 读取某个 PTY 里进程的当前目录，用来给 OSC 7 没覆盖到的 shell 兜底。
   *
   * 它是**窄动作**而不是又一个 `shell.exec`：请求里只允许出现 tty（或 pid）与固定的
   * `ps` / `lsof` argv，因而不构成 `module-boundaries` 所禁止的通用命令通道。
   */
  | "process.cwd_probe"
  | "network.connect"
  | "network.listen"
  | "extension.load"
  | "agent.spawn"
  | "agent.conversation.read"
  | "agent.conversation.control"
  | "agent.conversation.stop"
  | "agent.conversation.forceStop"
  | "agent.permission.respond"
  | "secret.read"
  | "secret.write"
  | "scheduler.mutate"
  | "automation.read"
  | "automation.mutate"
  | "workflow.run"
  | "workflow.read"
  | "workflow.mutate"
  | "content.read"
  | "content.mutate"
  | "terminal.discover"
  | "terminal.state.read"
  | "terminal.metadata.read"
  | "terminal.output.read"
  | "terminal.command.read"
  | "terminal.command.launch"
  | "terminal.session.create"
  | "terminal.session.override.create"
  | "terminal.session.control"
  | "terminal.session.rawInput"
  | "terminal.session.resize"
  | "terminal.session.stop"
  | "terminal.session.forceStop"
  | "terminal.metadata.manage"
  | "terminal.settings.manage"
  | "terminal.group.manage"
  | "terminal.command.manage"
  | "terminal.session.delete"
  /**
   * 手机让电脑在终端当前目录上跑一次 Git 写操作（切分支、提交、推送、同步、合并）。
   *
   * 单独一个动作而不是借 `fs.write.outside-userdata`：借来的名字会让事后查审计的人
   * 以为当时只是落了一个文件，而实际发生的是「有人从手机上改动了用户的仓库」。
   * 读操作（看状态、列分支）不走这里，用既有的 `terminal.state.read`。
   */
  | "terminal.git.manage"
  | "terminal.group.delete"
  | "terminal.workspace.manage"
  | "terminal.workspace.delete"
  | "notification.trigger"
  | "json.repair"
  | "clipboard.read"
  | "clipboard.write"

export type ActorIdentity =
  | { kind: "user"; id?: string; display?: string }
  | { kind: "extension"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "connector"; id: string }
  | { kind: "system"; id?: string }

export interface PermissionRequest {
  readonly action: PermissionAction
  readonly actor: ActorIdentity
  readonly resource: string
  readonly context: Record<string, unknown>
}

export type PermissionDecision = "allow" | "deny" | "prompt" | "defer-to-next"

export interface PermissionPolicy {
  readonly id: string
  decide(request: PermissionRequest): PermissionDecision | Promise<PermissionDecision>
}

export type PermissionResult =
  | { allowed: true }
  | { allowed: false; reason: string; policyId?: string }

export interface PermissionGuard {
  registerPolicy(policy: PermissionPolicy): () => void
  check(request: PermissionRequest): Promise<PermissionResult>
  onRevoked?(listener: (event: { readonly actorId?: string; readonly resource?: string }) => void): () => void
}

export class PermissionGuardImpl implements PermissionGuard {
  private readonly policies: PermissionPolicy[] = []
  private readonly revocationListeners = new Set<(event: { readonly actorId?: string; readonly resource?: string }) => void>()

  registerPolicy(policy: PermissionPolicy): () => void {
    this.policies.push(policy)
    return () => {
      const idx = this.policies.findIndex((p) => p.id === policy.id)
      if (idx >= 0) {
        this.policies.splice(idx, 1)
        this.notifyRevocation({})
      }
    }
  }

  async check(request: PermissionRequest): Promise<PermissionResult> {
    for (const policy of this.policies) {
      const decision = await Promise.resolve(policy.decide(request))
      switch (decision) {
        case "allow":
          return { allowed: true }
        case "deny":
          return { allowed: false, reason: `denied by ${policy.id}`, policyId: policy.id }
        case "prompt":
          // Phase 0 has no UI integration — treat prompt as allow for user
          // initiator and deny otherwise. M1 wires the actual prompt UI.
          if (request.actor.kind === "user") return { allowed: true }
          return { allowed: false, reason: `prompt required by ${policy.id}`, policyId: policy.id }
        case "defer-to-next":
          continue
        default: {
          const exhaustive: never = decision
          throw new Error(`Unknown decision: ${exhaustive as string}`)
        }
      }
    }
    // No policy decided → default-allow user, default-deny others.
    if (request.actor.kind === "user") return { allowed: true }
    return { allowed: false, reason: "no policy allowed this action and actor is not user" }
  }

  onRevoked(listener: (event: { readonly actorId?: string; readonly resource?: string }) => void): () => void {
    this.revocationListeners.add(listener)
    return () => this.revocationListeners.delete(listener)
  }

  notifyRevocation(event: { readonly actorId?: string; readonly resource?: string }): void {
    for (const listener of this.revocationListeners) listener(event)
  }
}

export function createPermissionGuard(): PermissionGuardImpl {
  return new PermissionGuardImpl()
}

/** The single actor allowed to run the terminal working-directory probe. */
export const TERMINAL_CWD_PROBE_ACTOR_ID = "terminal-cwd-probe"

/** Default policy: user-initiated allowed, others deferred. */
export const userInitiatedAllowPolicy: PermissionPolicy = {
  id: "user-initiated-allow",
  decide: (req) => (req.actor.kind === "user" ? "allow" : "defer-to-next"),
}

/** Allow system actors to execute shells (workflow engine, scheduler, etc.). */
export const systemShellExecPolicy: PermissionPolicy = {
  id: "system-shell-exec-allow",
  decide: (req) =>
    req.actor.kind === "system" && req.action === "shell.exec"
      ? "allow"
      : "defer-to-next",
}

/**
 * Allow the Terminal's own working-directory probe to read a PTY process's cwd.
 *
 * Narrow on purpose: the actor id is fixed and the action is the probe — not
 * `shell.exec`. Widening this to other actors or actions would hand the terminal
 * side a general command channel.
 */
export const systemTerminalCwdProbePolicy: PermissionPolicy = {
  id: "system-terminal-cwd-probe-allow",
  decide: (req) =>
    req.actor.kind === "system"
    && req.actor.id === TERMINAL_CWD_PROBE_ACTOR_ID
    && req.action === "process.cwd_probe"
      ? "allow"
      : "defer-to-next",
}

/** Allow authenticated webhook exec requests to launch shell commands. */
export const webhookShellExecPolicy: PermissionPolicy = {
  id: "webhook-shell-exec-allow",
  decide: (req) =>
    req.actor.kind === "agent"
    && req.actor.id === "webhook"
    && req.action === "shell.exec"
      ? "allow"
      : "defer-to-next",
}

/** Allow system actors to perform automation actions (workflow engine, scheduler). */
export const systemAutomationPolicy: PermissionPolicy = {
  id: "system-automation-allow",
  decide: (req) =>
    req.actor.kind === "system" && (
      req.action === "network.connect"
      || req.action === "agent.spawn"
      || req.action === "workflow.run"
    )
      ? "allow"
      : "defer-to-next",
}

/** Allow Synapse startup to keep editor MCP settings registered. */
export const systemMcpAutoRegisterPolicy: PermissionPolicy = {
  id: "system-mcp-auto-register-allow",
  decide: (req) =>
    req.actor.kind === "system"
      && req.actor.id === "database"
      && req.action === "fs.write"
      && req.context.source === "database.mcp.autoRegister"
      && (req.context.operation === "register" || req.context.operation === "unregister")
      && req.context.settingsPath === req.resource
      ? "allow"
      : "defer-to-next",
}

/** Allow only the built-in runtime-data maintenance worker to prune bounded redundant records. */
export const systemDataMaintenancePolicy: PermissionPolicy = {
  id: "system-data-maintenance-allow",
  decide: (req) =>
    req.actor.kind === "system"
      && req.actor.id === "data-maintenance"
      && req.action === "database.mutate"
      && req.resource === "runtime-data"
      && req.context.source === "core.data-maintenance"
      ? "allow"
      : "defer-to-next",
}

// ----- AuditSink ----------------------------------------------------

export interface AuditEvent {
  readonly id: string
  readonly action: PermissionAction
  readonly actor: ActorIdentity
  readonly resource: string
  readonly outcome: "allowed" | "denied" | "failed"
  readonly timestamp: string
  readonly metadata?: Record<string, unknown>
}

export interface AuditSink {
  record(event: Omit<AuditEvent, "id" | "timestamp"> & { id?: string; timestamp?: string }): void
  list(): readonly AuditEvent[]
  clearForTests(): void
}

export class InMemoryAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = []
  private nextId = 1

  record(event: Omit<AuditEvent, "id" | "timestamp"> & { id?: string; timestamp?: string }): void {
    const id = event.id ?? `audit-${this.nextId++}`
    this.events.push({
      ...event,
      id,
      timestamp: event.timestamp ?? new Date().toISOString(),
    })
  }

  list(): readonly AuditEvent[] {
    return this.events.slice()
  }

  clearForTests(): void {
    this.events.length = 0
  }
}
