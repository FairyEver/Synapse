import type { ConversationEntryV1, DataNamespace } from "../../runtime/data-repo"
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
import {
  prepareCodexRuntime,
  type ProviderConfigService,
  type ProviderRuntimeView,
} from "../provider-config"
import { AgentCommandRouter } from "./command-router"
import type {
  AgentCommandRouterResult,
  RegisteredPromptCommand,
} from "./command-router"
import type { AgentGovernanceDecision, AgentGovernanceService } from "./governance"
import {
  AgentSessionRepository,
  conversationId,
} from "./session-repository"
import type {
  AgentAdapter,
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPendingPermission,
  AgentPermissionRequestEvent,
  AgentPermissionResponseRequest,
  AgentRuntimeTurnResult,
} from "./types"

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
  readonly registeredPromptCommands?: readonly RegisteredPromptCommand[]
  readonly agentNativeSlashAllowlist?: readonly string[]
  readonly unknownSlashBehavior?: "reject" | "passthrough"
  readonly replyTargets?: {
    rememberReplyTarget(target: ReplyTarget): void
    dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): void
    getAgentEnv(projectId: string, sessionKey: string): Record<string, string> | undefined
  }
}

export type AgentAdapterFactory = (view: ProviderRuntimeView) => AgentAdapter

interface QueuedTurn {
  readonly message: AgentMessage
  readonly conversationId: string
  resolve(result: AgentRuntimeTurnResult): void
}

interface RuntimeSessionState {
  key: string
  workspaceKey?: string
  workspacePath?: string
  readonly queue: QueuedTurn[]
  busy: boolean
  activeTurns: number
  lastActivity: number
  liveSession?: AgentLiveSession
  pending?: PendingPermissionState
}

export interface AgentRuntimeStatus {
  readonly projectId: string
  readonly agentType: string
  readonly liveSessions: number
  readonly busySessions: number
  readonly queuedTurns: number
  readonly pendingPermissions: number
}

interface PendingPermissionState extends AgentPendingPermission {
  readonly liveSession: AgentLiveSession
  resolve(): void
}

const DEFAULT_PENDING_QUEUE_LIMIT = 5

export class AgentRuntimeService {
  private readonly deps: AgentRuntimeServiceDeps
  private readonly repository: AgentSessionRepository
  private readonly commandRouter: AgentCommandRouter | undefined
  private readonly states = new Map<string, RuntimeSessionState>()
  private readonly pendingPermissions = new Map<string, PendingPermissionState>()

  constructor(deps: AgentRuntimeServiceDeps) {
    this.deps = deps
    this.repository = deps.sessionRepository ?? new AgentSessionRepository({
      projectId: deps.projectId,
      conversations: deps.conversations,
      now: deps.now,
    })
    this.commandRouter = deps.providerConfig
      ? new AgentCommandRouter({
        projectId: deps.projectId,
        agentType: this.agentType(),
        providerConfig: deps.providerConfig,
        registeredPromptCommands: deps.registeredPromptCommands,
        agentNativeSlashAllowlist: deps.agentNativeSlashAllowlist,
        unknownSlashBehavior: deps.unknownSlashBehavior,
        resetSession: (message) => this.resetMessageSession(message),
      })
      : undefined
  }

  async send(message: AgentMessage): Promise<AgentRuntimeTurnResult> {
    if (message.projectId !== this.deps.projectId) {
      throw new Error(
        `AgentRuntime project mismatch: expected "${this.deps.projectId}", got "${message.projectId}"`,
      )
    }

    const conversation = await this.repository.getOrCreateActive(message)
    this.deps.replyTargets?.rememberReplyTarget(replyTargetFromMessage(message, conversation.id))
    const governance = this.deps.governance?.evaluateMessage(message)
    if (governance && !governance.allowed) {
      return this.finishWithError(message, conversation.id, governance.reason ?? "Message blocked")
    }

    const commandResult = await this.commandRouter?.handle(message, conversation)
    if (commandResult && isPromptCommandRoute(commandResult)) {
      message = {
        ...message,
        content: commandResult.content,
      }
    } else if (commandResult) {
      for (const event of commandResult.events) {
        this.emitEvent(message, commandResult.conversationId, event)
      }
      return commandResult
    }

    const state = this.stateFor(message)
    if (state.busy && state.queue.length >= this.queueLimit()) {
      return this.finishWithError(message, conversation.id, "Session queue is full")
    }

    return new Promise<AgentRuntimeTurnResult>((resolve) => {
      state.queue.push({
        message,
        conversationId: conversation.id,
        resolve,
      })
      if (!state.busy) {
        void this.processQueue(state)
      }
    })
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

  async listSessions(): Promise<readonly ConversationEntryV1[]> {
    return this.repository.listSessions()
  }

  async getSession(conversationIdValue: string): Promise<ConversationEntryV1 | null> {
    return this.repository.get(conversationIdValue)
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
    const state = this.states.get(runtimeKey(
      pending.sessionKey,
      pending.projectId,
      pending.workspaceKey,
    ))
    if (state?.pending?.requestId === request.requestId) {
      state.pending = undefined
    }
    pending.resolve()
  }

  async clearCurrentAgentSessionId(
    sessionKey: string,
    platform = "local",
    workspaceKey?: string,
  ): Promise<ConversationEntryV1 | null> {
    const conversation = await this.repository.getActive(sessionKey, platform, workspaceKey)
    if (!conversation) return null
    return this.repository.clearCurrentAgentSessionId(conversation.id, this.agentType())
  }

  async resetSession(
    sessionKey: string,
    platform = "local",
    workspaceKey?: string,
  ): Promise<ConversationEntryV1 | null> {
    const state = this.states.get(runtimeKey(sessionKey, this.deps.projectId, workspaceKey))
    if (state?.pending) {
      this.pendingPermissions.delete(state.pending.requestId)
      state.pending = undefined
    }
    if (state?.liveSession) {
      await state.liveSession.close()
      state.liveSession = undefined
    }
    return this.clearCurrentAgentSessionId(sessionKey, platform, workspaceKey)
  }

  async createSession(
    input: {
      readonly sessionKey: string
      readonly platform?: string
      readonly name?: string
    },
  ): Promise<ConversationEntryV1> {
    return this.repository.createSession({
      sessionKey: input.sessionKey,
      platform: input.platform,
      name: input.name,
      resumePolicy: "resume",
    })
  }

  async switchSession(
    sessionKey: string,
    conversationIdValue: string,
    platform?: string,
  ): Promise<ConversationEntryV1> {
    return this.repository.setActiveSession(sessionKey, conversationIdValue, platform)
  }

  async reapIdleWorkspaceRuntimes(
    idleTimeoutMs: number,
    nowMs = Date.now(),
  ): Promise<readonly string[]> {
    const cutoff = nowMs - idleTimeoutMs
    const reaped: string[] = []
    for (const [key, state] of this.states) {
      if (!state.workspaceKey || !state.workspacePath) continue
      if (state.busy || state.activeTurns > 0 || state.queue.length > 0) continue
      if (state.lastActivity >= cutoff) continue
      if (state.liveSession?.alive()) {
        await state.liveSession.close()
      }
      reaped.push(state.workspacePath)
      this.states.delete(key)
    }
    return reaped
  }

  async deleteSession(conversationIdValue: string): Promise<boolean> {
    const conversation = await this.repository.get(conversationIdValue)
    if (!conversation) return false
    if (conversation.active) {
      const state = this.states.get(runtimeKey(
        conversation.sessionKey,
        this.deps.projectId,
        conversation.workspaceKey,
      ))
      if (state?.pending) {
        this.pendingPermissions.delete(state.pending.requestId)
        state.pending = undefined
      }
      if (state?.liveSession) {
        await state.liveSession.close()
        state.liveSession = undefined
      }
      this.states.delete(runtimeKey(
        conversation.sessionKey,
        this.deps.projectId,
        conversation.workspaceKey,
      ))
    }
    await this.repository.deleteSession(conversationIdValue)
    return true
  }

  private async processQueue(state: RuntimeSessionState): Promise<void> {
    state.busy = true
    try {
      while (state.queue.length > 0) {
        const turn = state.queue.shift()
        if (!turn) continue
        try {
          const result = await this.processTurn(state, turn.message, turn.conversationId)
          turn.resolve(result)
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error)
          this.deps.logger?.warn("AgentRuntime queued turn failed.", {
            error: messageText,
            projectId: this.deps.projectId,
            sessionKey: turn.message.sessionKey,
          })
          turn.resolve(this.finishWithError(turn.message, turn.conversationId, messageText))
        }
      }
    } finally {
      state.busy = false
    }
  }

  private async processTurn(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversationIdValue: string,
  ): Promise<AgentRuntimeTurnResult> {
    state.activeTurns += 1
    state.lastActivity = Date.now()
    try {
      let conversation = await this.repository.get(conversationIdValue)
      if (!conversation) {
        conversation = await this.repository.getOrCreateActive(message)
      }
      conversation = await this.repository.appendHistory(conversation.id, "user", message.content)

      const workDir = this.workDirFor(message)
      if (!workDir) {
        return this.finishWithError(message, conversation.id, "Project workspace path is required")
      }

      const adapter = await this.resolveAdapter()
      if (adapter.startSession) {
        return this.processLiveTurn(state, message, conversation, adapter, workDir)
      }
      return this.processExecTurn(message, conversation, adapter, workDir)
    } finally {
      state.activeTurns = Math.max(0, state.activeTurns - 1)
      state.lastActivity = Date.now()
    }
  }

  private async processExecTurn(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    adapter: AgentAdapter,
    workDir: string,
  ): Promise<AgentRuntimeTurnResult> {
    const threadId = reusableAgentSessionId(conversation, adapter.agentType)
    const execution = await adapter.execute(message, {
      projectId: this.deps.projectId,
      workDir,
      threadId,
      agentSessionId: threadId,
      sessionEnv: this.deps.replyTargets?.getAgentEnv(this.deps.projectId, message.sessionKey),
      actor: { kind: "user" },
    })

    for (const event of execution.events) {
      this.emitEvent(message, conversation.id, event)
    }

    const saved = await this.saveExecutionResult(conversation, {
      resultText: execution.resultText,
      agentSessionId: execution.threadId ?? execution.agentSessionId,
      agentType: adapter.agentType,
    })

    return {
      conversationId: saved.id,
      events: execution.events,
      resultText: execution.resultText,
      agentSessionId: saved.agentSessionId,
      threadId: saved.agentSessionId,
      error: execution.error,
    }
  }

  private async processLiveTurn(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversation: ConversationEntryV1,
    adapter: AgentAdapter,
    workDir: string,
  ): Promise<AgentRuntimeTurnResult> {
    const liveSession = await this.getLiveSession(state, conversation, adapter, message, workDir)
    const events: AgentEvent[] = []
    let resultText = ""
    let error: string | undefined

    await liveSession.send(message)

    while (liveSession.alive()) {
      const event = await liveSession.nextEvent()
      if (!event) {
        error = "Agent session ended"
        break
      }
      events.push(event)
      this.emitEvent(message, conversation.id, event)
      await this.saveEventSessionId(conversation.id, event, liveSession, adapter.agentType)

      if (event.type === "permissionRequest") {
        await this.awaitPendingPermission(state, message, conversation.id, event, liveSession)
        continue
      }
      if (event.type === "result") {
        resultText = event.content
        break
      }
      if (event.type === "error") {
        error = event.message
        break
      }
    }

    const currentSessionId = liveSession.currentSessionId()
    const saved = await this.saveExecutionResult(conversation, {
      resultText,
      agentSessionId: currentSessionId,
      agentType: adapter.agentType,
    })

    return {
      conversationId: saved.id,
      events,
      resultText,
      agentSessionId: saved.agentSessionId,
      threadId: saved.agentSessionId,
      error,
    }
  }

  private async getLiveSession(
    state: RuntimeSessionState,
    conversation: ConversationEntryV1,
    adapter: AgentAdapter,
    message: AgentMessage,
    workDir: string,
  ): Promise<AgentLiveSession> {
    if (
      state.liveSession
      && state.liveSession.alive()
      && state.liveSession.agentType === adapter.agentType
    ) {
      return state.liveSession
    }

    if (state.liveSession) {
      await state.liveSession.close()
    }

    const agentSessionId = reusableAgentSessionId(conversation, adapter.agentType)
    const liveSession = await adapter.startSession?.({
      projectId: this.deps.projectId,
      workDir,
      threadId: agentSessionId,
      agentSessionId,
      sessionEnv: this.deps.replyTargets?.getAgentEnv(this.deps.projectId, message.sessionKey),
      actor: { kind: "user" },
    })
    if (!liveSession) {
      throw new Error("Agent adapter did not create a live session")
    }
    state.liveSession = liveSession
    return liveSession
  }

  private async awaitPendingPermission(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversationIdValue: string,
    event: AgentPermissionRequestEvent,
    liveSession: AgentLiveSession,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      const pending: PendingPermissionState = {
        requestId: event.requestId,
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
        workspaceKey: message.workspaceKey,
        workspacePath: message.workspacePath,
        conversationId: conversationIdValue,
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolInputRaw: event.toolInputRaw,
        createdAt: this.isoNow(),
        liveSession,
        resolve,
      }
      state.pending = pending
      this.pendingPermissions.set(event.requestId, pending)
    })
  }

  private async saveEventSessionId(
    conversationIdValue: string,
    event: AgentEvent,
    liveSession: AgentLiveSession,
    agentType: string,
  ): Promise<void> {
    const agentSessionId = event.agentSessionId ?? event.threadId ?? liveSession.currentSessionId()
    if (!agentSessionId) return
    await this.repository.saveAgentSession({
      conversationId: conversationIdValue,
      agentType,
      agentSessionId,
      resumePolicy: "resume",
    })
  }

  private async saveExecutionResult(
    conversation: ConversationEntryV1,
    execution: {
      readonly resultText: string
      readonly agentSessionId?: string
      readonly agentType: string
    },
  ): Promise<ConversationEntryV1> {
    let saved = conversation
    if (execution.agentSessionId) {
      saved = await this.repository.saveAgentSession({
        conversationId: conversation.id,
        agentType: execution.agentType,
        agentSessionId: execution.agentSessionId,
        resumePolicy: "resume",
      })
    }
    if (execution.resultText) {
      saved = await this.repository.appendHistory(saved.id, "assistant", execution.resultText)
    }
    return saved
  }

  private finishWithError(
    message: AgentMessage,
    conversationIdValue: string,
    error: string,
  ): AgentRuntimeTurnResult {
    const event: AgentEvent = { type: "error", message: error }
    this.emitEvent(message, conversationIdValue, event)
    return {
      conversationId: conversationIdValue,
      events: [event],
      resultText: "",
      error,
    }
  }

  private emitEvent(
    message: AgentMessage,
    conversationIdValue: string,
    event: AgentEvent,
  ): void {
    const target = replyTargetFromMessage(message, conversationIdValue, event)
    this.deps.eventBus?.emit({
      domain: "agent",
      type: event.type,
      payload: {
        event,
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
        platform: message.platform,
      },
      scope: { sessionId: conversationIdValue },
      timestamp: this.isoNow(),
    })
    this.deps.outbox?.recordAgentEvent(target, event)
    this.deps.replyTargets?.dispatchAgentEvent(target, event)
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

  private stateFor(message: AgentMessage): RuntimeSessionState {
    const key = runtimeKey(message.sessionKey, message.projectId, message.workspaceKey)
    const existing = this.states.get(key)
    if (existing) {
      existing.workspaceKey = message.workspaceKey ?? existing.workspaceKey
      existing.workspacePath = message.workspacePath ?? existing.workspacePath
      existing.lastActivity = Date.now()
      return existing
    }
    const state: RuntimeSessionState = {
      key,
      workspaceKey: message.workspaceKey,
      workspacePath: message.workspacePath,
      queue: [],
      busy: false,
      activeTurns: 0,
      lastActivity: Date.now(),
    }
    this.states.set(key, state)
    return state
  }

  private resetMessageSession(message: AgentMessage): Promise<ConversationEntryV1 | null> {
    return this.resetSession(message.sessionKey, message.platform, message.workspaceKey)
  }

  private workDirFor(message: AgentMessage): string | undefined {
    return message.workspacePath ?? this.deps.workDir
  }

  private queueLimit(): number {
    return this.deps.pendingQueueLimit ?? DEFAULT_PENDING_QUEUE_LIMIT
  }

  private async resolveAdapter(): Promise<AgentAdapter> {
    if (!this.deps.providerConfig || !this.deps.adapterFactory) {
      return this.deps.adapter
    }
    const view = await this.deps.providerConfig.resolveRuntimeConfig(
      this.deps.projectId,
      this.agentType(),
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

function reusableAgentSessionId(
  conversation: ConversationEntryV1,
  agentType: string,
): string | undefined {
  if (conversation.resumePolicy === "fresh") return undefined
  if (conversation.agentType && conversation.agentType !== agentType) return undefined
  return conversation.agentSessionId
}

function runtimeKey(sessionKey: string, projectId: string, workspaceKey?: string): string {
  return `${projectId}:${workspaceKey ?? "default"}:${sessionKey}`
}

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

function replyCtxRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function replyTargetFromMessage(
  message: AgentMessage,
  conversationIdValue: string,
  event?: AgentEvent,
): ReplyTarget {
  const replyCtx = replyCtxRecord(message.replyCtx)
  const kind = stringValue(replyCtx?.kind)
  const bridgePlatform = stringValue(replyCtx?.platform)
  return {
    projectId: message.projectId,
    sessionKey: message.sessionKey,
    conversationId: conversationIdValue,
    threadId: event?.threadId ?? event?.agentSessionId,
    messageId: message.messageId,
    transport: kind === "bridge"
      ? { kind: "bridge", connectorId: bridgePlatform ?? message.platform }
      : { kind: message.platform || kind || "local-renderer" },
    replyCtx,
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function isPromptCommandRoute(
  result: AgentCommandRouterResult,
): result is Extract<AgentCommandRouterResult, { kind: "prompt" }> {
  return "kind" in result && result.kind === "prompt"
}

export type { AgentGovernanceDecision }
