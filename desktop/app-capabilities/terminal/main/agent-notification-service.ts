import { randomUUID, timingSafeEqual } from "node:crypto"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type {
  LocalHttpRequest,
  LocalHttpResponse,
  NetworkServiceRegistry,
  ResolvedNetworkBinding,
} from "../../../electron/runtime/network"
import { createLocalNetworkHostLifecycle } from "../../../electron/runtime/network"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { StructuredLogger } from "../../../electron/runtime/service-registry"
import { terminalContractError } from "../shared/errors"
import type {
  TerminalAgentNotificationSettings,
  TerminalUpdateAgentNotificationSettingsInput,
} from "../shared/schema"
import {
  createTerminalAgentUnixShim,
  createTerminalAgentWindowsShim,
  TERMINAL_AGENT_HOOK_RUNTIME,
  TERMINAL_AGENT_WRAPPER_RUNTIME,
} from "./agent-notification-runtime"

export const TERMINAL_AGENT_NOTIFICATION_SERVICE_ID = "core.terminal-agent-notifications"
const NETWORK_SERVICE_ID = "terminal.agent-notifications"
const EVENT_PATH = "/terminal-agent-event"
const MAX_BODY_BYTES = 16 * 1024
const RATE_LIMIT_PER_MINUTE = 120
const DEDUPLICATION_WINDOW_MS = 2_000

type AgentProvider = "codex" | "claude"
type AgentNotificationKind = "needs_action" | "completed"

type SessionBinding = {
  readonly sessionId: string
  readonly token: string
  title: string
  waiting: boolean
}

export type TerminalAgentLaunchIntegration = {
  readonly env: Record<string, string>
  readonly shellArgs?: readonly string[]
}

export type TerminalAgentNotificationHandle = {
  show(): void
  on(event: "click" | "close", listener: () => void): void
}

export type TerminalAgentNotificationServiceDeps = {
  readonly settings: DataNamespace<TerminalAgentNotificationSettings>
  readonly networkRegistry: NetworkServiceRegistry
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly logger: Pick<StructuredLogger, "warn" | "info">
  readonly runtimeDir: string
  readonly nodePath: string
  readonly platform?: NodeJS.Platform
  readonly createNotification: (input: {
    readonly title: string
    readonly body: string
  }) => TerminalAgentNotificationHandle | null
  readonly focusedWebContentsId: () => number | null
  readonly focusApp: () => void
  readonly openTerminalSession: (sessionId: string) => Promise<void>
  readonly now?: () => number
}

export class TerminalAgentNotificationService {
  private readonly platform: NodeJS.Platform
  private readonly now: () => number
  private readonly sessionsByToken = new Map<string, SessionBinding>()
  private readonly sessionTokens = new Map<string, string>()
  private readonly activeSessionByWebContents = new Map<number, string | null>()
  private readonly requestTimesByToken = new Map<string, number[]>()
  private readonly lastNotificationAt = new Map<string, number>()
  private readonly liveNotifications = new Set<TerminalAgentNotificationHandle>()
  private settingsQueue: Promise<void> = Promise.resolve()
  private settings: TerminalAgentNotificationSettings = defaultSettings()
  private binding?: ResolvedNetworkBinding
  private runtime?: RuntimePaths

  constructor(private readonly deps: TerminalAgentNotificationServiceDeps) {
    this.platform = deps.platform ?? process.platform
    this.now = deps.now ?? (() => Date.now())
  }

  async start(): Promise<void> {
    this.settings = await this.deps.settings.getSingleton() ?? defaultSettings()
    if (this.settings.enabled) {
      try {
        await this.enableRuntime()
      } catch (error) {
        this.deps.logger.warn("Terminal agent notifications could not start.", { error })
      }
    }
  }

  async stop(): Promise<void> {
    await this.stopIngress()
    this.sessionsByToken.clear()
    this.sessionTokens.clear()
    this.activeSessionByWebContents.clear()
    this.liveNotifications.clear()
  }

  getSettings(): TerminalAgentNotificationSettings {
    return this.settings
  }

  updateSettings(input: TerminalUpdateAgentNotificationSettingsInput): Promise<TerminalAgentNotificationSettings> {
    const operation = this.settingsQueue.then(
      () => this.applySettingsUpdate(input),
      () => this.applySettingsUpdate(input),
    )
    this.settingsQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async applySettingsUpdate(
    input: TerminalUpdateAgentNotificationSettingsInput,
  ): Promise<TerminalAgentNotificationSettings> {
    if (input.expectedRevision !== this.settings.revision) {
      throw terminalContractError("revision_conflict", "revision", {
        details: { currentRevision: this.settings.revision },
      })
    }
    if (input.enabled === this.settings.enabled) return this.settings
    const previous = this.settings
    const updated = {
      ...this.settings,
      enabled: input.enabled,
      revision: this.settings.revision + 1,
      updatedAt: new Date(this.now()).toISOString(),
    }
    await this.deps.settings.setSingleton(updated)
    try {
      if (input.enabled) await this.enableRuntime()
      else await this.stopIngress()
    } catch (error) {
      await this.deps.settings.setSingleton(previous)
      if (input.enabled) await this.stopIngress()
      throw error
    }
    this.settings = updated
    if (!input.enabled) {
      this.sessionsByToken.clear()
      this.sessionTokens.clear()
    }
    return this.settings
  }

  prepareSession(input: {
    readonly sessionId: string
    readonly title: string
    readonly shell: string
    readonly env: Record<string, string>
    readonly defaultShellArgs: readonly string[]
  }): TerminalAgentLaunchIntegration | null {
    if (!this.settings.enabled || !this.binding || !this.runtime) return null
    this.unregisterSession(input.sessionId)
    const token = randomUUID()
    const session: SessionBinding = {
      sessionId: input.sessionId,
      token,
      title: input.title,
      waiting: false,
    }
    this.sessionsByToken.set(token, session)
    this.sessionTokens.set(input.sessionId, token)
    const delimiter = this.platform === "win32" ? ";" : ":"
    const originalPath = input.env.PATH ?? ""
    const env: Record<string, string> = {
      ...input.env,
      PATH: `${this.runtime.shimDir}${delimiter}${originalPath}`,
      SYNAPSE_TERMINAL_SESSION_ID: input.sessionId,
      SYNAPSE_TERMINAL_AGENT_TOKEN: token,
      SYNAPSE_TERMINAL_AGENT_EVENT_URL: `http://${this.binding.bindAddress}:${String(this.binding.port)}${EVENT_PATH}`,
      SYNAPSE_TERMINAL_AGENT_NODE: this.deps.nodePath,
      SYNAPSE_TERMINAL_AGENT_HOOK: this.runtime.hookPath,
      SYNAPSE_TERMINAL_AGENT_WRAPPER: this.runtime.wrapperPath,
      SYNAPSE_TERMINAL_AGENT_SHIM_DIR: this.runtime.shimDir,
      SYNAPSE_TERMINAL_AGENT_ORIGINAL_PATH: originalPath,
    }
    const shellName = (this.platform === "win32" ? path.win32.basename(input.shell) : path.basename(input.shell))
      .toLowerCase()
      .replace(/\.exe$/, "")
    if (shellName === "zsh") {
      env.SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR = input.env.ZDOTDIR ?? ""
      env.SYNAPSE_TERMINAL_AGENT_ZDOTDIR = this.runtime.zshDir
      env.ZDOTDIR = this.runtime.zshDir
      return { env, shellArgs: input.defaultShellArgs }
    }
    if (shellName === "bash") {
      return { env, shellArgs: ["--noprofile", "--rcfile", this.runtime.bashRcPath, "-i"] }
    }
    if (shellName === "fish") {
      return { env, shellArgs: ["--init-command", "set -gx PATH \"$SYNAPSE_TERMINAL_AGENT_SHIM_DIR\" $PATH"] }
    }
    if (shellName === "pwsh" || shellName === "powershell") {
      return { env, shellArgs: ["-NoExit", "-Command", "$env:Path = $env:SYNAPSE_TERMINAL_AGENT_SHIM_DIR + ';' + $env:Path"] }
    }
    if (shellName === "cmd") {
      return { env, shellArgs: ["/K", "set \"PATH=%SYNAPSE_TERMINAL_AGENT_SHIM_DIR%;%PATH%\""] }
    }
    return { env, shellArgs: input.defaultShellArgs }
  }

  renameSession(sessionId: string, title: string): void {
    const token = this.sessionTokens.get(sessionId)
    const session = token ? this.sessionsByToken.get(token) : undefined
    if (session) session.title = title
  }

  handleUserInput(sessionId: string): void {
    const session = this.getSessionBinding(sessionId)
    if (session) session.waiting = false
  }

  unregisterSession(sessionId: string): void {
    const token = this.sessionTokens.get(sessionId)
    if (token) {
      this.sessionsByToken.delete(token)
      this.requestTimesByToken.delete(token)
    }
    this.sessionTokens.delete(sessionId)
    this.lastNotificationAt.delete(`${sessionId}:needs_action`)
    this.lastNotificationAt.delete(`${sessionId}:completed`)
  }

  reportActiveSession(webContentsId: number, sessionId: string | null): void {
    this.activeSessionByWebContents.set(webContentsId, sessionId)
  }

  forgetRenderer(webContentsId: number): void {
    this.activeSessionByWebContents.delete(webContentsId)
  }

  handleOscNotification(sessionId: string): void {
    const session = this.getSessionBinding(sessionId)
    if (session && !session.waiting) void this.notify(session, "completed", "terminal")
  }

  private async enableRuntime(): Promise<void> {
    if (!this.deps.nodePath) throw new Error("Synapse Node runtime is unavailable.")
    if (!this.runtime) this.runtime = await this.ensureRuntimeFiles()
    if (!this.binding) await this.startIngress()
  }

  private async ensureRuntimeFiles(): Promise<RuntimePaths> {
    let permission
    try {
      permission = await this.deps.permissionGuard.check({
        action: "fs.write",
        actor: { kind: "user" },
        resource: this.deps.runtimeDir,
        context: { source: "terminal.agent-notifications" },
      })
    } catch (error) {
      this.recordInfrastructureAudit("fs.write", this.deps.runtimeDir, "failed")
      throw error
    }
    if (!permission.allowed) {
      this.recordInfrastructureAudit("fs.write", this.deps.runtimeDir, "denied")
      throw new Error(permission.reason)
    }
    const shimDir = path.join(this.deps.runtimeDir, "bin")
    const zshDir = path.join(this.deps.runtimeDir, "zsh")
    const wrapperPath = path.join(this.deps.runtimeDir, "wrapper.js")
    const hookPath = path.join(this.deps.runtimeDir, "hook.js")
    const bashRcPath = path.join(this.deps.runtimeDir, "bashrc")
    try {
      await Promise.all([mkdir(shimDir, { recursive: true }), mkdir(zshDir, { recursive: true })])
      await Promise.all([
        writeFile(wrapperPath, TERMINAL_AGENT_WRAPPER_RUNTIME, { encoding: "utf8", mode: 0o700 }),
        writeFile(hookPath, TERMINAL_AGENT_HOOK_RUNTIME, { encoding: "utf8", mode: 0o700 }),
        writeFile(bashRcPath, bashIntegrationScript(), { encoding: "utf8", mode: 0o600 }),
        ...zshStartupFiles().map(([name, contents]) =>
          writeFile(path.join(zshDir, name), contents, { encoding: "utf8", mode: 0o600 })),
      ])
      const shimExtension = this.platform === "win32" ? ".cmd" : ""
      await Promise.all((["codex", "claude"] as const).map(async (provider) => {
        const shimPath = path.join(shimDir, `${provider}${shimExtension}`)
        const contents = this.platform === "win32"
          ? createTerminalAgentWindowsShim(provider)
          : createTerminalAgentUnixShim(provider)
        await writeFile(shimPath, contents, { encoding: "utf8", mode: 0o700 })
        if (this.platform !== "win32") await chmod(shimPath, 0o700)
      }))
      this.recordInfrastructureAudit("fs.write", this.deps.runtimeDir, "allowed")
      return { shimDir, zshDir, wrapperPath, hookPath, bashRcPath }
    } catch (error) {
      this.recordInfrastructureAudit("fs.write", this.deps.runtimeDir, "failed")
      throw error
    }
  }

  private async startIngress(): Promise<void> {
    const resource = `127.0.0.1:0${EVENT_PATH}`
    let permission
    try {
      permission = await this.deps.permissionGuard.check({
        action: "network.listen",
        actor: { kind: "user" },
        resource,
        context: { serviceId: NETWORK_SERVICE_ID },
      })
    } catch (error) {
      this.recordInfrastructureAudit("network.listen", resource, "failed")
      throw error
    }
    if (!permission.allowed) {
      this.recordInfrastructureAudit("network.listen", resource, "denied")
      throw new Error(permission.reason)
    }
    this.binding = await this.deps.networkRegistry.register({
      id: NETWORK_SERVICE_ID,
      role: "http",
      bindAddress: "127.0.0.1",
      auth: { kind: "local-token", tokenSecretRef: "terminal-agent.session-token" },
      handler: { handle: () => ({ ok: true }) },
      audit: (event) => {
        this.recordInfrastructureAudit(
          "network.listen",
          event.serviceId,
          event.action === "failed" ? "failed" : "allowed",
          { action: event.action, bindAddress: event.binding?.bindAddress, port: event.binding?.port },
          event.timestamp,
        )
      },
      start: (binding) => createLocalNetworkHostLifecycle(binding, {
        maxBodyBytes: MAX_BODY_BYTES,
        handleHttp: (request) => this.handleHttp(request),
      }),
    })
  }

  private async stopIngress(): Promise<void> {
    if (!this.binding) return
    await this.deps.networkRegistry.unregister(NETWORK_SERVICE_ID)
    this.binding = undefined
  }

  private async handleHttp(request: LocalHttpRequest): Promise<LocalHttpResponse> {
    if (request.method !== "POST" || request.url !== EVENT_PATH) return { status: 404 }
    if (!isLoopback(request.remoteAddress)) return { status: 403 }
    const token = bearerToken(request.headers.authorization)
    const session = token ? this.sessionsByToken.get(token) : undefined
    if (!token || !session || !secureEqual(token, session.token)) return { status: 401 }
    if (!this.acquireRateLimit(token)) return { status: 429 }
    try {
      const payload = parseAgentEvent(request.body)
      if (payload.sessionId !== session.sessionId) return { status: 403 }
      await this.handleAgentEvent(session, payload)
      return { status: 204 }
    } catch {
      return { status: 400 }
    }
  }

  private async handleAgentEvent(session: SessionBinding, payload: AgentEventPayload): Promise<void> {
    if (payload.agentId || payload.parentSessionId || payload.event === "SubagentStop") return
    if (payload.event === "SessionStart" || payload.event === "UserPromptSubmit") {
      session.waiting = false
      return
    }
    if (payload.event === "PermissionRequest") {
      session.waiting = true
      await this.notify(session, "needs_action", payload.source)
      return
    }
    if (payload.event === "PreToolUse" && isQuestionTool(payload.source, payload.toolName)) {
      session.waiting = true
      await this.notify(session, "needs_action", payload.source)
      return
    }
    if (payload.event === "PreToolUse") {
      session.waiting = false
      return
    }
    if (payload.event === "Notification" && isActionNotification(payload.notificationType)) {
      session.waiting = true
      await this.notify(session, "needs_action", payload.source)
      return
    }
    if (payload.event === "Stop") {
      if (session.waiting) return
      session.waiting = false
      await this.notify(session, "completed", payload.source)
    }
  }

  private async notify(
    session: SessionBinding,
    kind: AgentNotificationKind,
    provider: AgentProvider | "terminal",
  ): Promise<void> {
    if (this.isExactSessionFocused(session.sessionId)) return
    const key = `${session.sessionId}:${kind}`
    const previous = this.lastNotificationAt.get(key) ?? 0
    if (this.now() - previous < DEDUPLICATION_WINDOW_MS) return
    this.lastNotificationAt.set(key, this.now())
    const actor = { kind: "user" } as const
    const resource = `terminal.session:${session.sessionId}`
    let permission
    try {
      permission = await this.deps.permissionGuard.check({
        action: "notification.trigger",
        actor,
        resource,
        context: { source: "terminal.agent-notifications", provider, kind },
      })
    } catch (error) {
      this.lastNotificationAt.delete(key)
      this.recordNotificationAudit(resource, provider, kind, "failed")
      this.deps.logger.warn("Failed to authorize Terminal agent notification.", {
        sessionId: session.sessionId,
        error,
      })
      return
    }
    if (!permission.allowed) {
      this.lastNotificationAt.delete(key)
      this.recordNotificationAudit(resource, provider, kind, "denied")
      return
    }
    const title = provider === "codex" ? "Codex" : provider === "claude" ? "Claude Code" : "终端"
    const sessionTitle = sanitizeSessionTitle(session.title)
    try {
      const notification = this.deps.createNotification({
        title,
        body: kind === "needs_action" ? `“${sessionTitle}”需要你的操作` : `“${sessionTitle}”任务已完成`,
      })
      if (!notification) {
        this.recordNotificationAudit(resource, provider, kind, "allowed")
        return
      }
      const release = () => this.liveNotifications.delete(notification)
      notification.on("close", release)
      notification.on("click", () => {
        release()
        this.deps.focusApp()
        void this.deps.openTerminalSession(session.sessionId).catch((error) => {
          this.deps.logger.warn("Failed to open Terminal session from notification.", {
            sessionId: session.sessionId,
            error,
          })
        })
      })
      this.liveNotifications.add(notification)
      try {
        notification.show()
      } catch (error) {
        this.liveNotifications.delete(notification)
        throw error
      }
      this.recordNotificationAudit(resource, provider, kind, "allowed")
    } catch (error) {
      this.lastNotificationAt.delete(key)
      this.recordNotificationAudit(resource, provider, kind, "failed")
      this.deps.logger.warn("Failed to show Terminal agent notification.", {
        sessionId: session.sessionId,
        error,
      })
    }
  }

  private recordNotificationAudit(
    resource: string,
    provider: AgentProvider | "terminal",
    kind: AgentNotificationKind,
    outcome: "allowed" | "denied" | "failed",
  ): void {
    try {
      this.deps.auditSink.record({
        action: "notification.trigger",
        actor: { kind: "user" },
        resource,
        outcome,
        timestamp: new Date(this.now()).toISOString(),
        metadata: { source: "terminal.agent-notifications", provider, kind },
      })
    } catch (error) {
      this.deps.logger.warn("Failed to audit Terminal agent notification.", { outcome, error })
    }
  }

  private recordInfrastructureAudit(
    action: "fs.write" | "network.listen",
    resource: string,
    outcome: "allowed" | "denied" | "failed",
    metadata: Record<string, unknown> = {},
    timestamp = new Date(this.now()).toISOString(),
  ): void {
    try {
      this.deps.auditSink.record({
        action,
        actor: { kind: "user" },
        resource,
        outcome,
        timestamp,
        metadata: { source: "terminal.agent-notifications", ...metadata },
      })
    } catch (error) {
      this.deps.logger.warn("Failed to audit Terminal agent notification infrastructure.", {
        action,
        outcome,
        error,
      })
    }
  }

  private isExactSessionFocused(sessionId: string): boolean {
    const focusedId = this.deps.focusedWebContentsId()
    return focusedId !== null && this.activeSessionByWebContents.get(focusedId) === sessionId
  }

  private acquireRateLimit(token: string): boolean {
    const cutoff = this.now() - 60_000
    const current = (this.requestTimesByToken.get(token) ?? []).filter((time) => time > cutoff)
    if (current.length >= RATE_LIMIT_PER_MINUTE) return false
    current.push(this.now())
    this.requestTimesByToken.set(token, current)
    return true
  }

  private getSessionBinding(sessionId: string): SessionBinding | undefined {
    const token = this.sessionTokens.get(sessionId)
    return token ? this.sessionsByToken.get(token) : undefined
  }
}

type RuntimePaths = {
  readonly shimDir: string
  readonly zshDir: string
  readonly wrapperPath: string
  readonly hookPath: string
  readonly bashRcPath: string
}

type AgentEventPayload = {
  readonly source: AgentProvider
  readonly event: string
  readonly sessionId: string
  readonly toolName?: string
  readonly notificationType?: string
  readonly agentId?: string
  readonly parentSessionId?: string
}

function defaultSettings(): TerminalAgentNotificationSettings {
  return {
    schemaVersion: 1,
    id: "default",
    enabled: false,
    revision: 1,
    updatedAt: new Date(0).toISOString(),
  }
}

function parseAgentEvent(body: Buffer): AgentEventPayload {
  const value = JSON.parse(body.toString("utf8")) as Record<string, unknown>
  if ((value.source !== "codex" && value.source !== "claude")
    || typeof value.event !== "string"
    || typeof value.sessionId !== "string") throw new Error("Invalid event")
  return {
    source: value.source,
    event: value.event.slice(0, 64),
    sessionId: value.sessionId,
    ...(typeof value.toolName === "string" ? { toolName: value.toolName.slice(0, 128) } : {}),
    ...(typeof value.notificationType === "string" ? { notificationType: value.notificationType.slice(0, 128) } : {}),
    ...(typeof value.agentId === "string" ? { agentId: value.agentId.slice(0, 128) } : {}),
    ...(typeof value.parentSessionId === "string" ? { parentSessionId: value.parentSessionId.slice(0, 128) } : {}),
  }
}

function bearerToken(value: string | readonly string[] | undefined): string | null {
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null
  return value.slice(7)
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1"
}

function isQuestionTool(source: AgentProvider, toolName: string | undefined): boolean {
  return source === "codex"
    ? toolName === "request_user_input"
    : toolName === "AskUserQuestion" || toolName === "ExitPlanMode"
}

function isActionNotification(type: string | undefined): boolean {
  return type === undefined || ["permission_prompt", "idle_prompt", "elicitation_dialog"].includes(type)
}

function sanitizeSessionTitle(value: string): string {
  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim()
  return (normalized || "终端").slice(0, 60)
}

function zshStartupFiles(): readonly (readonly [string, string])[] {
  const zshEnv = [
    'typeset _synapse_original_zdotdir="${SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR:-$HOME}"',
    'if [[ -r "$_synapse_original_zdotdir/.zshenv" ]]; then',
    '  source "$_synapse_original_zdotdir/.zshenv"',
    "fi",
    'if [[ -n "$ZDOTDIR" && "$ZDOTDIR" != "$SYNAPSE_TERMINAL_AGENT_ZDOTDIR" ]]; then',
    '  export SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR="$ZDOTDIR"',
    "fi",
    'export ZDOTDIR="$SYNAPSE_TERMINAL_AGENT_ZDOTDIR"',
    "typeset -gU path PATH",
    'path=("$SYNAPSE_TERMINAL_AGENT_SHIM_DIR" $path)',
    "unset _synapse_original_zdotdir",
    "",
  ].join("\n")
  const remaining = [".zprofile", ".zshrc", ".zlogin"].map((name) => [name, String.raw`if [[ -n "$SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR" && -r "$SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR/${name}" ]]; then
  source "$SYNAPSE_TERMINAL_ORIGINAL_ZDOTDIR/${name}"
elif [[ -r "$HOME/${name}" ]]; then
  source "$HOME/${name}"
fi
typeset -gU path PATH
path=("$SYNAPSE_TERMINAL_AGENT_SHIM_DIR" $path)
`] as const)
  return [[".zshenv", zshEnv] as const, ...remaining]
}

function bashIntegrationScript(): string {
  return String.raw`if [[ -r "$HOME/.bash_profile" ]]; then
  source "$HOME/.bash_profile"
elif [[ -r "$HOME/.bash_login" ]]; then
  source "$HOME/.bash_login"
elif [[ -r "$HOME/.profile" ]]; then
  source "$HOME/.profile"
elif [[ -r "$HOME/.bashrc" ]]; then
  source "$HOME/.bashrc"
fi
export PATH="$SYNAPSE_TERMINAL_AGENT_SHIM_DIR:$PATH"
`
}
