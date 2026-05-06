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
  AgentCommandRouterResult,
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
import type {
  AgentAdapter,
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPendingPermission,
  AgentPermissionRequestEvent,
  AgentPermissionResponseRequest,
  AgentRuntimeRelayResult,
  AgentRuntimeTurnResult,
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
  readonly stateKey: string
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
          this.compressSession(message, conversation),
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

    const state = this.stateForConversation(conversation.id, message)
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

  async sendNewSession(
    message: AgentMessage,
    name: string,
  ): Promise<AgentRuntimeTurnResult> {
    if (message.projectId !== this.deps.projectId) {
      throw new Error(
        `AgentRuntime project mismatch: expected "${this.deps.projectId}", got "${message.projectId}"`,
      )
    }

    const conversation = await this.repository.createSideSession({
      sessionKey: message.sessionKey,
      platform: message.platform,
      channelKey: message.channelKey,
      workspaceKey: message.workspaceKey,
      workspacePath: message.workspacePath,
      name,
      userMeta: {
        userId: message.userId,
        userName: message.userName,
        chatName: message.chatName,
        platform: message.platform,
        channelKey: message.channelKey,
        workspaceKey: message.workspaceKey,
        workspacePath: message.workspacePath,
      },
      resumePolicy: "fresh",
    })
    this.deps.replyTargets?.rememberReplyTarget(replyTargetFromMessage(message, conversation.id))
    const governance = this.deps.governance?.evaluateMessage(message)
    if (governance && !governance.allowed) {
      return this.finishWithError(message, conversation.id, governance.reason ?? "Message blocked")
    }

    const state = this.stateForConversation(conversation.id, message)
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

  async sendSideSessionWithTimeout(
    message: AgentMessage,
    name: string,
    timeoutMs: number,
  ): Promise<AgentRuntimeRelayResult> {
    if (message.projectId !== this.deps.projectId) {
      throw new Error(
        `AgentRuntime project mismatch: expected "${this.deps.projectId}", got "${message.projectId}"`,
      )
    }

    const conversation = await this.repository.createSideSession({
      sessionKey: message.sessionKey,
      platform: message.platform,
      channelKey: message.channelKey,
      workspaceKey: message.workspaceKey,
      workspacePath: message.workspacePath,
      name,
      userMeta: {
        userId: message.userId,
        userName: message.userName,
        chatName: message.chatName,
        platform: message.platform,
        channelKey: message.channelKey,
        workspaceKey: message.workspaceKey,
        workspacePath: message.workspacePath,
      },
      resumePolicy: "fresh",
    })
    const state = this.stateForConversation(conversation.id, message)
    if (state.busy) {
      return {
        ...this.finishWithError(message, conversation.id, "Relay session is busy"),
        timedOut: false,
      }
    }
    return this.processSideSessionWithTimeout(state, message, conversation, timeoutMs)
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

  async getActiveAgentType(): Promise<string> {
    if (!this.deps.providerConfig) return this.agentType()
    return this.deps.providerConfig.getActiveAgentType(this.deps.projectId, this.agentType())
  }

  async listSessions(): Promise<readonly ConversationEntryV1[]> {
    return this.repository.listSessions()
  }

  async getSession(conversationIdValue: string): Promise<ConversationEntryV1 | null> {
    return this.repository.get(conversationIdValue)
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
    const conversation = await this.repository.getActive(sessionKey, platform, workspaceKey)
    if (!conversation) return null
    return this.repository.clearCurrentAgentSessionId(conversation.id, await this.getActiveAgentType())
  }

  async resetSession(
    sessionKey: string,
    platform = "local",
    workspaceKey?: string,
  ): Promise<ConversationEntryV1 | null> {
    const conversation = await this.repository.getActive(sessionKey, platform, workspaceKey)
    if (conversation) {
      const state = this.states.get(conversation.id)
      if (state?.pending) {
        this.pendingPermissions.delete(state.pending.requestId)
        state.pending = undefined
      }
      if (state?.liveSession) {
        await state.liveSession.close()
        state.liveSession = undefined
      }
    }
    return this.clearCurrentAgentSessionId(sessionKey, platform, workspaceKey)
  }

  async createSession(
    input: {
      readonly sessionKey: string
      readonly platform?: string
      readonly name?: string
      readonly workspaceKey?: string
      readonly workspacePath?: string
    },
  ): Promise<ConversationEntryV1> {
    await this.closeIdleStateForConversation(input.sessionKey, input.platform, input.workspaceKey)
    return this.repository.createSession({
      sessionKey: input.sessionKey,
      platform: input.platform,
      name: input.name,
      workspaceKey: input.workspaceKey,
      workspacePath: input.workspacePath,
      resumePolicy: "resume",
    })
  }

  async switchSession(
    sessionKey: string,
    conversationIdValue: string,
    platform?: string,
    workspaceKey?: string,
  ): Promise<ConversationEntryV1> {
    const target = await this.repository.get(conversationIdValue)
    if (!target || target.sessionKey !== sessionKey) {
      throw new Error(`Conversation "${conversationIdValue}" is not available for this session key`)
    }
    const effectiveWorkspaceKey = workspaceKey ?? target.workspaceKey
    const active = await this.repository.getActive(sessionKey, platform, effectiveWorkspaceKey)
    if (active?.id !== target.id) {
      await this.closeIdleStateForConversation(sessionKey, platform, effectiveWorkspaceKey)
    }
    return this.repository.setActiveSession(sessionKey, conversationIdValue, platform, effectiveWorkspaceKey)
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
    const state = this.states.get(conversationIdValue)
    if (state) {
      if (state.busy || state.activeTurns > 0 || state.queue.length > 0) {
        throw new Error("Session is busy.")
      }
      if (state.pending) {
        this.pendingPermissions.delete(state.pending.requestId)
        state.pending = undefined
      }
      if (state.liveSession) {
        await state.liveSession.close()
        state.liveSession = undefined
      }
      this.states.delete(conversationIdValue)
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
      this.deps.logger?.info("Agent conversation updated after user message.", {
        ...conversationLogContext(this.deps.projectId, conversation),
        contentLength: message.content.length,
        attachmentCount: message.attachments?.length ?? 0,
        messageId: message.messageId,
      })
      this.emitConversationUpdated(conversation)

      const workDir = this.workDirFor(message)
      if (!workDir) {
        return this.finishWithError(message, conversation.id, "Project workspace path is required")
      }

      const adapter = await this.resolveAdapter(conversation.agentType)
      if (adapter.startSession) {
        try {
          return await this.processLiveTurn(state, message, conversation, adapter, workDir)
        } catch (error) {
          if (adapter.agentType !== "codex" || !isLiveStartupFailure(error)) throw error
          const messageText = error instanceof Error ? error.message : String(error)
          this.deps.logger?.warn("Agent live session failed; falling back to exec.", {
            error: messageText,
            projectId: this.deps.projectId,
            sessionKey: message.sessionKey,
            agentType: adapter.agentType,
          })
        }
      }
      return this.processExecTurn(message, conversation, adapter, workDir)
    } finally {
      state.activeTurns = Math.max(0, state.activeTurns - 1)
      state.lastActivity = Date.now()
    }
  }

  private async processSideSessionWithTimeout(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversation: ConversationEntryV1,
    timeoutMs: number,
  ): Promise<AgentRuntimeRelayResult> {
    state.busy = true
    state.activeTurns += 1
    state.lastActivity = Date.now()
    let savedConversation = conversation
    try {
      savedConversation = await this.repository.appendHistory(conversation.id, "user", message.content)
      const workDir = this.workDirFor(message)
      if (!workDir) {
        state.activeTurns = Math.max(0, state.activeTurns - 1)
        state.busy = false
        state.lastActivity = Date.now()
        return {
          ...this.finishWithError(message, conversation.id, "Project workspace path is required"),
          timedOut: false,
        }
      }
      const adapter = await this.resolveAdapter(savedConversation.agentType)
      if (adapter.startSession) {
        return this.processLiveSideSessionWithTimeout(
          state,
          message,
          savedConversation,
          adapter,
          workDir,
          timeoutMs,
        )
      }
      return this.processExecSideSessionWithTimeout(
        state,
        message,
        savedConversation,
        adapter,
        workDir,
        timeoutMs,
      )
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      state.activeTurns = Math.max(0, state.activeTurns - 1)
      state.busy = false
      state.lastActivity = Date.now()
      return {
        ...this.finishWithError(message, savedConversation.id, messageText),
        timedOut: false,
      }
    }
  }

  private async processExecSideSessionWithTimeout(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversation: ConversationEntryV1,
    adapter: AgentAdapter,
    workDir: string,
    timeoutMs: number,
  ): Promise<AgentRuntimeRelayResult> {
    const events: AgentEvent[] = []
    let partialText = ""
    const executionPromise = adapter.execute(message, {
      projectId: this.deps.projectId,
      workDir,
      sessionEnv: this.deps.replyTargets?.getAgentEnv(this.deps.projectId, message.sessionKey),
      processIsolation: await this.resolveProcessIsolation(message),
      actor: { kind: "agent", id: "relay" },
      onEvent: (event) => {
        events.push(event)
        partialText = appendRelayText(partialText, event)
        this.emitEvent(message, conversation.id, event)
      },
    })
    const execution = await promiseWithTimeout(executionPromise, timeoutMs)
    if (!execution) {
      void executionPromise
        .then((finalExecution) => this.finishExecSideSession(
          state,
          conversation,
          adapter,
          finalExecution.resultText,
          finalExecution.threadId ?? finalExecution.agentSessionId,
        ))
        .catch((error) => {
          this.deps.logger?.warn("Relay exec drain failed.", {
            error: error instanceof Error ? error.message : String(error),
            projectId: this.deps.projectId,
            sessionKey: message.sessionKey,
          })
          state.activeTurns = Math.max(0, state.activeTurns - 1)
          state.busy = false
          state.lastActivity = Date.now()
        })
      return {
        conversationId: conversation.id,
        events,
        resultText: partialText,
        partialText,
        timedOut: true,
      }
    }
    await this.saveEventHistory(conversation.id, execution.events)
    const saved = await this.finishExecSideSession(
      state,
      conversation,
      adapter,
      execution.resultText,
      execution.threadId ?? execution.agentSessionId,
    )
    return {
      conversationId: saved.id,
      events: execution.events,
      resultText: execution.resultText,
      agentSessionId: saved.agentSessionId,
      threadId: saved.agentSessionId,
      error: execution.error,
      timedOut: false,
    }
  }

  private async finishExecSideSession(
    state: RuntimeSessionState,
    conversation: ConversationEntryV1,
    adapter: AgentAdapter,
    resultText: string,
    agentSessionId?: string,
  ): Promise<ConversationEntryV1> {
    try {
      return await this.saveExecutionResult(conversation, {
        resultText,
        agentSessionId,
        agentType: adapter.agentType,
      })
    } finally {
      state.activeTurns = Math.max(0, state.activeTurns - 1)
      state.busy = false
      state.lastActivity = Date.now()
    }
  }

  private async processLiveSideSessionWithTimeout(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversation: ConversationEntryV1,
    adapter: AgentAdapter,
    workDir: string,
    timeoutMs: number,
  ): Promise<AgentRuntimeRelayResult> {
    const liveSession = await this.getLiveSession(state, conversation, adapter, message, workDir)
    const events: AgentEvent[] = []
    let resultText = ""
    let partialText = ""
    let error: string | undefined
    const deadline = Date.now() + timeoutMs

    await liveSession.send(message)

    while (liveSession.alive()) {
      const remaining = Math.max(1, deadline - Date.now())
      const event = await nextLiveEventWithTimeout(liveSession, remaining)
      if (!event) {
        void this.drainLiveSideSession(state, message, conversation, adapter, liveSession)
        return {
          conversationId: conversation.id,
          events,
          resultText: partialText,
          partialText,
          agentSessionId: liveSession.currentSessionId(),
          threadId: liveSession.currentSessionId(),
          timedOut: true,
        }
      }
      events.push(event)
      partialText = appendRelayText(partialText, event)
      this.emitEvent(message, conversation.id, event)
      await this.saveEventSessionId(conversation.id, event, liveSession, adapter.agentType)
      await this.saveEventHistory(conversation.id, event)

      if (event.type === "permissionRequest") {
        await liveSession.respondPermission(event.requestId, {
          behavior: "deny",
          message: "Relay cannot approve tool permissions.",
        })
        error = "Relay requested permission."
        break
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
    state.activeTurns = Math.max(0, state.activeTurns - 1)
    state.busy = false
    state.lastActivity = Date.now()
    return {
      conversationId: saved.id,
      events,
      resultText,
      agentSessionId: saved.agentSessionId,
      threadId: saved.agentSessionId,
      error,
      timedOut: false,
    }
  }

  private async drainLiveSideSession(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversation: ConversationEntryV1,
    adapter: AgentAdapter,
    liveSession: AgentLiveSession,
  ): Promise<void> {
    let resultText = ""
    try {
      while (liveSession.alive()) {
        const event = await liveSession.nextEvent()
        if (!event) break
        this.emitEvent(message, conversation.id, event)
        await this.saveEventSessionId(conversation.id, event, liveSession, adapter.agentType)
        await this.saveEventHistory(conversation.id, event)
        if (event.type === "permissionRequest") {
          await liveSession.respondPermission(event.requestId, {
            behavior: "deny",
            message: "Relay cannot approve tool permissions.",
          })
          break
        }
        if (event.type === "result") {
          resultText = event.content
          break
        }
        if (event.type === "error") {
          break
        }
      }
      await this.saveExecutionResult(conversation, {
        resultText,
        agentSessionId: liveSession.currentSessionId(),
        agentType: adapter.agentType,
      })
    } catch (error) {
      this.deps.logger?.warn("Relay live drain failed.", {
        error: error instanceof Error ? error.message : String(error),
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
      })
    } finally {
      state.activeTurns = Math.max(0, state.activeTurns - 1)
      state.busy = false
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
    const streamedEvents = new WeakSet<AgentEvent>()
    const execution = await adapter.execute(message, {
      projectId: this.deps.projectId,
      workDir,
      threadId,
      agentSessionId: threadId,
      sessionEnv: this.deps.replyTargets?.getAgentEnv(this.deps.projectId, message.sessionKey),
      processIsolation: await this.resolveProcessIsolation(message),
      actor: { kind: "user" },
      onEvent: (event) => {
        streamedEvents.add(event)
        this.emitEvent(message, conversation.id, event)
      },
    })

    for (const event of execution.events) {
      if (streamedEvents.has(event)) continue
      this.emitEvent(message, conversation.id, event)
    }
    await this.saveEventHistory(conversation.id, execution.events)

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
      await this.saveEventHistory(conversation.id, event)

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
    await this.maybeAutoCompress(state, message, saved, adapter, liveSession)

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
      processIsolation: await this.resolveProcessIsolation(message),
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
        stateKey: state.key,
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

  private async saveEventHistory(
    conversationIdValue: string,
    events: AgentEvent | readonly AgentEvent[],
  ): Promise<void> {
    const eventList = Array.isArray(events) ? events : [events]
    for (const event of eventList) {
      const entry = historyEntryForAgentEvent(event)
      if (!entry) continue
      await this.repository.appendHistory(
        conversationIdValue,
        entry.role,
        entry.content,
        entry.metadata,
      )
    }
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
    if (execution.agentSessionId || execution.resultText) {
      this.emitConversationUpdated(saved)
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
    this.deps.logger?.debug("Agent stream event emitted.", {
      projectId: this.deps.projectId,
      conversationId: conversationIdValue,
      sessionKey: message.sessionKey,
      platform: message.platform,
      eventType: event.type,
      messageId: message.messageId,
    })
    if (shouldSuppressReply(message)) return
    this.deps.outbox?.recordAgentEvent(target, event)
    this.deps.replyTargets?.dispatchAgentEvent(target, event)
  }

  private emitConversationUpdated(conversation: ConversationEntryV1): void {
    this.deps.logger?.info("Agent conversation update event emitted.", conversationLogContext(
      this.deps.projectId,
      conversation,
    ))
    this.deps.eventBus?.emit({
      domain: "agent",
      type: "conversationUpdated",
      payload: {
        projectId: this.deps.projectId,
        sessionKey: conversation.sessionKey,
        platform: conversation.platform ?? "local",
        conversationId: conversation.id,
      },
      scope: { sessionId: conversation.id },
      timestamp: this.isoNow(),
    })
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
    const existing = this.states.get(conversationIdValue)
    if (existing) {
      if (message) {
        existing.workspaceKey = message.workspaceKey ?? existing.workspaceKey
        existing.workspacePath = message.workspacePath ?? existing.workspacePath
      }
      existing.lastActivity = Date.now()
      return existing
    }
    const state: RuntimeSessionState = {
      key: conversationIdValue,
      workspaceKey: message?.workspaceKey,
      workspacePath: message?.workspacePath,
      queue: [],
      busy: false,
      activeTurns: 0,
      lastActivity: Date.now(),
    }
    this.states.set(conversationIdValue, state)
    return state
  }

  private async closeIdleStateForConversation(
    sessionKey: string,
    platform?: string,
    workspaceKey?: string,
  ): Promise<void> {
    const conversation = await this.repository.getActive(sessionKey, platform, workspaceKey)
    if (!conversation) return
    const state = this.states.get(conversation.id)
    if (!state) return
    if (state.busy || state.activeTurns > 0 || state.queue.length > 0) {
      throw new Error("Session is busy.")
    }
    if (state.pending) {
      this.pendingPermissions.delete(state.pending.requestId)
      state.pending = undefined
    }
    if (state.liveSession) {
      await state.liveSession.close()
      state.liveSession = undefined
    }
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

  private async compressSession(
    message: AgentMessage,
    conversation: ConversationEntryV1,
  ): Promise<AgentRuntimeTurnResult> {
    const state = this.stateForConversation(conversation.id, message)
    if (state.busy) {
      return runtimeCommandResult(conversation.id, "Session is busy.", true, conversation.agentSessionId)
    }
    const workDir = this.workDirFor(message)
    if (!workDir) {
      return runtimeCommandResult(conversation.id, "Project workspace path is required", true, conversation.agentSessionId)
    }
    state.busy = true
    try {
      const adapter = await this.resolveAdapter(conversation.agentType)
      if (!adapter.compressionCommand || !adapter.startSession) {
        await this.markCompressionState(adapter.agentType, "unsupported", "Compression is unsupported.")
        return runtimeCommandResult(
          conversation.id,
          `Compression is unsupported for ${adapter.agentType}.`,
          true,
          conversation.agentSessionId,
        )
      }
      const liveSession = await this.getLiveSession(state, conversation, adapter, message, workDir)
      const result = await this.runCompression({
        state,
        message,
        conversation,
        adapter,
        liveSession,
        reason: "manual",
      })
      if (result.error) {
        return runtimeCommandResult(conversation.id, result.error, true, liveSession.currentSessionId())
      }
      return runtimeCommandResult(
        conversation.id,
        result.resultText || "Context compressed.",
        false,
        liveSession.currentSessionId(),
      )
    } finally {
      state.busy = false
      state.lastActivity = Date.now()
    }
  }

  private async maybeAutoCompress(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversation: ConversationEntryV1,
    adapter: AgentAdapter,
    liveSession: AgentLiveSession,
  ): Promise<void> {
    if (!this.deps.compressState || !adapter.compressionCommand) return
    const config = await this.getOrCreateCompressionState(adapter.agentType)
    if (!config.enabled) return
    if (estimateTokens(conversation) < config.maxTokens) return
    if (!minGapElapsed(config.lastCompressedAt, config.minGapMins)) return
    try {
      const result = await this.runCompression({
        state,
        message,
        conversation,
        adapter,
        liveSession,
        reason: "auto",
      })
      if (result.error) {
        await this.markCompressionState(adapter.agentType, "failed", result.error)
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      await this.markCompressionState(adapter.agentType, "failed", messageText)
      this.deps.logger?.warn("Auto-compress failed.", {
        error: messageText,
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
      })
    }
  }

  private async runCompression(input: {
    readonly state: RuntimeSessionState
    readonly message: AgentMessage
    readonly conversation: ConversationEntryV1
    readonly adapter: AgentAdapter
    readonly liveSession: AgentLiveSession
    readonly reason: "manual" | "auto"
  }): Promise<{ readonly resultText: string; readonly error?: string }> {
    const command = input.adapter.compressionCommand
    if (!command) {
      await this.markCompressionState(input.adapter.agentType, "unsupported", "Compression is unsupported.")
      return { resultText: "", error: "Compression is unsupported." }
    }
    const events: AgentEvent[] = []
    let resultText = ""
    let error: string | undefined
    await input.liveSession.send({
      ...input.message,
      content: command,
      replyCtx: { ...(replyCtxRecord(input.message.replyCtx) ?? {}), muted: true },
    })
    while (input.liveSession.alive()) {
      const event = await nextLiveEventWithTimeout(input.liveSession, 5 * 60_000)
      if (!event) {
        error = "Compression timed out"
        break
      }
      events.push(event)
      await this.saveEventSessionId(
        input.conversation.id,
        event,
        input.liveSession,
        input.adapter.agentType,
      )
      if (event.type === "permissionRequest") {
        await input.liveSession.respondPermission(event.requestId, {
          behavior: "deny",
          message: "Compression cannot request tool permissions.",
        })
        error = "Compression requested permission."
        break
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
    await this.markCompressionState(
      input.adapter.agentType,
      error ? "failed" : "success",
      error,
    )
    this.deps.auditSink?.record({
      action: "agent.spawn",
      actor: { kind: "agent", id: "compress" },
      resource: command,
      outcome: error ? "failed" : "allowed",
      metadata: {
        projectId: this.deps.projectId,
        sessionKey: input.message.sessionKey,
        conversationId: input.conversation.id,
        reason: input.reason,
        eventCount: events.length,
        error,
      },
    })
    return { resultText, error }
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

  private queueLimit(): number {
    return this.deps.pendingQueueLimit ?? DEFAULT_PENDING_QUEUE_LIMIT
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

function reusableAgentSessionId(
  conversation: ConversationEntryV1,
  agentType: string,
): string | undefined {
  if (conversation.resumePolicy === "fresh") return undefined
  if (conversation.agentType && conversation.agentType !== agentType) return undefined
  return conversation.agentSessionId
}

function isLiveStartupFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\bEPIPE\b/.test(message)
    || message.includes("Process session is not running")
    || message.includes("app-server exited")
    || message.includes("ENOENT")
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

function shouldSuppressReply(message: AgentMessage): boolean {
  return replyCtxRecord(message.replyCtx)?.muted === true
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
    metadata: {
      channelKey: message.channelKey,
      channelName: message.channelName,
      workspaceKey: message.workspaceKey,
      workspacePath: message.workspacePath,
      muted: replyCtx?.muted,
    },
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

function runtimeCommandResult(
  conversationId: string,
  content: string,
  isError = false,
  agentSessionId?: string,
): AgentRuntimeTurnResult {
  const event: AgentEvent = isError
    ? { type: "error", message: content }
    : { type: "result", content, done: true, agentSessionId, threadId: agentSessionId }
  return {
    conversationId,
    events: [event],
    resultText: isError ? "" : content,
    agentSessionId,
    threadId: agentSessionId,
    error: isError ? content : undefined,
  }
}

function compressionStateId(projectId: string, agentType: string): string {
  return `compress:${projectId}:${agentType}`
}

function historyEntryForAgentEvent(event: AgentEvent): Pick<
  ConversationEntryV1["history"][number],
  "role" | "content" | "metadata"
> | null {
  switch (event.type) {
    case "toolUse":
      return {
        role: "tool",
        content: event.toolInput ? `${event.toolName}\n${event.toolInput}` : event.toolName,
        metadata: compactMetadata({
          agentEventType: event.type,
          agentSessionId: event.agentSessionId,
          threadId: event.threadId,
          toolName: event.toolName,
          toolInputRaw: event.toolInputRaw,
        }),
      }
    case "toolResult":
      return {
        role: "tool",
        content: event.content?.trim() || event.toolName,
        metadata: compactMetadata({
          agentEventType: event.type,
          agentSessionId: event.agentSessionId,
          threadId: event.threadId,
          toolName: event.toolName,
          status: event.status,
          exitCode: event.exitCode,
          success: event.success,
        }),
      }
    case "thinking":
      return {
        role: "system",
        content: event.content,
        metadata: compactMetadata({
          agentEventType: event.type,
          agentSessionId: event.agentSessionId,
          threadId: event.threadId,
        }),
      }
    case "permissionRequest":
      return {
        role: "system",
        content: event.toolInput ? `${event.toolName}\n${event.toolInput}` : event.toolName,
        metadata: compactMetadata({
          agentEventType: event.type,
          agentSessionId: event.agentSessionId,
          threadId: event.threadId,
          requestId: event.requestId,
          toolName: event.toolName,
          toolInputRaw: event.toolInputRaw,
          questions: event.questions,
        }),
      }
    case "error":
      return {
        role: "system",
        content: event.message,
        metadata: compactMetadata({
          agentEventType: event.type,
          agentSessionId: event.agentSessionId,
          threadId: event.threadId,
        }),
      }
    case "text":
    case "result":
      return null
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

function compactMetadata(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  )
}

function estimateTokens(conversation: ConversationEntryV1): number {
  const chars = conversation.history.reduce((total, entry) => total + entry.content.length, 0)
  return Math.ceil(chars / 4)
}

function conversationLogContext(
  projectId: string,
  conversation: ConversationEntryV1,
): Record<string, unknown> {
  return {
    projectId,
    conversationId: conversation.id,
    sessionKey: conversation.sessionKey,
    platform: conversation.platform ?? "local",
    channelKey: conversation.channelKey,
    workspaceKey: conversation.workspaceKey,
    workspacePath: conversation.workspacePath,
    active: conversation.active,
    historyCount: conversation.history.length,
    updatedAt: conversation.updatedAt,
  }
}

function minGapElapsed(lastCompressedAt: string | undefined, minGapMins: number): boolean {
  if (!lastCompressedAt) return true
  const last = Date.parse(lastCompressedAt)
  if (!Number.isFinite(last)) return true
  return Date.now() - last >= minGapMins * 60_000
}

async function nextLiveEventWithTimeout(
  liveSession: AgentLiveSession,
  timeoutMs: number,
): Promise<AgentEvent | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      liveSession.nextEvent(),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function appendRelayText(current: string, event: AgentEvent): string {
  if (event.type === "text" || event.type === "result") {
    return `${current}${event.content}`
  }
  if (event.type === "error" && !current) return event.message
  return current
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
