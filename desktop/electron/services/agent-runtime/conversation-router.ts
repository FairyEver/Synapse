import { randomUUID } from "node:crypto"

import type {
  AgentEventEntryV1,
  ConversationEntryV1,
  DataNamespace,
} from "../../runtime/data-repo"
import type { ScopedEventBus } from "../../runtime/project-container"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { ReplyOutboxService, ReplyTarget } from "../reply-target"
import type { AgentCommandRouter, AgentCommandRouterResult } from "./command-router"
import type { AgentGovernanceService } from "./governance"
import type { AgentSessionRepository } from "./session-repository"
import type { SessionManager } from "./session-manager"
import type { AgentProjectAfterTurnInput, AgentProjectAfterTurnOutput } from "./project-contributions"
import type {
  PendingPermissionState,
  RuntimeSessionState,
} from "./session-lifecycle"
import type {
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionRequestEvent,
  AgentRuntimeRelayResult,
  AgentRuntimeTurnResult,
} from "./types"

export interface ConversationRouterDeps {
  readonly projectId: string
  readonly workDir?: string
  readonly eventBus?: ScopedEventBus
  readonly logger?: StructuredLogger
  readonly governance?: AgentGovernanceService
  readonly pendingQueueLimit?: number
  readonly outbox?: ReplyOutboxService
  readonly replyTargets?: {
    rememberReplyTarget(target: ReplyTarget): void
    dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): Promise<void>
  }
  readonly agentEvents?: DataNamespace<AgentEventEntryV1>
  readonly now?: () => Date
  readonly permissionTimeoutMs?: number
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly prepareMessage?: (
    message: AgentMessage,
    context: {
      readonly isNewLiveSession: boolean
      readonly conversationId: string
      readonly turnId: string
    },
  ) => AgentMessage | Promise<AgentMessage>
  readonly afterTurn?: (input: AgentProjectAfterTurnInput) =>
    void | AgentProjectAfterTurnOutput | Promise<void | AgentProjectAfterTurnOutput>
}

const DEFAULT_PENDING_QUEUE_LIMIT = 5
const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_LIVE_EVENT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_EVENT_PAYLOAD_BYTES = 8192
const MAX_SUMMARY_LENGTH = 1000
const MAX_HISTORY_CONTENT_LENGTH = 10_000
const SENSITIVE_ERROR_ASSIGNMENT_PATTERN = /\b(secret|token|api[-_]?key|authorization|cookie|password|credential)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi

export class ConversationRouter {
  private readonly deps: ConversationRouterDeps
  private readonly repository: AgentSessionRepository
  private readonly sessionManager: SessionManager
  private readonly commandRouter: AgentCommandRouter | undefined
  private readonly pendingPermissions: Map<string, PendingPermissionState>
  private readonly permissionTimeoutMs: number
  private readonly liveMessages = new WeakMap<object, AgentMessage>()

  constructor(input: {
    readonly deps: ConversationRouterDeps
    readonly repository: AgentSessionRepository
    readonly sessionManager: SessionManager
    readonly commandRouter: AgentCommandRouter | undefined
    readonly pendingPermissions: Map<string, PendingPermissionState>
  }) {
    this.deps = input.deps
    this.repository = input.repository
    this.sessionManager = input.sessionManager
    this.commandRouter = input.commandRouter
    this.pendingPermissions = input.pendingPermissions
    this.permissionTimeoutMs = input.deps.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS
  }

  async send(
    message: AgentMessage,
    options: { readonly abortSignal?: AbortSignal; readonly liveEventTimeoutMs?: number } = {},
  ): Promise<AgentRuntimeTurnResult> {
    this.assertProject(message)
    const conversation = await this.getOrCreateConversation(message)
    return this.enqueueTurn(message, conversation, options)
  }

  async sendToConversation(
    message: AgentMessage,
    conversationId: string,
    options: { readonly abortSignal?: AbortSignal; readonly liveEventTimeoutMs?: number } = {},
  ): Promise<AgentRuntimeTurnResult> {
    this.assertProject(message)
    const conversation = await this.repository.get(conversationId)
    if (!conversation) {
      throw new Error(`Conversation "${conversationId}" not found`)
    }
    const effectiveConversation = message.modeOverride
      ? await this.repository.savePermissionMode(conversation.id, message.modeOverride)
      : conversation
    return this.enqueueTurn(message, effectiveConversation, options)
  }

  async sendNewSession(
    message: AgentMessage,
    name: string,
    options: { readonly abortSignal?: AbortSignal; readonly liveEventTimeoutMs?: number } = {},
  ): Promise<AgentRuntimeTurnResult> {
    this.assertProject(message)
    const providerId = await this.resolveNewConversationProviderId(message)
    const conversation = await this.repository.createSideSession({
      sessionKey: message.sessionKey,
      platform: message.platform,
      channelKey: message.channelKey,
      workspaceKey: message.workspaceKey,
      workspacePath: message.workspacePath,
      agentType: "claude-sdk",
      providerId,
      mode: message.modeOverride,
      modelTier: message.modelTier,
      name,
      userMeta: userMetaFromMessage(message),
      resumePolicy: "fresh",
    })
    return this.enqueueTurn({ ...message, providerId }, conversation, options)
  }

  async sendSideSessionWithTimeout(
    message: AgentMessage,
    name: string,
    timeoutMs: number,
  ): Promise<AgentRuntimeRelayResult> {
    this.assertProject(message)

    const governance = this.deps.governance?.evaluateMessage(message)
    if (governance && !governance.allowed) {
      return {
        ...this.finishWithError(message, "", governance.reason ?? "Message blocked"),
        timedOut: false,
      }
    }

    const ac = new AbortController()
    const providerId = await this.resolveNewConversationProviderId(message)
    const conversation = await this.repository.createSideSession({
      sessionKey: message.sessionKey,
      platform: message.platform,
      channelKey: message.channelKey,
      workspaceKey: message.workspaceKey,
      workspacePath: message.workspacePath,
      agentType: "claude-sdk",
      providerId,
      mode: message.modeOverride,
      modelTier: message.modelTier,
      name,
      userMeta: userMetaFromMessage(message),
      resumePolicy: "fresh",
    })
    const state = this.sessionManager.stateForConversation(conversation.id, message)
    if (state.busy) {
      return {
        ...this.finishWithError(message, conversation.id, "Relay session is busy"),
        timedOut: false,
      }
    }

    const timeout = setTimeout(() => ac.abort("relay-timeout"), timeoutMs)
    try {
      return await this.processSideSessionWithTimeout(
        state,
        { ...message, providerId },
        conversation,
        timeoutMs,
        ac.signal,
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async compressSession(
    message: AgentMessage,
    conversation: ConversationEntryV1,
  ): Promise<AgentRuntimeTurnResult> {
    return this.finishWithError(message, conversation.id, "Compression is unsupported for SDK sessions.")
  }

  clearCancelState(state: RuntimeSessionState): void {
    if (state.cancelState?.escalationTimer) {
      clearTimeout(state.cancelState.escalationTimer)
    }
    state.cancelState = undefined
  }

  buildCancelledResult(
    message: AgentMessage,
    conversationId: string,
  ): AgentRuntimeTurnResult {
    const cancelEvent: AgentEvent = {
      type: "result",
      content: "",
      done: true,
      metadata: { cancelled: true },
    }
    this.emitEvent(message, conversationId, cancelEvent)
    return {
      conversationId,
      events: [cancelEvent],
      resultText: "",
      error: "cancelled",
    }
  }

  private async enqueueTurn(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    options: { readonly abortSignal?: AbortSignal; readonly liveEventTimeoutMs?: number } = {},
  ): Promise<AgentRuntimeTurnResult> {
    this.deps.replyTargets?.rememberReplyTarget(replyTargetFromMessage(message, conversation.id))
    const governance = this.deps.governance?.evaluateMessage(message)
    if (governance && !governance.allowed) {
      return this.finishWithError(message, conversation.id, governance.reason ?? "Message blocked")
    }

    const turnId = randomUUID()
    let liveMessage = message
    const commandResult = await this.commandRouter?.handle(message, conversation, { turnId })
    if (commandResult && isPromptCommandRoute(commandResult)) {
      liveMessage = { ...message, content: commandResult.content }
    } else if (commandResult) {
      for (const [index, event] of commandResult.events.entries()) {
        this.emitEvent(message, commandResult.conversationId, event)
        await this.persistAgentEvent(commandResult.conversationId, turnId, index + 1, event).catch(() => {})
        await this.saveEventHistory(commandResult.conversationId, event).catch(() => {})
      }
      return commandResult
    }

    const state = this.sessionManager.stateForConversation(conversation.id, message)
    if (state.busy && state.queue.length >= this.queueLimit()) {
      return this.finishWithError(message, conversation.id, "Session queue is full")
    }

    return new Promise<AgentRuntimeTurnResult>((resolve) => {
      const turn = {
        message,
        conversationId: conversation.id,
        turnId,
        abortSignal: options.abortSignal,
        liveEventTimeoutMs: options.liveEventTimeoutMs,
        resolve,
      }
      this.liveMessages.set(turn, liveMessage)
      state.queue.push(turn)
      if (!state.busy) {
        state.busy = true
        void this.processQueue(state)
      } else if (options.abortSignal) {
        const onAbort = () => {
          const idx = state.queue.indexOf(turn)
          if (idx >= 0) {
            state.queue.splice(idx, 1)
            resolve(this.buildCancelledResult(message, conversation.id))
          }
        }
        if (options.abortSignal.aborted) {
          onAbort()
        } else {
          options.abortSignal.addEventListener("abort", onAbort, { once: true })
        }
      }
    })
  }

  private async processQueue(state: RuntimeSessionState): Promise<void> {
    try {
      while (state.queue.length > 0) {
        const turn = state.queue.shift()
        if (!turn) continue
        const ac = new AbortController()
        const externalSignal = turn.abortSignal
        const abort = () => {
          ac.abort(externalSignal?.reason)
          void this.sessionManager.closeCurrentTurn(turn.conversationId)
        }
        externalSignal?.addEventListener("abort", abort, { once: true })
        state.turnAbortController = ac
        try {
          if (externalSignal?.aborted) ac.abort(externalSignal.reason)
          if (state.closing || ac.signal.aborted) {
            turn.resolve(this.buildCancelledResult(turn.message, turn.conversationId))
            continue
          }
          const result = await this.processTurn(
            state,
            turn.message,
            this.liveMessages.get(turn) ?? turn.message,
            turn.conversationId,
            turn.turnId,
            ac.signal,
            turn.liveEventTimeoutMs,
          )
          if (ac.signal.aborted) {
            turn.resolve(this.buildCancelledResult(turn.message, turn.conversationId))
          } else {
            turn.resolve(result)
          }
        } catch (error) {
          if (ac.signal.aborted) {
            turn.resolve(this.buildCancelledResult(turn.message, turn.conversationId))
          } else {
            const messageText = error instanceof Error ? error.message : String(error)
            this.deps.logger?.warn("AgentRuntime queued turn failed.", {
              boundary: "agent-runtime.queued-turn",
              projectId: this.deps.projectId,
              sessionKey: turn.message.sessionKey,
              conversationId: turn.conversationId,
              ...queuedTurnFailureMetadata(error),
            })
            const result = this.finishWithError(turn.message, turn.conversationId, messageText)
            await this.persistFailureEvent(turn.conversationId, result.events[0])
            turn.resolve(result)
          }
        } finally {
          externalSignal?.removeEventListener("abort", abort)
          state.turnAbortController = undefined
          this.clearCancelState(state)
        }
      }
    } finally {
      state.busy = false
    }
  }

  private async processTurn(
    state: RuntimeSessionState,
    message: AgentMessage,
    liveMessage: AgentMessage,
    conversationId: string,
    turnId: string,
    abortSignal?: AbortSignal,
    liveEventTimeoutMs?: number,
  ): Promise<AgentRuntimeTurnResult> {
    state.activeTurns += 1
    state.lastActivity = Date.now()
    try {
      let conversation = await this.repository.get(conversationId)
      if (!conversation) {
        conversation = await this.getOrCreateConversation(message)
      }
      conversation = await this.repository.appendHistory(conversation.id, "user", message.content)
      this.emitConversationUpdated(conversation)

      const isBackgroundPlatform = message.platform !== "local-renderer"
      const phaseRunId = randomUUID()
      const tRecv = this.isoNow()
      if (isBackgroundPlatform) {
        this.emitPhase(message, conversation.id, phaseRunId, "received", "in-progress", tRecv)
      }

      try {
        await this.checkRendererAgentSpawn(message, conversation)
        const sessionHandle = await this.sessionManager.getOrCreateSession({
          state,
          conversation,
          message,
          abortSignal,
        })
        const preparedMessage = await Promise.resolve(this.deps.prepareMessage?.(liveMessage, {
          isNewLiveSession: sessionHandle.created,
          conversationId: conversation.id,
          turnId,
        }) ?? liveMessage)
        const result = await this.processLiveTurn(
          state,
          preparedMessage,
          conversation,
          sessionHandle.liveSession,
          turnId,
          abortSignal,
          liveEventTimeoutMs,
        )
        await this.appendAfterTurnEvents(message, result, conversation.id, turnId, sessionHandle.created)

        if (isBackgroundPlatform) {
          const tDone = this.isoNow()
          this.emitPhase(message, conversation.id, phaseRunId, "received", "done", tRecv, tDone)
          this.emitPhase(
            message,
            conversation.id,
            phaseRunId,
            result.error ? "failed" : "completed",
            result.error ? "failed" : "done",
            tRecv,
            tDone,
            result.error,
          )
        }

        return result
      } catch (error) {
        if (isBackgroundPlatform) {
          const tDone = this.isoNow()
          this.emitPhase(message, conversation.id, phaseRunId, "received", "done", tRecv, tDone)
          this.emitPhase(
            message,
            conversation.id,
            phaseRunId,
            "failed",
            "failed",
            tRecv,
            tDone,
            "Agent turn failed",
          )
        }
        throw error
      }
    } finally {
      state.activeTurns = Math.max(0, state.activeTurns - 1)
      state.lastActivity = Date.now()
    }
  }

  private async checkRendererAgentSpawn(
    message: AgentMessage,
    conversation: ConversationEntryV1,
  ): Promise<void> {
    if (!this.deps.permissionGuard || !isRendererAgentPlatform(message.platform)) return

    const actor = rendererAgentActor(message)
    const resource = `${message.platform}:${message.projectId}:${message.sessionKey}`
    const metadata = {
      projectId: message.projectId,
      sessionKey: message.sessionKey,
      conversationId: conversation.id,
      providerId: message.providerId ?? conversation.providerId,
      platform: message.platform,
      agentType: message.agentType ?? conversation.agentType,
      modelTier: message.modelTier ?? conversation.agentConfig?.modelTier,
    }

    try {
      const permission = await this.deps.permissionGuard.check({
        action: "agent.spawn",
        actor,
        resource,
        context: metadata,
      })
      if (!permission.allowed) {
        this.deps.auditSink?.record({
          action: "agent.spawn",
          actor,
          resource,
          outcome: "denied",
          metadata: {
            ...metadata,
            reason: permission.reason,
            policyId: permission.policyId,
          },
        })
        throw new Error("Agent spawn denied by permission policy.")
      }
      this.deps.auditSink?.record({
        action: "agent.spawn",
        actor,
        resource,
        outcome: "allowed",
        metadata,
      })
    } catch (error) {
      if (error instanceof Error && error.message === "Agent spawn denied by permission policy.") {
        throw error
      }
      this.deps.auditSink?.record({
        action: "agent.spawn",
        actor,
        resource,
        outcome: "failed",
        metadata: {
          ...metadata,
          ...errorMetadata(error),
        },
      })
      throw new Error("Agent spawn permission check failed.")
    }
  }

  private async processLiveTurn(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversation: ConversationEntryV1,
    liveSession: AgentLiveSession,
    turnId: string,
    abortSignal?: AbortSignal,
    liveEventTimeoutMs = DEFAULT_LIVE_EVENT_TIMEOUT_MS,
  ): Promise<AgentRuntimeTurnResult> {
    const events: AgentEvent[] = []
    let resultText = ""
    let latestAssistantText = ""
    let streamedText = ""
    let resultMetadata: ConversationEntryV1["history"][number]["metadata"] | undefined
    let resultUsage: Record<string, unknown> | undefined
    let resultCostUsd: number | undefined
    let error: string | undefined

    const accepted = await liveSession.send(message)
    if (!accepted) {
      await this.sessionManager.closeCurrentTurn(conversation.id)
      error = "Agent session ended before message could be sent."
    }

    while (!error && liveSession.alive()) {
      const event = await nextLiveEventWithTimeout(liveSession, liveEventTimeoutMs)
      if (!event) {
        error = liveSession.alive() ? "Agent session timed out." : "Agent session ended"
        if (liveSession.alive()) {
          await this.sessionManager.closeCurrentTurn(conversation.id)
        }
        break
      }
      events.push(event)
      this.emitEvent(message, conversation.id, event)
      await this.persistAgentEvent(conversation.id, turnId, events.length, event)
      await this.saveEventSdkSession(conversation.id, event, liveSession)
      await this.saveEventHistory(conversation.id, event)

      const assistantText = assistantEventText(event)
      if (assistantText) latestAssistantText = assistantText
      else streamedText = appendStreamedText(streamedText, event)

      if (event.type === "permissionRequest") {
        await this.awaitPendingPermission(state, message, conversation.id, event, liveSession, abortSignal)
        continue
      }
      if (event.type === "result") {
        resultText = latestAssistantText || event.content || streamedText
        resultMetadata = resultHistoryMetadata(event)
        resultUsage = resultUsageFromEvent(event)
        resultCostUsd = resultCostFromEvent(event)
        await this.repository.saveUsage({
          conversationId: conversation.id,
          usage: resultUsage as ConversationEntryV1["usage"] | undefined,
          costUsd: resultCostUsd,
        })
        break
      }
      if (event.type === "error") {
        error = event.message
        break
      }
    }

    if (error && events[events.length - 1]?.type !== "error") {
      const errorEvent: AgentEvent = {
        type: "error",
        message: sanitizeErrorText(error),
        conversationId: conversation.id,
        providerId: message.providerId ?? conversation.providerId,
        sdkSessionId: liveSession.currentSessionId(),
        timestamp: this.isoNow(),
      }
      events.push(errorEvent)
      this.emitEvent(message, conversation.id, errorEvent)
      await this.persistAgentEvent(conversation.id, turnId, events.length, errorEvent)
      await this.saveEventHistory(conversation.id, errorEvent)
      error = errorEvent.message
    }

    const sdkSessionId = liveSession.currentSessionId()
    const saved = await this.saveExecutionResult(conversation, resultText, sdkSessionId, resultMetadata)

    return {
      conversationId: saved.id,
      events,
      resultText,
      agentSessionId: saved.sdkSessionId,
      threadId: saved.sdkSessionId,
      error,
      usage: resultUsage,
      costUsd: resultCostUsd,
    }
  }

  private async runAfterTurn(
    message: AgentMessage,
    result: AgentRuntimeTurnResult,
    conversationId: string,
    turnId: string,
    isNewLiveSession: boolean,
  ): Promise<readonly AgentEvent[]> {
    if (!this.deps.afterTurn) return []
    try {
      const output = await Promise.resolve(this.deps.afterTurn({ message, result, conversationId, turnId, isNewLiveSession }))
      return output?.events ?? []
    } catch (error) {
      this.deps.logger?.warn("Agent afterTurn hook failed.", {
        boundary: "agent-runtime.after-turn",
        conversationId,
        turnId,
        error: errorMetadata(error),
      })
      return []
    }
  }

  private async appendAfterTurnEvents(
    message: AgentMessage,
    result: AgentRuntimeTurnResult,
    conversationId: string,
    turnId: string,
    isNewLiveSession: boolean,
  ): Promise<void> {
    const events = await this.runAfterTurn(message, result, conversationId, turnId, isNewLiveSession)
    const mutableEvents = result.events as AgentEvent[]
    for (const event of events) {
      mutableEvents.push(event)
      this.emitEvent(message, conversationId, event)
      await this.persistAgentEvent(conversationId, turnId, result.events.length, event)
      await this.saveEventHistory(conversationId, event)
    }
  }

  private async processSideSessionWithTimeout(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversation: ConversationEntryV1,
    timeoutMs: number,
    abortSignal: AbortSignal,
  ): Promise<AgentRuntimeRelayResult> {
    state.busy = true
    state.activeTurns += 1
    state.lastActivity = Date.now()
    const turnId = randomUUID()
    const events: AgentEvent[] = []
    let partialText = ""
    let resultText = ""
    let latestAssistantText = ""
    let resultMetadata: ConversationEntryV1["history"][number]["metadata"] | undefined
    let resultUsage: Record<string, unknown> | undefined
    let resultCostUsd: number | undefined
    let error: string | undefined
    try {
      const savedConversation = await this.repository.appendHistory(conversation.id, "user", message.content)
      const sessionHandle = await this.sessionManager.getOrCreateSession({
        state,
        conversation: savedConversation,
        message,
        abortSignal,
      })
      const liveSession = sessionHandle.liveSession
      const liveMessage = await Promise.resolve(this.deps.prepareMessage?.(message, {
        isNewLiveSession: sessionHandle.created,
        conversationId: savedConversation.id,
        turnId,
      }) ?? message)
      const accepted = await liveSession.send(liveMessage)
      if (!accepted) {
        await this.sessionManager.closeCurrentTurn(conversation.id)
        error = "Agent session ended before message could be sent."
      }
      while (!error && liveSession.alive() && !abortSignal.aborted) {
        const event = await nextLiveEventWithTimeout(liveSession, timeoutMs)
        if (!event) {
          const errorEvent: AgentEvent = {
            type: "error",
            message: "Agent relay timed out.",
            conversationId: conversation.id,
            providerId: message.providerId ?? conversation.providerId,
            sdkSessionId: liveSession.currentSessionId(),
            timestamp: this.isoNow(),
          }
          events.push(errorEvent)
          this.emitEvent(message, conversation.id, errorEvent)
          await this.persistAgentEvent(conversation.id, turnId, events.length, errorEvent)
          await this.saveEventSdkSession(conversation.id, errorEvent, liveSession)
          await this.saveEventHistory(conversation.id, errorEvent)
          await this.sessionManager.closeCurrentTurn(conversation.id)
          return {
            conversationId: conversation.id,
            events,
            resultText: partialText,
            partialText,
            agentSessionId: liveSession.currentSessionId(),
            threadId: liveSession.currentSessionId(),
            error: errorEvent.message,
            timedOut: true,
          }
        }
        events.push(event)
        partialText = appendRelayText(partialText, event)
        this.emitEvent(message, conversation.id, event)
        await this.persistAgentEvent(conversation.id, turnId, events.length, event)
        await this.saveEventSdkSession(conversation.id, event, liveSession)
        await this.saveEventHistory(conversation.id, event)
        const assistantText = assistantEventText(event)
        if (assistantText) latestAssistantText = assistantText
        if (event.type === "permissionRequest") {
          await liveSession.respondPermission(event.requestId, {
            behavior: "deny",
            message: "Relay cannot approve tool permissions.",
          })
          error = "Relay requested permission."
          await this.sessionManager.closeCurrentTurn(conversation.id)
          break
        }
        if (event.type === "result") {
          resultText = latestAssistantText || event.content || partialText
          partialText = resultText || partialText
          resultMetadata = resultHistoryMetadata(event)
          resultUsage = resultUsageFromEvent(event)
          resultCostUsd = resultCostFromEvent(event)
          await this.repository.saveUsage({
            conversationId: conversation.id,
            usage: resultUsage as ConversationEntryV1["usage"] | undefined,
            costUsd: resultCostUsd,
          })
          break
        }
        if (event.type === "error") {
          error = event.message
          break
        }
      }
      if (abortSignal.aborted && !error) {
        const errorEvent: AgentEvent = {
          type: "error",
          message: "Agent relay timed out.",
          conversationId: conversation.id,
          providerId: message.providerId ?? conversation.providerId,
          sdkSessionId: liveSession.currentSessionId(),
          timestamp: this.isoNow(),
        }
        events.push(errorEvent)
        this.emitEvent(message, conversation.id, errorEvent)
        await this.persistAgentEvent(conversation.id, turnId, events.length, errorEvent)
        await this.saveEventSdkSession(conversation.id, errorEvent, liveSession)
        await this.saveEventHistory(conversation.id, errorEvent)
        await this.sessionManager.closeCurrentTurn(conversation.id)
        return {
          conversationId: conversation.id,
          events,
          resultText: partialText,
          partialText,
          agentSessionId: liveSession.currentSessionId(),
          threadId: liveSession.currentSessionId(),
          error: errorEvent.message,
          timedOut: true,
        }
      }
      if (error && events[events.length - 1]?.type !== "error") {
        const errorResult = this.finishWithError(message, conversation.id, error)
        const errorEvent = errorResult.events[0]
        if (errorEvent) {
          events.push(errorEvent)
          await this.persistAgentEvent(conversation.id, turnId, events.length, errorEvent)
          await this.saveEventHistory(conversation.id, errorEvent)
        }
        error = errorResult.error
      }
      const saved = await this.saveExecutionResult(conversation, resultText, liveSession.currentSessionId(), resultMetadata)
      const result: AgentRuntimeRelayResult = {
        conversationId: saved.id,
        events,
        resultText,
        partialText,
        agentSessionId: saved.sdkSessionId,
        threadId: saved.sdkSessionId,
        error,
        timedOut: false,
        usage: resultUsage,
        costUsd: resultCostUsd,
      }
      await this.appendAfterTurnEvents(message, result, saved.id, turnId, sessionHandle.created)
      return result
    } catch (rawError) {
      const messageText = rawError instanceof Error ? rawError.message : String(rawError)
      this.deps.logger?.warn("AgentRuntime side session failed.", {
        boundary: "agent-runtime.side-session",
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
        platform: message.platform,
        conversationId: conversation.id,
        providerId: message.providerId ?? conversation.providerId,
        timeoutMs,
        ...queuedTurnFailureMetadata(rawError),
      })
      const result = this.finishWithError(message, conversation.id, messageText)
      await this.persistFailureEvent(conversation.id, result.events[0])
      return {
        ...result,
        timedOut: false,
      }
    } finally {
      state.activeTurns = Math.max(0, state.activeTurns - 1)
      state.busy = false
      state.lastActivity = Date.now()
    }
  }

  private async getOrCreateConversation(message: AgentMessage): Promise<ConversationEntryV1> {
    const existing = await this.repository.getActive(
      message.sessionKey,
      message.platform,
      message.workspaceKey,
    )
    if (existing) {
      return this.repository.getOrCreateActive(message)
    }
    const providerId = await this.resolveNewConversationProviderId(message)
    return this.repository.getOrCreateActive({ ...message, providerId })
  }

  private async resolveNewConversationProviderId(message: AgentMessage): Promise<string> {
    if (message.providerId) return message.providerId
    const active = await this.sessionManager.getActiveProviderId()
    if (!active) throw new Error("No active provider configured")
    return active
  }

  private async awaitPendingPermission(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversationId: string,
    event: AgentPermissionRequestEvent,
    liveSession: AgentLiveSession,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    await new Promise<void>((resolve) => {
      let settled = false
      const abort = (): void => {
        this.sessionManager.settlePendingPermission(pending)
      }
      const settle = (): void => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        abortSignal?.removeEventListener("abort", abort)
        resolve()
      }
      const pending: PendingPermissionState = {
        requestId: event.requestId,
        projectId: this.deps.projectId,
        stateKey: state.key,
        sessionKey: message.sessionKey,
        workspaceKey: message.workspaceKey,
        workspacePath: message.workspacePath,
        conversationId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolInputRaw: event.toolInputRaw,
        createdAt: this.isoNow(),
        liveSession,
        resolve: settle,
      }
      state.pending = pending
      this.pendingPermissions.set(event.requestId, pending)
      abortSignal?.addEventListener("abort", abort, { once: true })
      if (abortSignal?.aborted) {
        abort()
        return
      }
      timeout = setTimeout(() => {
        if (settled) return
        liveSession.respondPermission(event.requestId, {
          behavior: "deny",
          message: "Permission request timed out waiting for user response.",
        }).then(() => {
          this.sessionManager.settlePendingPermission(pending)
        }).catch((error) => {
          this.deps.logger?.warn("Permission timeout auto-deny failed.", {
            boundary: "agent-runtime.permission-timeout",
            conversationId,
            requestId: event.requestId,
            toolName: event.toolName,
            ...errorSummary(error),
          })
          void this.sessionManager.closeCurrentTurn(conversationId)
        })
      }, this.permissionTimeoutMs)
    })
  }

  private async saveEventSdkSession(
    conversationId: string,
    event: AgentEvent,
    liveSession: AgentLiveSession,
  ): Promise<void> {
    const sdkSessionId = event.sdkSessionId ?? liveSession.currentSessionId()
    if (!sdkSessionId) return
    await this.repository.saveSdkSession({ conversationId, sdkSessionId })
  }

  private async saveExecutionResult(
    conversation: ConversationEntryV1,
    resultText: string,
    sdkSessionId?: string,
    metadata?: ConversationEntryV1["history"][number]["metadata"],
  ): Promise<ConversationEntryV1> {
    let saved = conversation
    if (sdkSessionId) {
      saved = await this.repository.saveSdkSession({
        conversationId: conversation.id,
        sdkSessionId,
      })
    }
    if (resultText) {
      saved = await this.repository.appendHistory(saved.id, "assistant", resultText, metadata)
    }
    if (sdkSessionId || resultText) {
      this.emitConversationUpdated(saved)
    }
    return saved
  }

  private async saveEventHistory(
    conversationId: string,
    event: AgentEvent,
  ): Promise<void> {
    const entry = historyEntryForAgentEvent(event)
    if (!entry) return
    await this.repository.appendHistory(conversationId, entry.role, entry.content, entry.metadata)
  }

  private async persistAgentEvent(
    conversationId: string,
    turnId: string,
    sequence: number,
    event: AgentEvent,
  ): Promise<void> {
    if (!this.deps.agentEvents) return
    try {
      await this.deps.agentEvents.upsert({
        id: `${conversationId}:${turnId}:${sequence}`,
        schemaVersion: 1,
        projectId: this.deps.projectId,
        conversationId,
        turnId,
        eventType: event.type,
        payload: sanitizeEventPayload(event),
        createdAt: this.isoNow(),
      })
    } catch (error) {
      this.deps.logger?.warn("AgentRuntime event persistence failed.", {
        boundary: "agent-runtime.event-persistence",
        projectId: this.deps.projectId,
        conversationId,
        turnId,
        eventType: event.type,
        ...queuedTurnFailureMetadata(error),
      })
    }
  }

  private async persistFailureEvent(
    conversationId: string,
    event: AgentEvent | undefined,
  ): Promise<void> {
    if (!event) return
    try {
      await this.persistAgentEvent(conversationId, randomUUID(), 1, event)
      await this.saveEventHistory(conversationId, event)
    } catch (error) {
      this.deps.logger?.warn("AgentRuntime failure event persistence failed.", {
        boundary: "agent-runtime.failure-event-persistence",
        projectId: this.deps.projectId,
        conversationId,
        eventType: event.type,
        ...queuedTurnFailureMetadata(error),
      })
    }
  }

  private finishWithError(
    message: AgentMessage,
    conversationId: string,
    error: string,
  ): AgentRuntimeTurnResult {
    const safeError = sanitizeErrorText(error)
    const event: AgentEvent = { type: "error", message: safeError }
    this.emitEvent(message, conversationId, event)
    return {
      conversationId,
      events: [event],
      resultText: "",
      error: safeError,
    }
  }

  private emitEvent(
    message: AgentMessage,
    conversationId: string,
    event: AgentEvent,
  ): void {
    const target = replyTargetFromMessage(message, conversationId, event)
    this.deps.eventBus?.emit({
      domain: "agent",
      type: event.type,
      payload: {
        event,
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
        platform: message.platform,
      },
      scope: { sessionId: conversationId },
      timestamp: this.isoNow(),
    }, { backpressure: "block" })
    if (shouldSuppressReply(message)) return
    // Record outbox entry as pending before dispatch. After dispatch completes
    // (or fails), update the status to "sent" or "failed" so outbox accurately
    // reflects delivery outcome rather than pre-emptively marking as "sent".
    const outbox = this.deps.outbox
    const outboxId = outbox?.recordAgentEvent(target, event)
    if (outbox && outboxId) {
      const replyTargets = this.deps.replyTargets
      if (replyTargets) {
        replyTargets.dispatchAgentEvent(target, event).then(
          () => outbox.updateRecordStatus(outboxId, "sent"),
          (error: unknown) => outbox.updateRecordStatus(
            outboxId,
            "failed",
            error instanceof Error ? error.message : String(error),
          ),
        )
      }
    }
  }

  private emitConversationUpdated(conversation: ConversationEntryV1): void {
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

  private emitPhase(
    message: AgentMessage,
    conversationId: string,
    runId: string,
    phase: string,
    status: string,
    startedAt: string,
    completedAt?: string,
    errorMessage?: string,
  ): void {
    this.deps.eventBus?.emit({
      domain: "agent",
      type: "phase.update",
      payload: {
        runId,
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
        conversationId,
        phase,
        status,
        startedAt,
        completedAt,
        errorMessage,
      },
      scope: { sessionId: conversationId },
      timestamp: this.isoNow(),
    })
  }

  private assertProject(message: AgentMessage): void {
    if (message.projectId !== this.deps.projectId) {
      throw new Error(
        `AgentRuntime project mismatch: expected "${this.deps.projectId}", got "${message.projectId}"`,
      )
    }
  }

  private queueLimit(): number {
    return this.deps.pendingQueueLimit ?? DEFAULT_PENDING_QUEUE_LIMIT
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

function userMetaFromMessage(message: AgentMessage): ConversationEntryV1["userMeta"] {
  return {
    ...message.userMeta,
    userId: message.userId,
    userName: message.userName,
    chatName: message.chatName,
    platform: message.platform,
    channelKey: message.channelKey,
    workspaceKey: message.workspaceKey,
    workspacePath: message.workspacePath,
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

function isRendererAgentPlatform(platform: string): boolean {
  return platform === "local-renderer"
}

function rendererAgentActor(message: AgentMessage): ActorIdentity {
  return message.userId
    ? { kind: "user", id: message.userId }
    : { kind: "user" }
}

function replyTargetFromMessage(
  message: AgentMessage,
  conversationId: string,
  event?: AgentEvent,
): ReplyTarget {
  const replyCtx = replyCtxRecord(message.replyCtx)
  const kind = stringValue(replyCtx?.kind)
  const bridgePlatform = stringValue(replyCtx?.platform)
  return {
    projectId: message.projectId,
    sessionKey: message.sessionKey,
    conversationId,
    threadId: event?.threadId ?? event?.agentSessionId ?? event?.sdkSessionId,
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
          sdkSessionId: event.sdkSessionId,
          toolName: event.toolName,
          toolInputSummary: truncateString(event.toolInput, MAX_SUMMARY_LENGTH),
        }),
      }
    case "toolResult":
      return {
        role: "tool",
        content: truncateString(event.content?.trim(), MAX_HISTORY_CONTENT_LENGTH) || event.toolName,
        metadata: compactMetadata({
          agentEventType: event.type,
          sdkSessionId: event.sdkSessionId,
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
          sdkSessionId: event.sdkSessionId,
        }),
      }
    case "permissionRequest":
      return {
        role: "system",
        content: event.toolInput ? `${event.toolName}\n${event.toolInput}` : event.toolName,
        metadata: compactMetadata({
          agentEventType: event.type,
          sdkSessionId: event.sdkSessionId,
          requestId: event.requestId,
          toolName: event.toolName,
          toolInputSummary: truncateString(event.toolInput, MAX_SUMMARY_LENGTH),
        }),
      }
    case "error":
      return {
        role: "system",
        content: event.message,
        metadata: compactMetadata({
          agentEventType: event.type,
          sdkSessionId: event.sdkSessionId,
        }),
      }
    case "text":
    case "result":
    case "sessionInit":
    case "assistant":
    case "stream":
    case "status":
    case "compactBoundary":
    case "sdkEvent":
      return null
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

function resultHistoryMetadata(
  event: Extract<AgentEvent, { type: "result" }>,
): ConversationEntryV1["history"][number]["metadata"] | undefined {
  const metadata = compactMetadata({
    ...event.metadata,
    usage: resultUsageFromEvent(event),
    costUsd: resultCostFromEvent(event),
  })
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function resultUsageFromEvent(event: Extract<AgentEvent, { type: "result" }>): Record<string, unknown> | undefined {
  return event.metadata?.usage ?? event.usage
}

function resultCostFromEvent(event: Extract<AgentEvent, { type: "result" }>): number | undefined {
  return event.metadata?.costUsd ?? event.costUsd
}

function compactMetadata(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  )
}

function sanitizeEventPayload(event: AgentEvent): Record<string, unknown> {
  const sanitized = sanitizeValue(event)
  if (!isRecord(sanitized)) {
    return { type: event.type }
  }
  if (JSON.stringify(sanitized).length <= MAX_EVENT_PAYLOAD_BYTES) {
    return sanitized
  }
  return compactMetadata({
    type: event.type,
    sdkSessionId: event.sdkSessionId,
    requestId: "requestId" in event ? event.requestId : undefined,
    toolName: "toolName" in event ? event.toolName : undefined,
    truncated: true,
  })
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeErrorText(value)
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue)
  if (!isRecord(value)) return value
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const lower = key.toLowerCase()
    if (lower.includes("raw")) continue
    if (
      lower.includes("secret")
      || lower.includes("token")
      || lower.includes("password")
      || lower.includes("apikey")
      || lower.includes("authorization")
      || lower.includes("cookie")
      || lower.includes("credential")
    ) {
      output[key] = "[redacted]"
      continue
    }
    output[key] = sanitizeValue(entry)
  }
  return output
}

function errorSummary(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
} {
  return errorMetadata(error)
}

function queuedTurnFailureMetadata(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
} {
  return errorMetadata(error)
}

function errorMetadata(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
} {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

function sanitizeErrorText(value: string): string {
  return truncateString(
    value
      .replace(SENSITIVE_ERROR_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=[redacted]`)
      .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]"),
    MAX_SUMMARY_LENGTH,
  ) ?? ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function truncateString(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function assistantEventText(event: AgentEvent): string | undefined {
  if (event.type !== "assistant") return undefined
  if (typeof event.content === "string" && event.content.trim().length > 0) return event.content
  const blocks = Array.isArray(event.contentBlocks)
    ? event.contentBlocks
    : Array.isArray(event.message.content)
      ? event.message.content
      : undefined
  const text = textFromBlocks(blocks)
  return text.trim().length > 0 ? text : undefined
}

function textFromBlocks(blocks: readonly unknown[] | undefined): string {
  if (!blocks) return ""
  return blocks.map((block) => {
    if (typeof block === "string") return block
    if (!isRecord(block)) return ""
    return typeof block.text === "string" ? block.text : ""
  }).join("")
}

async function nextLiveEventWithTimeout(
  liveSession: AgentLiveSession,
  timeoutMs: number,
): Promise<AgentEvent | null> {
  if (timeoutMs <= 0) {
    return liveSession.nextEvent()
  }
  if (liveSession.nextEventWithTimeout) {
    return liveSession.nextEventWithTimeout(timeoutMs)
  }
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

function appendRelayText(current: string, event: AgentEvent): string {
  if (event.type === "assistant") return assistantEventText(event) ?? current
  const streamed = appendStreamedText(current, event)
  if (streamed !== current) return streamed
  if (event.type === "result") return current || event.content
  if (event.type === "error" && !current) return event.message
  return current
}

function appendStreamedText(current: string, event: AgentEvent): string {
  if (event.type === "text") return `${current}${event.content}`
  if (event.type === "stream" && event.text) return `${current}${event.text}`
  return current
}
