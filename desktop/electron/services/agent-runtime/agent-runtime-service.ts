import type {
  AgentCommandEntryV1,
  AgentCompressStateEntryV1,
  ConversationEntryV1,
  DataNamespace,
} from "../../runtime/data-repo"
import type {
  ControlledProcessResult,
  ControlledProcessRunRequest,
} from "../../runtime/process"
import type { ScopedEventBus } from "../../runtime/project-container"
import type {
  ActorIdentity,
  AuditSink,
  PermissionAction,
  PermissionGuard,
} from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { ReplyOutboxService } from "../reply-target"
import type { ReplyTarget } from "../reply-target"
import type { ProcessIsolationResolver } from "../execution-isolation"
import { resolveShellCommand } from "../shell-exec"
import {
  prepareCodexRuntime,
  type ProviderConfigService,
  type ProviderRuntimeView,
} from "../provider-config"
import { AgentCommandRouter } from "./command-router"
import type {
  RegisteredPromptCommand,
} from "./command-router"
import type { CustomCommandRegistry, PublishedAgentCommand } from "./command-registry"
import { BUILTIN_COMMANDS } from "./command-registry"
import type { AgentGovernanceDecision, AgentGovernanceService } from "./governance"
import {
  parseReferenceViewOptions,
  renderReferenceView,
  resolveLocalReference,
} from "./references"
import {
  AgentSessionRepository,
  conversationId,
} from "./session-repository"
import { SessionLifecycleManager } from "./session-lifecycle"
import type {
  RuntimeSessionState,
  PendingPermissionState,
} from "./session-lifecycle"
import { MessageRouter } from "./message-router"
import type {
  AgentAdapter,
  AgentEvent,
  AgentMessage,
  AgentPendingPermission,
  AgentPermissionResponseRequest,
  AgentRuntimeRelayResult,
  AgentRuntimeTurnResult,
  ScheduledAgentSendInput,
  ScheduledAgentSendResult,
} from "./types"
import type { SkillRegistry } from "./skill-registry"

export interface AgentCommandProcessRunner {
  run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult>
}

export interface AgentRuntimeServiceDeps {
  readonly projectId: string
  readonly workDir?: string
  readonly conversations: DataNamespace<ConversationEntryV1>
  readonly adapter: AgentAdapter
  readonly adapterFactory?: AgentAdapterFactory
  readonly agentType?: string
  readonly sessionRepository?: AgentSessionRepository
  readonly eventBus?: ScopedEventBus
  readonly logger?: StructuredLogger
  readonly now?: () => Date
  readonly pendingQueueLimit?: number
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly outbox?: ReplyOutboxService
  readonly governance?: AgentGovernanceService
  readonly providerConfig?: ProviderConfigService
  readonly compressState?: DataNamespace<AgentCompressStateEntryV1>
  readonly registeredPromptCommands?: readonly RegisteredPromptCommand[]
  readonly agentNativeSlashAllowlist?: readonly string[]
  readonly unknownSlashBehavior?: "reject" | "passthrough"
  readonly customCommands?: CustomCommandRegistry
  readonly skills?: SkillRegistry
  readonly commandRunner?: AgentCommandProcessRunner
  readonly executionIsolation?: ProcessIsolationResolver
  readonly replyTargets?: {
    rememberReplyTarget(target: ReplyTarget): void
    dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): void
    getAgentEnv(projectId: string, sessionKey: string): Record<string, string> | undefined
  }
}

export type AgentAdapterFactory = (view: ProviderRuntimeView) => AgentAdapter | Promise<AgentAdapter>

export interface AgentRuntimeStatus {
  readonly projectId: string
  readonly agentType: string
  readonly liveSessions: number
  readonly busySessions: number
  readonly queuedTurns: number
  readonly pendingPermissions: number
}

export class AgentRuntimeService {
  private readonly deps: AgentRuntimeServiceDeps
  private readonly repository: AgentSessionRepository
  private readonly commandRouter: AgentCommandRouter | undefined
  private readonly sessionLifecycle: SessionLifecycleManager
  private readonly messageRouter: MessageRouter
  private readonly states = new Map<string, RuntimeSessionState>()
  private readonly pendingPermissions = new Map<string, PendingPermissionState>()

  constructor(deps: AgentRuntimeServiceDeps) {
    this.deps = deps
    this.repository = deps.sessionRepository ?? new AgentSessionRepository({
      projectId: deps.projectId,
      conversations: deps.conversations,
      now: deps.now,
    })
    this.sessionLifecycle = new SessionLifecycleManager({
      projectId: deps.projectId,
      repository: this.repository,
      states: this.states,
      pendingPermissions: this.pendingPermissions,
      logger: deps.logger,
      getActiveAgentType: () => this.getActiveAgentType(),
    })
    this.commandRouter = deps.providerConfig
      ? new AgentCommandRouter({
        projectId: deps.projectId,
        agentType: this.agentType(),
        resolveAgentType: () => this.getActiveAgentType(),
        providerConfig: deps.providerConfig,
        registeredPromptCommands: deps.registeredPromptCommands,
        agentNativeSlashAllowlist: deps.agentNativeSlashAllowlist,
        unknownSlashBehavior: deps.unknownSlashBehavior,
        customCommands: deps.customCommands,
        skills: deps.skills,
        resetSession: (message) => this.resetMessageSession(message),
        showReference: (message, args) => this.showReferenceForMessage(message, args),
        listCommands: (message) => this.listPublishedCommands(message.platform),
        runCustomCommand: (command, args, message) =>
          this.runCustomCommand(command, args, message),
        compressSession: (message, conversation) =>
          this.messageRouter.compressSession(message, conversation),
      })
      : undefined
    this.messageRouter = new MessageRouter({
      deps: {
        projectId: deps.projectId,
        workDir: deps.workDir,
        eventBus: deps.eventBus,
        logger: deps.logger,
        governance: deps.governance,
        compressState: deps.compressState,
        pendingQueueLimit: deps.pendingQueueLimit,
        outbox: deps.outbox,
        auditSink: deps.auditSink,
        executionIsolation: deps.executionIsolation,
        replyTargets: deps.replyTargets,
        now: deps.now,
      },
      repository: this.repository,
      commandRouter: this.commandRouter,
      pendingPermissions: this.pendingPermissions,
      callbacks: {
        stateForConversation: (id, msg) => this.stateForConversation(id, msg),
        resolveAdapter: (agentType) => this.resolveAdapter(agentType),
        resolveProcessIsolation: (msg) => this.resolveProcessIsolation(msg),
        workDirFor: (msg) => this.workDirFor(msg),
        getOrCreateCompressionState: (agentType) => this.getOrCreateCompressionState(agentType),
        markCompressionState: (agentType, status, error) =>
          this.markCompressionState(agentType, status, error),
      },
    })
  }

  async send(message: AgentMessage): Promise<AgentRuntimeTurnResult> {
    return this.messageRouter.send(message)
  }

  async sendToConversation(
    message: AgentMessage,
    conversationId: string,
  ): Promise<AgentRuntimeTurnResult> {
    return this.messageRouter.sendToConversation(message, conversationId)
  }

  async sendNewSession(
    message: AgentMessage,
    name: string,
  ): Promise<AgentRuntimeTurnResult> {
    return this.messageRouter.sendNewSession(message, name)
  }

  async sendSideSessionWithTimeout(
    message: AgentMessage,
    name: string,
    timeoutMs: number,
  ): Promise<AgentRuntimeRelayResult> {
    return this.messageRouter.sendSideSessionWithTimeout(message, name, timeoutMs)
  }

  async sendScheduled(input: ScheduledAgentSendInput): Promise<ScheduledAgentSendResult> {
    const startMs = Date.now()
    const sessionKey = `scheduled:${input.projectId}:${Date.now()}`
    const message: AgentMessage = {
      projectId: input.projectId,
      sessionKey,
      platform: "scheduled",
      content: input.prompt,
      modeOverride: input.mode,
      agentType: input.agentType,
    }

    const ac = new AbortController()
    const externalSignal = input.abortSignal

    if (externalSignal?.aborted) {
      return {
        conversationId: "",
        status: "error",
        error: "Aborted before execution",
        durationMs: Date.now() - startMs,
      }
    }

    const onExternalAbort = () => ac.abort()
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true })

    const timeout = setTimeout(() => ac.abort(), input.timeoutMs)

    try {
      let result: AgentRuntimeTurnResult

      if (input.sessionPolicy === "fresh" || !input.lastConversationId) {
        const name = `scheduled-${new Date().toISOString().slice(0, 16)}`
        result = await this.sendNewSession(message, name)
      } else {
        try {
          result = await this.sendToConversation(message, input.lastConversationId)
        } catch (resumeError) {
          const isNotFound = resumeError instanceof Error
            && resumeError.message.includes("not found")
          if (!isNotFound) throw resumeError
          const name = `scheduled-${new Date().toISOString().slice(0, 16)}`
          result = await this.sendNewSession(message, name)
        }
      }

      const timedOut = ac.signal.aborted && !externalSignal?.aborted
      if (timedOut) {
        return {
          conversationId: result.conversationId,
          status: "timeout",
          error: `Execution exceeded ${input.timeoutMs}ms timeout`,
          durationMs: Date.now() - startMs,
        }
      }

      return {
        conversationId: result.conversationId,
        status: result.error ? "error" : "success",
        summary: result.resultText || undefined,
        error: result.error,
        durationMs: Date.now() - startMs,
      }
    } catch (error) {
      const isTimeout = ac.signal.aborted && !externalSignal?.aborted
      return {
        conversationId: "",
        status: isTimeout ? "timeout" : "error",
        error: isTimeout
          ? `Execution exceeded ${input.timeoutMs}ms timeout`
          : error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startMs,
      }
    } finally {
      clearTimeout(timeout)
      externalSignal?.removeEventListener("abort", onExternalAbort)
    }
  }

  listPendingPermissions(): readonly AgentPendingPermission[] {
    return [...this.pendingPermissions.values()].map((pending) => ({
      requestId: pending.requestId,
      projectId: pending.projectId,
      sessionKey: pending.sessionKey,
      workspaceKey: pending.workspaceKey,
      workspacePath: pending.workspacePath,
      conversationId: pending.conversationId,
      toolName: pending.toolName,
      toolInput: pending.toolInput,
      toolInputRaw: pending.toolInputRaw,
      createdAt: pending.createdAt,
    }))
  }

  getStatus(): AgentRuntimeStatus {
    const states = [...this.states.values()]
    return {
      projectId: this.deps.projectId,
      agentType: this.agentType(),
      liveSessions: states.filter((state) => state.liveSession?.alive()).length,
      busySessions: states.filter((state) => state.busy).length,
      queuedTurns: states.reduce((count, state) => count + state.queue.length, 0),
      pendingPermissions: this.pendingPermissions.size,
    }
  }

  async reclaimIdleSessions(): Promise<void> {
    return this.sessionLifecycle.reclaimIdleSessions()
  }

  startIdleReclaim(): void {
    this.sessionLifecycle.startIdleReclaim()
  }

  stopIdleReclaim(): void {
    this.sessionLifecycle.stopIdleReclaim()
  }

  async getActiveAgentType(): Promise<string> {
    if (!this.deps.providerConfig) return this.agentType()
    return this.deps.providerConfig.getActiveAgentType(this.deps.projectId, this.agentType())
  }

  async listSessions(): Promise<readonly ConversationEntryV1[]> {
    return this.sessionLifecycle.listSessions()
  }

  async getSession(conversationIdValue: string): Promise<ConversationEntryV1 | null> {
    return this.sessionLifecycle.getSession(conversationIdValue)
  }

  async listPublishedCommands(platform = "local-renderer"): Promise<readonly PublishedAgentCommand[]> {
    const custom = (await this.deps.customCommands?.listPublished() ?? [])
      .filter((command) => !command.allowedPlatforms
        || command.allowedPlatforms.some((allowed) => allowed.toLowerCase() === platform.toLowerCase()))
    const skills = await this.deps.skills?.listPublished() ?? []
    const native = (this.deps.agentNativeSlashAllowlist ?? []).map((name) => ({
      name,
      source: "agent-native" as const,
      kind: "agent-native" as const,
      adminOnly: false,
      allowedPlatforms: ["local-renderer"],
    }))
    return [...BUILTIN_COMMANDS, ...custom, ...skills, ...native]
  }

  async getCompressionState(agentType = this.agentType()): Promise<AgentCompressStateEntryV1> {
    return this.getOrCreateCompressionState(agentType)
  }

  async updateCompressionState(input: {
    readonly agentType?: string
    readonly enabled?: boolean
    readonly maxTokens?: number
    readonly minGapMins?: number
  }): Promise<AgentCompressStateEntryV1> {
    const existing = await this.getOrCreateCompressionState(input.agentType ?? this.agentType())
    const next: AgentCompressStateEntryV1 = {
      ...existing,
      enabled: input.enabled ?? existing.enabled,
      maxTokens: input.maxTokens ?? existing.maxTokens,
      minGapMins: input.minGapMins ?? existing.minGapMins,
      updatedAt: this.isoNow(),
    }
    await this.deps.compressState?.upsert(next)
    return next
  }

  async respondPermission(request: AgentPermissionResponseRequest): Promise<void> {
    const pending = this.pendingPermissions.get(request.requestId)
    if (!pending) {
      throw new Error(`Permission request "${request.requestId}" is not pending`)
    }

    const action = permissionActionForTool(pending.toolName)
    const resource = pending.toolInput ?? pending.toolName

    if (request.behavior === "allow") {
      if (request.actor.kind !== "user") {
        this.recordPermissionAudit(action, request.actor, resource, "denied", pending, {
          reason: "non-user actors cannot allow agent permission requests",
        })
        throw new Error("Only a user actor can allow an agent permission request")
      }
      if (this.deps.permissionGuard) {
        const permission = await this.deps.permissionGuard.check({
          action,
          actor: request.actor,
          resource,
          context: {
            projectId: pending.projectId,
            sessionKey: pending.sessionKey,
            requestId: pending.requestId,
            toolName: pending.toolName,
            toolInputRaw: pending.toolInputRaw,
          },
        })
        if (!permission.allowed) {
          this.recordPermissionAudit(action, request.actor, resource, "denied", pending, {
            reason: permission.reason,
            policyId: permission.policyId,
          })
          throw new Error(permission.reason)
        }
      }
    }

    try {
      await pending.liveSession.respondPermission(request.requestId, {
        behavior: request.behavior,
        updatedInput: request.updatedInput ?? pending.toolInputRaw,
        message: request.message,
      })
      this.recordPermissionAudit(
        action,
        request.actor,
        resource,
        request.behavior === "allow" ? "allowed" : "denied",
        pending,
        { behavior: request.behavior },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.recordPermissionAudit(action, request.actor, resource, "failed", pending, {
        behavior: request.behavior,
        error: message,
      })
      throw error
    }

    this.pendingPermissions.delete(request.requestId)
    const pendingState = this.states.get(pending.stateKey)
    if (pendingState?.pending?.requestId === request.requestId) {
      pendingState.pending = undefined
    }
    pending.resolve()
  }

  async clearCurrentAgentSessionId(
    sessionKey: string,
    platform = "local",
    workspaceKey?: string,
  ): Promise<ConversationEntryV1 | null> {
    return this.sessionLifecycle.clearCurrentAgentSessionId(sessionKey, platform, workspaceKey)
  }

  async resetSession(
    sessionKey: string,
    platform = "local",
    workspaceKey?: string,
  ): Promise<ConversationEntryV1 | null> {
    return this.sessionLifecycle.resetSession(sessionKey, platform, workspaceKey)
  }

  async createSession(
    input: {
      readonly sessionKey: string
      readonly platform?: string
      readonly name?: string
      readonly agentType?: string
      readonly workspaceKey?: string
      readonly workspacePath?: string
    },
  ): Promise<ConversationEntryV1> {
    return this.sessionLifecycle.createSession(input)
  }

  async switchSession(
    sessionKey: string,
    conversationIdValue: string,
    platform?: string,
    workspaceKey?: string,
  ): Promise<ConversationEntryV1> {
    return this.sessionLifecycle.switchSession(sessionKey, conversationIdValue, platform, workspaceKey)
  }

  async reapIdleWorkspaceRuntimes(
    idleTimeoutMs: number,
    nowMs = Date.now(),
  ): Promise<readonly string[]> {
    return this.sessionLifecycle.reapIdleWorkspaceRuntimes(idleTimeoutMs, nowMs)
  }

  async renameSession(conversationIdValue: string, name: string): Promise<boolean> {
    return this.sessionLifecycle.renameSession(conversationIdValue, name)
  }

  async deleteSession(conversationIdValue: string): Promise<boolean> {
    return this.sessionLifecycle.deleteSession(conversationIdValue)
  }

  private recordPermissionAudit(
    action: PermissionAction,
    actor: ActorIdentity,
    resource: string,
    outcome: "allowed" | "denied" | "failed",
    pending: AgentPendingPermission,
    metadata: Record<string, unknown>,
  ): void {
    this.deps.auditSink?.record({
      action,
      actor,
      resource,
      outcome,
      metadata: {
        ...metadata,
          projectId: pending.projectId,
          sessionKey: pending.sessionKey,
          workspaceKey: pending.workspaceKey,
          workspacePath: pending.workspacePath,
          conversationId: pending.conversationId,
        requestId: pending.requestId,
        toolName: pending.toolName,
      },
    })
  }

  private stateForConversation(conversationIdValue: string, message?: AgentMessage): RuntimeSessionState {
    return this.sessionLifecycle.stateForConversation(conversationIdValue, message)
  }

  private async closeIdleStateForConversation(
    sessionKey: string,
    platform?: string,
    workspaceKey?: string,
  ): Promise<void> {
    return this.sessionLifecycle.closeIdleStateForConversation(sessionKey, platform, workspaceKey)
  }

  private resetMessageSession(message: AgentMessage): Promise<ConversationEntryV1 | null> {
    return this.resetSession(message.sessionKey, message.platform, message.workspaceKey)
  }

  private async showReferenceForMessage(
    message: AgentMessage,
    args: readonly string[],
  ): Promise<string> {
    const parsed = parseReferenceViewOptions(args)
    if (!parsed) return "Use /show <path[:line]>."
    const workDir = this.workDirFor(message)
    if (!workDir) throw new Error("Project workspace path is required")
    const reference = resolveLocalReference(parsed.reference, workDir)
    if (!reference) return "Reference is outside the workspace or invalid."
    const actor: ActorIdentity = { kind: "user", id: message.userId }
    const permission = await this.deps.permissionGuard?.check({
      action: "fs.read.outside-userdata",
      actor,
      resource: reference.path,
      context: {
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
        workspacePath: workDir,
        command: "/show",
      },
    })
    if (permission && !permission.allowed) {
      this.deps.auditSink?.record({
        action: "fs.read.outside-userdata",
        actor,
        resource: reference.path,
        outcome: "denied",
        metadata: {
          projectId: this.deps.projectId,
          sessionKey: message.sessionKey,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }
    try {
      const content = await renderReferenceView(parsed.reference, workDir, parsed.options)
      this.deps.auditSink?.record({
        action: "fs.read.outside-userdata",
        actor,
        resource: reference.path,
        outcome: "allowed",
        metadata: {
          projectId: this.deps.projectId,
          sessionKey: message.sessionKey,
          command: "/show",
        },
      })
      return content
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      this.deps.auditSink?.record({
        action: "fs.read.outside-userdata",
        actor,
        resource: reference.path,
        outcome: "failed",
        metadata: {
          projectId: this.deps.projectId,
          sessionKey: message.sessionKey,
          command: "/show",
          error: messageText,
        },
      })
      throw error
    }
  }

  private async runCustomCommand(
    command: AgentCommandEntryV1,
    args: readonly string[],
    message: AgentMessage,
  ): Promise<string> {
    if (!this.deps.commandRunner) throw new Error("Command execution is unavailable")
    if (!command.exec?.trim()) throw new Error("Command is missing exec body")
    const workDir = command.workDir ?? this.workDirFor(message)
    if (!workDir) throw new Error("Project workspace path is required")
    const shell = resolveShellCommand(command.shell, `${command.exec} ${args.join(" ")}`.trim(), {
      windowsDefault: "powershell",
      posixLogin: false,
    })
    const result = await this.deps.commandRunner.run({
      actor: { kind: "user", id: message.userId },
      action: "shell.exec",
      command: shell.command,
      args: [...shell.args],
      cwd: workDir,
      isolation: await this.resolveProcessIsolation(message),
      timeoutMs: 60_000,
      output: { stdout: "buffer", stderr: "buffer" },
      metadata: {
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
        command: `/${command.name}`,
        shell: shell.shell,
        platform: message.platform,
      },
    })
    return formatCommandResult(command.name, result)
  }

  private async getOrCreateCompressionState(
    agentType: string,
  ): Promise<AgentCompressStateEntryV1> {
    if (!this.deps.compressState) throw new Error("Compression state is unavailable")
    const id = compressionStateId(this.deps.projectId, agentType)
    const existing = await this.deps.compressState.get(id)
    if (existing) return existing
    const now = this.isoNow()
    const entry: AgentCompressStateEntryV1 = {
      id,
      schemaVersion: 1,
      projectId: this.deps.projectId,
      agentType,
      enabled: false,
      maxTokens: 60_000,
      minGapMins: 30,
      lastStatus: "idle",
      createdAt: now,
      updatedAt: now,
    }
    await this.deps.compressState.upsert(entry)
    return entry
  }

  private async markCompressionState(
    agentType: string,
    status: AgentCompressStateEntryV1["lastStatus"],
    error?: string,
  ): Promise<void> {
    if (!this.deps.compressState) return
    const existing = await this.getOrCreateCompressionState(agentType)
    const now = this.isoNow()
    await this.deps.compressState.upsert({
      ...existing,
      lastCompressedAt: status === "success" ? now : existing.lastCompressedAt,
      lastStatus: status,
      lastError: error,
      updatedAt: now,
    })
  }

  private workDirFor(message: AgentMessage): string | undefined {
    return message.workspacePath ?? this.deps.workDir
  }

  private async resolveProcessIsolation(message: AgentMessage) {
    const sessionEnv = this.deps.replyTargets?.getAgentEnv(this.deps.projectId, message.sessionKey)
    return this.deps.executionIsolation?.resolveProcessIsolation(
      this.deps.projectId,
      Object.keys(sessionEnv ?? {}),
    )
  }

  private async resolveAdapter(agentTypeOverride?: string): Promise<AgentAdapter> {
    if (!this.deps.providerConfig || !this.deps.adapterFactory) {
      return this.deps.adapter
    }
    const agentType = agentTypeOverride ?? await this.getActiveAgentType()
    const view = await this.deps.providerConfig.resolveRuntimeConfig(
      this.deps.projectId,
      agentType,
      { actor: { kind: "user" } },
    )
    if (view.agentType === "codex") {
      await prepareCodexRuntime(view, {
        permissionGuard: this.deps.permissionGuard,
        auditSink: this.deps.auditSink,
        actor: { kind: "user" },
      })
    }
    return this.deps.adapterFactory(view)
  }

  private agentType(): string {
    return this.deps.agentType ?? this.deps.adapter.agentType
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

export { conversationId }

function permissionActionForTool(toolName: string): PermissionAction {
  switch (toolName) {
    case "Bash":
    case "Shell":
    case "run_shell_command":
      return "shell.exec"
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "fs.write"
    case "WebFetch":
    case "WebSearch":
      return "network.connect"
    case "Read":
      return "fs.read.outside-userdata"
    default:
      return "agent.spawn"
  }
}

function compressionStateId(projectId: string, agentType: string): string {
  return `compress:${projectId}:${agentType}`
}

function formatCommandResult(name: string, result: ControlledProcessResult): string {
  const output = [result.stdout, result.stderr]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n")
  const status = result.timedOut
    ? `Command timed out: /${name}`
    : result.exitCode === 0
      ? `Command completed: /${name}`
      : `Command failed: /${name} (${String(result.exitCode ?? result.signal ?? "unknown")})`
  return output ? `${status}\n\n${truncateRunes(output, 4000)}` : status
}

function truncateRunes(value: string, maxRunes: number): string {
  const runes = [...value]
  if (runes.length <= maxRunes) return value
  return `${runes.slice(0, maxRunes).join("")}...`
}

export type { AgentGovernanceDecision }
