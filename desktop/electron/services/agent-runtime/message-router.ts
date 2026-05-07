import type {
  AgentCompressStateEntryV1,
  ConversationEntryV1,
  DataNamespace,
} from "../../runtime/data-repo"
import type { ScopedEventBus } from "../../runtime/project-container"
import type { ControlledProcessIsolationOptions } from "../../runtime/process"
import type { AuditSink } from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { ReplyOutboxService } from "../reply-target"
import type { ReplyTarget } from "../reply-target"
import type { ProcessIsolationResolver } from "../execution-isolation"
import type { AgentGovernanceService } from "./governance"
import type { AgentCommandRouter, AgentCommandRouterResult } from "./command-router"
import type { AgentSessionRepository } from "./session-repository"
import type {
  RuntimeSessionState,
  PendingPermissionState,
} from "./session-lifecycle"
import type { SessionLifecycleManager } from "./session-lifecycle"
import type {
  AgentAdapter,
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionRequestEvent,
  AgentRuntimeRelayResult,
  AgentRuntimeTurnResult,
} from "./types"

export interface MessageRouterDeps {
  readonly projectId: string
  readonly workDir?: string
  readonly eventBus?: ScopedEventBus
  readonly logger?: StructuredLogger
  readonly governance?: AgentGovernanceService
  readonly compressState?: DataNamespace<AgentCompressStateEntryV1>
  readonly pendingQueueLimit?: number
  readonly outbox?: ReplyOutboxService
  readonly auditSink?: AuditSink
  readonly executionIsolation?: ProcessIsolationResolver
  readonly replyTargets?: {
    rememberReplyTarget(target: ReplyTarget): void
    dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): void
    getAgentEnv(projectId: string, sessionKey: string): Record<string, string> | undefined
  }
  readonly now?: () => Date
}

export interface MessageRouterCallbacks {
  readonly stateForConversation: (conversationId: string, message?: AgentMessage) => RuntimeSessionState
  readonly resolveAdapter: (agentTypeOverride?: string) => Promise<AgentAdapter>
  readonly resolveProcessIsolation: (message: AgentMessage) => Promise<ControlledProcessIsolationOptions | undefined>
  readonly workDirFor: (message: AgentMessage) => string | undefined
  readonly getOrCreateCompressionState: (agentType: string) => Promise<AgentCompressStateEntryV1>
  readonly markCompressionState: (
    agentType: string,
    status: AgentCompressStateEntryV1["lastStatus"],
    error?: string,
  ) => Promise<void>
}

const DEFAULT_PENDING_QUEUE_LIMIT = 5

export class MessageRouter {
  private readonly deps: MessageRouterDeps
  private readonly repository: AgentSessionRepository
  private readonly commandRouter: AgentCommandRouter | undefined
  private readonly pendingPermissions: Map<string, PendingPermissionState>
  private readonly callbacks: MessageRouterCallbacks

  constructor(input: {
    deps: MessageRouterDeps
    repository: AgentSessionRepository
    commandRouter: AgentCommandRouter | undefined
    pendingPermissions: Map<string, PendingPermissionState>
    callbacks: MessageRouterCallbacks
  }) {
    this.deps = input.deps
    this.repository = input.repository
    this.commandRouter = input.commandRouter
    this.pendingPermissions = input.pendingPermissions
    this.callbacks = input.callbacks
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

    const state = this.callbacks.stateForConversation(conversation.id, message)
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

    const state = this.callbacks.stateForConversation(conversation.id, message)
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
    const state = this.callbacks.stateForConversation(conversation.id, message)
    if (state.busy) {
      return {
        ...this.finishWithError(message, conversation.id, "Relay session is busy"),
        timedOut: false,
      }
    }
    return this.processSideSessionWithTimeout(state, message, conversation, timeoutMs)
  }

  async compressSession(
    message: AgentMessage,
    conversation: ConversationEntryV1,
  ): Promise<AgentRuntimeTurnResult> {
    const state = this.callbacks.stateForConversation(conversation.id, message)
    if (state.busy) {
      return runtimeCommandResult(conversation.id, "Session is busy.", true, conversation.agentSessionId)
    }
    const workDir = this.callbacks.workDirFor(message)
    if (!workDir) {
      return runtimeCommandResult(conversation.id, "Project workspace path is required", true, conversation.agentSessionId)
    }
    state.busy = true
    try {
      const adapter = await this.callbacks.resolveAdapter(conversation.agentType)
      if (!adapter.compressionCommand || !adapter.startSession) {
        await this.callbacks.markCompressionState(adapter.agentType, "unsupported", "Compression is unsupported.")
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

      const workDir = this.callbacks.workDirFor(message)
      if (!workDir) {
        return this.finishWithError(message, conversation.id, "Project workspace path is required")
      }

      const adapter = await this.callbacks.resolveAdapter(conversation.agentType)
      if (!conversation.agentType && adapter.agentType) {
        conversation = await this.repository.saveAgentSession({
          conversationId: conversation.id,
          agentType: adapter.agentType,
        })
      }
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
      const workDir = this.callbacks.workDirFor(message)
      if (!workDir) {
        state.activeTurns = Math.max(0, state.activeTurns - 1)
        state.busy = false
        state.lastActivity = Date.now()
        return {
          ...this.finishWithError(message, conversation.id, "Project workspace path is required"),
          timedOut: false,
        }
      }
      const adapter = await this.callbacks.resolveAdapter(savedConversation.agentType)
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
      processIsolation: await this.callbacks.resolveProcessIsolation(message),
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
      processIsolation: await this.callbacks.resolveProcessIsolation(message),
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
      processIsolation: await this.callbacks.resolveProcessIsolation(message),
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

  finishWithError(
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

  emitEvent(
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

  emitConversationUpdated(conversation: ConversationEntryV1): void {
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

  private async maybeAutoCompress(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversation: ConversationEntryV1,
    adapter: AgentAdapter,
    liveSession: AgentLiveSession,
  ): Promise<void> {
    if (!this.deps.compressState || !adapter.compressionCommand) return
    const config = await this.callbacks.getOrCreateCompressionState(adapter.agentType)
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
        await this.callbacks.markCompressionState(adapter.agentType, "failed", result.error)
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      await this.callbacks.markCompressionState(adapter.agentType, "failed", messageText)
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
      await this.callbacks.markCompressionState(input.adapter.agentType, "unsupported", "Compression is unsupported.")
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
    await this.callbacks.markCompressionState(
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

  private queueLimit(): number {
    return this.deps.pendingQueueLimit ?? DEFAULT_PENDING_QUEUE_LIMIT
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

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



















