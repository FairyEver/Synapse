import { randomUUID } from "node:crypto"

import type {
  AgentEventEntryV1,
  ConversationEntryV1,
  DataNamespace,
} from "../../runtime/data-repo"
import type { ScopedEventBus } from "../../runtime/project-container"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import {
  normalizeClaudeSdkUsage,
  sumClaudeSdkUsage,
  type ClaudeSdkUsageSummary,
} from "../../../src/lib/token-usage"
import type { ReplyOutboxService, ReplyTarget } from "../reply-target"
import {
  estimateSynapseUsageCostSnapshot,
  usageTokenBreakdownFromRecord,
  type ModelPriceRule,
} from "../model-price"
import {
  AGENT_CANCELLED_MESSAGE,
  AGENT_COMPRESSION_UNSUPPORTED_MESSAGE,
  AGENT_MESSAGE_BLOCKED_MESSAGE,
  AGENT_NO_ACTIVE_PROVIDER_MESSAGE,
  AGENT_PERMISSION_TIMEOUT_MESSAGE,
  AGENT_QUEUE_FULL_MESSAGE,
  AGENT_RELAY_BUSY_MESSAGE,
  AGENT_RELAY_PERMISSION_DENY_MESSAGE,
  AGENT_RELAY_PERMISSION_ERROR_MESSAGE,
  AGENT_RELAY_QUESTION_DENY_MESSAGE,
  AGENT_RELAY_QUESTION_ERROR_MESSAGE,
  AGENT_RELAY_TIMED_OUT_MESSAGE,
  AGENT_SESSION_ENDED_BEFORE_SEND_MESSAGE,
  AGENT_SESSION_ENDED_MESSAGE,
  AGENT_SPAWN_DENIED_MESSAGE,
  AGENT_SPAWN_PERMISSION_CHECK_FAILED_MESSAGE,
  AGENT_SESSION_TIMED_OUT_MESSAGE,
  AGENT_TURN_FAILED_MESSAGE,
  AGENT_USER_QUESTION_PERSISTENCE_FAILED_MESSAGE,
  AGENT_USER_QUESTION_TIMEOUT_MESSAGE,
  conversationNotFoundMessage,
} from "./agent-error-messages"
import type { AgentCommandRouter, AgentCommandRouterResult } from "./command-router"
import type { AgentGovernanceService } from "./governance"
import type { AgentSessionRepository } from "./session-repository"
import type { SessionManager } from "./session-manager"
import type { AgentProjectAfterTurnInput, AgentProjectAfterTurnOutput } from "./project-contributions"
import { attachmentHistoryMetadata, withReadablePathAttachmentContent } from "./attachments"
import type {
  PendingPermissionState,
  RuntimeSessionState,
} from "./session-lifecycle"
import type {
  AgentUsageCostBreakdownCny,
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionRequestEvent,
  AgentRuntimeRelayResult,
  AgentRuntimeTurnResult,
  AgentUserQuestionResolution,
} from "./types"
import { redactSensitiveText } from "./redaction"
import {
  createTurnLifecycle,
  diagnosticFromAgentError,
  markTimeoutRequested,
  normalizeExecutorEvent,
  outcomeMessage,
  outcomeToAgentEvent,
} from "./turn-outcome"
import type { AgentArtifactStore } from "./artifact-store"

export interface ConversationRouterDeps {
  readonly projectId: string
  readonly defaultAgentType: string
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
  readonly agentArtifactStore?: AgentArtifactStore
  readonly getUsagePriceRules?: () => readonly ModelPriceRule[]
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
const DEFAULT_PERMISSION_TIMEOUT_MS = 60 * 60 * 1000
const DEFAULT_LIVE_EVENT_TIMEOUT_MS = 60 * 60 * 1000
const MAX_EVENT_PAYLOAD_BYTES = 8192
const MAX_SUMMARY_LENGTH = 1000
const MAX_HISTORY_CONTENT_LENGTH = 10_000
const STREAM_EVENT_QUEUE_SIZE = 20
const COST_EPSILON = 0.000001

interface ModelUsageBreakdown {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

interface NormalizedTurnUsage {
  readonly modelUsage?: Record<string, Record<string, unknown>>
  readonly summary?: ClaudeSdkUsageSummary
}

interface ConversationTurnOptions {
  readonly abortSignal?: AbortSignal
  readonly liveEventTimeoutMs?: number
  readonly onResponseStarted?: () => void
}

interface NewConversationTurnOptions extends ConversationTurnOptions {
  readonly onConversationCreated?: (conversation: ConversationEntryV1) => void
}

export class ConversationRouter {
  private readonly deps: ConversationRouterDeps
  private readonly repository: AgentSessionRepository
  private readonly sessionManager: SessionManager
  private readonly commandRouter: AgentCommandRouter | undefined
  private readonly pendingPermissions: Map<string, PendingPermissionState>
  private readonly permissionTimeoutMs: number
  private readonly liveMessages = new WeakMap<object, AgentMessage>()
  private readonly nativeSlashPassthroughs = new WeakMap<
    object,
    Extract<AgentCommandRouterResult, { kind: "nativeSlash" }>
  >()
  private readonly savedSdkSessions = new Map<string, string>()

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
    options: ConversationTurnOptions = {},
  ): Promise<AgentRuntimeTurnResult> {
    this.assertProject(message)
    const conversation = await this.getOrCreateConversation(message)
    return this.enqueueTurn(message, conversation, options)
  }

  async sendToConversation(
    message: AgentMessage,
    conversationId: string,
    options: ConversationTurnOptions = {},
  ): Promise<AgentRuntimeTurnResult> {
    this.assertProject(message)
    const conversation = await this.repository.get(conversationId)
    if (!conversation) {
      throw new Error(conversationNotFoundMessage(conversationId))
    }
    const effectiveConversation = message.modeOverride
      ? await this.repository.savePermissionMode(conversation.id, message.modeOverride)
      : conversation
    const effectiveMessage = conversation.platform
      ? { ...message, platform: conversation.platform }
      : message
    return this.enqueueTurn(effectiveMessage, effectiveConversation, options)
  }

  async sendNewSession(
    message: AgentMessage,
    name: string,
    options: NewConversationTurnOptions = {},
  ): Promise<AgentRuntimeTurnResult> {
    this.assertProject(message)
    const providerId = await this.resolveNewConversationProviderId(message)
    const conversation = await this.repository.createSideSession({
      sessionKey: message.sessionKey,
      platform: message.platform,
      channelKey: message.channelKey,
      workspaceKey: message.workspaceKey,
      workspacePath: message.workspacePath,
      agentType: message.agentType ?? this.deps.defaultAgentType,
      providerId,
      mode: message.modeOverride,
      modelTier: message.modelTier,
      name,
      userMeta: userMetaFromMessage(message),
      resumePolicy: "fresh",
    })
    options.onConversationCreated?.(conversation)
    return this.enqueueTurn({ ...message, providerId }, conversation, options)
  }

  async sendSideSessionWithTimeout(
    message: AgentMessage,
    name: string,
    timeoutMs: number,
  ): Promise<AgentRuntimeRelayResult> {
    this.assertProject(message)
    message = withReadablePathAttachmentContent(message)

    const governance = this.deps.governance?.evaluateMessage(message)
    if (governance && !governance.allowed) {
      return {
        ...this.finishWithError(message, "", governance.reason ?? AGENT_MESSAGE_BLOCKED_MESSAGE),
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
      agentType: message.agentType ?? this.deps.defaultAgentType,
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
        ...this.finishWithError(message, conversation.id, AGENT_RELAY_BUSY_MESSAGE),
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
    return this.finishWithError(message, conversation.id, AGENT_COMPRESSION_UNSUPPORTED_MESSAGE)
  }

  clearCancelState(state: RuntimeSessionState): void {
    if (state.cancelState?.escalationTimer) {
      clearTimeout(state.cancelState.escalationTimer)
    }
    state.cancelState = undefined
  }

  forgetSavedSdkSession(conversationId: string): void {
    this.savedSdkSessions.delete(conversationId)
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
      error: AGENT_CANCELLED_MESSAGE,
    }
  }

  private async enqueueTurn(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    options: ConversationTurnOptions = {},
  ): Promise<AgentRuntimeTurnResult> {
    message = withReadablePathAttachmentContent(message)
    this.deps.replyTargets?.rememberReplyTarget(replyTargetFromMessage(message, conversation.id))
    const governance = this.deps.governance?.evaluateMessage(message)
    if (governance && !governance.allowed) {
      return this.finishWithError(message, conversation.id, governance.reason ?? AGENT_MESSAGE_BLOCKED_MESSAGE)
    }

    const turnId = randomUUID()
    const lifecycle = createTurnLifecycle({
      turnId,
      conversationId: conversation.id,
      now: () => this.isoNow(),
    })
    let liveMessage = message
    let nativeSlashPassthrough: Extract<AgentCommandRouterResult, { kind: "nativeSlash" }> | undefined
    const commandResult = await this.commandRouter?.handle(message, conversation, { turnId })
    if (commandResult && isPromptCommandRoute(commandResult)) {
      liveMessage = { ...message, content: commandResult.content }
    } else if (commandResult && isNativeSlashRoute(commandResult)) {
      nativeSlashPassthrough = commandResult
    } else if (commandResult) {
      for (const [index, event] of commandResult.events.entries()) {
        this.emitEvent(message, commandResult.conversationId, event)
        await this.persistAgentEvent(commandResult.conversationId, turnId, index + 1, event)
        await this.saveEventHistory(commandResult.conversationId, event)
      }
      return commandResult
    }

    const state = this.sessionManager.stateForConversation(conversation.id, message)
    if (state.busy && state.queue.length >= this.queueLimit()) {
      return this.finishWithError(message, conversation.id, AGENT_QUEUE_FULL_MESSAGE)
    }

    return new Promise<AgentRuntimeTurnResult>((resolve) => {
      const turn = {
        message,
        conversationId: conversation.id,
        turnId,
        lifecycle,
        abortSignal: options.abortSignal,
        liveEventTimeoutMs: options.liveEventTimeoutMs,
        onResponseStarted: options.onResponseStarted,
        resolve,
      }
      this.liveMessages.set(turn, liveMessage)
      if (nativeSlashPassthrough) {
        this.nativeSlashPassthroughs.set(turn, nativeSlashPassthrough)
      }
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
        state.activeLifecycle = turn.lifecycle
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
            this.nativeSlashPassthroughs.get(turn),
            turn.conversationId,
            turn.turnId,
            ac.signal,
            turn.liveEventTimeoutMs,
            turn.onResponseStarted,
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
          this.nativeSlashPassthroughs.delete(turn)
          state.turnAbortController = undefined
          if (state.activeLifecycle?.turnId === turn.turnId) {
            state.activeLifecycle = undefined
          }
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
    nativeSlashPassthrough: Extract<AgentCommandRouterResult, { kind: "nativeSlash" }> | undefined,
    conversationId: string,
    turnId: string,
    abortSignal?: AbortSignal,
    liveEventTimeoutMs?: number,
    onResponseStarted?: () => void,
  ): Promise<AgentRuntimeTurnResult> {
    state.activeTurns += 1
    state.lastActivity = Date.now()
    try {
      let conversation = await this.repository.get(conversationId)
      if (!conversation) {
        throw new Error(`Conversation "${conversationId}" was deleted while queued`)
      }
      conversation = await this.repository.appendHistory(
        conversation.id,
        "user",
        message.content,
        mergeHistoryMetadata(
          attachmentHistoryMetadata(message.attachments),
          mainThreadPersonaHistoryMetadata(conversation),
        ),
      )
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
          nativeSlashPassthrough,
          abortSignal,
          liveEventTimeoutMs,
          onResponseStarted,
        )
        await this.appendAfterTurnEvents(message, result, conversation.id, turnId, sessionHandle.created)

        if (isBackgroundPlatform) {
          const tDone = this.isoNow()
          const errorEvent = latestAgentErrorEvent(result.events)
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
            {
              errorKind: errorEvent?.errorKind,
              recoverable: errorEvent?.recoverable,
            },
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
            AGENT_TURN_FAILED_MESSAGE,
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
        throw new Error(AGENT_SPAWN_DENIED_MESSAGE)
      }
      this.deps.auditSink?.record({
        action: "agent.spawn",
        actor,
        resource,
        outcome: "allowed",
        metadata,
      })
    } catch (error) {
      if (error instanceof Error && error.message === AGENT_SPAWN_DENIED_MESSAGE) {
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
      throw new Error(AGENT_SPAWN_PERMISSION_CHECK_FAILED_MESSAGE, { cause: error })
    }
  }

  private async applyFirstUserMessageTitleFallback(conversationId: string): Promise<void> {
    try {
      const updated = await this.repository.renameSessionFromFirstUserMessage(conversationId)
      if (updated) this.emitConversationUpdated(updated)
    } catch (error) {
      this.deps.logger?.warn("Agent conversation fallback title failed.", {
        boundary: "agent-runtime.conversation-title.fallback",
        projectId: this.deps.projectId,
        conversationId,
        ...errorMetadata(error),
      })
    }
  }

  private async processLiveTurn(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversation: ConversationEntryV1,
    liveSession: AgentLiveSession,
    turnId: string,
    nativeSlashPassthrough: Extract<AgentCommandRouterResult, { kind: "nativeSlash" }> | undefined,
    abortSignal?: AbortSignal,
    liveEventTimeoutMs = DEFAULT_LIVE_EVENT_TIMEOUT_MS,
    onResponseStarted?: () => void,
  ): Promise<AgentRuntimeTurnResult> {
    const events: AgentEvent[] = []
    let resultText = ""
    let latestAssistantText = ""
    let streamedText = ""
    let resultMetadata: ConversationEntryV1["history"][number]["metadata"] | undefined
    let resultUsage: Record<string, unknown> | undefined
    let resultModelName: string | undefined
    let resultCostUsd: number | undefined
    let resultCostCny: number | undefined
    let resultCostBreakdownCny: AgentUsageCostBreakdownCny | undefined
    let resultCostCurrency: "CNY" | undefined
    let assistantHistoryPersisted = false
    let streamedThinking = ""
    let streamedThinkingStartedAt: string | undefined
    let error: string | undefined
    let responseStarted = false

    const flushStreamedThinkingHistory = async (): Promise<void> => {
      const content = streamedThinking.trim()
      const startedAt = streamedThinkingStartedAt
      streamedThinking = ""
      streamedThinkingStartedAt = undefined
      if (!content) return
      await this.saveEventHistory(conversation.id, {
        type: "thinking",
        content,
        sdkSessionId: liveSession.currentSessionId(),
        timestamp: startedAt ?? this.isoNow(),
      })
    }

    const accepted = await liveSession.send(message)
    if (!accepted) {
      await this.sessionManager.closeCurrentTurn(conversation.id)
      error = AGENT_SESSION_ENDED_BEFORE_SEND_MESSAGE
    } else if (nativeSlashPassthrough) {
      const event = nativeSlashPassthroughEvent(nativeSlashPassthrough, liveSession.currentSessionId(), this.isoNow())
      events.push(event)
      this.emitEvent(message, conversation.id, event)
      await this.persistAgentEvent(conversation.id, turnId, events.length, event)
      await this.saveEventSdkSession(conversation.id, event, liveSession)
      await this.saveEventHistory(conversation.id, event)
    }

    while (!error && liveSession.alive()) {
      const event = await nextLiveEventWithTimeout(liveSession, liveEventTimeoutMs)
      if (!event) {
        error = liveSession.alive() ? AGENT_SESSION_TIMED_OUT_MESSAGE : AGENT_SESSION_ENDED_MESSAGE
        if (liveSession.alive()) {
          await this.sessionManager.closeCurrentTurn(conversation.id)
        }
        break
      }
      if (!responseStarted && isAgentResponseActivityEvent(event)) {
        responseStarted = true
        onResponseStarted?.()
      }
      const assistantText = assistantEventText(event)
      if (assistantText) latestAssistantText = assistantText
      else streamedText = appendStreamedText(streamedText, event)
      const thinkingDelta = streamedThinkingDelta(event)
      if (thinkingDelta) {
        streamedThinkingStartedAt ??= event.timestamp ?? this.isoNow()
        streamedThinking = `${streamedThinking}${thinkingDelta}`
      } else {
        await flushStreamedThinkingHistory()
      }

      if (event.type === "result") {
        resultText = latestAssistantText || event.content || streamedText
        const finalized = await this.finalizeResultUsageMetadata({
          state,
          conversation,
          message,
          event,
          turnId,
          sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
          userMeta: message.userMeta ?? conversation.userMeta,
        })
        resultMetadata = finalized.metadata
        resultUsage = finalized.usage
        resultModelName = metadataString(resultMetadata, "model") ?? state.effectiveModel
        resultCostUsd = finalized.costUsd
        resultCostCny = finalized.costCny
        resultCostBreakdownCny = metadataUsageCostBreakdown(resultMetadata, "costBreakdownCny")
        resultCostCurrency = finalized.costCurrency
        events.push(finalized.event)
        this.emitEvent(message, conversation.id, finalized.event)
        await this.persistAgentEvent(conversation.id, turnId, events.length, finalized.event)
        await this.saveEventSdkSession(conversation.id, finalized.event, liveSession)
        assistantHistoryPersisted = await this.saveEventHistory(conversation.id, finalized.event, {
          assistantHistoryPersisted,
        }) || assistantHistoryPersisted
        await this.repository.saveUsage({
          conversationId: conversation.id,
          usage: resultUsage as ConversationEntryV1["usage"] | undefined,
          costUsd: resultCostUsd,
          costCny: resultCostCny,
          costCurrency: resultCostCurrency,
        })
        break
      }

      if (event.type === "error") {
        const sdkResultUsage = sdkResultUsageFromError(event)
        if (sdkResultUsage) {
          const sdkSessionId = event.sdkSessionId ?? liveSession.currentSessionId()
          const turnUsage = this.normalizedTurnUsage(
            conversation,
            sdkResultUsage,
            event.modelUsage,
            sdkSessionId,
          )
          resultUsage = sdkResultUsage
          resultCostUsd = this.normalizedEventCostUsd(conversation, event.costUsd, event.payload)
          resultCostCny = this.estimateLocalCostCny(
            state,
            sdkResultUsage,
            turnUsage.modelUsage,
          )?.total
          resultCostCurrency = resultCostCny === undefined ? undefined : "CNY"
          await this.repository.recordSdkResultUsage({
            conversationId: conversation.id,
            turnId,
            sdkResultUuid: event.sdkResultUuid,
            sdkSessionId,
            usage: sdkResultUsage,
            usageSummary: turnUsage.summary,
            modelUsage: event.modelUsage,
            userMeta: message.userMeta ?? conversation.userMeta,
          })
        }
        const lifecycle = state.activeLifecycle
        if (lifecycle) {
          const outcome = normalizeExecutorEvent(lifecycle, {
            type: "executor.error",
            diagnostic: diagnosticFromAgentError(event),
          })
          const projected = outcomeToAgentEvent({
            outcome,
            conversationId: conversation.id,
            providerId: message.providerId ?? conversation.providerId,
            sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
            timestamp: this.isoNow(),
          })
          events.push(projected)
          this.emitEvent(message, conversation.id, projected)
          await this.persistAgentEvent(conversation.id, turnId, events.length, projected)
          await this.saveEventSdkSession(conversation.id, projected, liveSession)
          assistantHistoryPersisted = await this.saveEventHistory(conversation.id, projected, {
            assistantHistoryPersisted,
          }) || assistantHistoryPersisted
          error = outcome.status === "completed" ? undefined : outcomeMessage(outcome)
          break
        }
        events.push(event)
        this.emitEvent(message, conversation.id, event)
        await this.persistAgentEvent(conversation.id, turnId, events.length, event)
        await this.saveEventSdkSession(conversation.id, event, liveSession)
        await this.saveEventHistory(conversation.id, event)
        error = event.message
        break
      }

      const preparedEvent = await this.prepareEventForStorageAndDisplay(conversation.id, turnId, event)
      events.push(preparedEvent)
      this.emitEvent(message, conversation.id, preparedEvent)
      await this.persistAgentEvent(conversation.id, turnId, events.length, preparedEvent)
      await this.saveEventSdkSession(conversation.id, preparedEvent, liveSession)
      assistantHistoryPersisted = await this.saveEventHistory(conversation.id, preparedEvent) || assistantHistoryPersisted

      if (preparedEvent.type === "permissionRequest") {
        const questionTimeoutFailed = await this.awaitPendingPermission(
          state,
          message,
          conversation.id,
          preparedEvent,
          liveSession,
          abortSignal,
        )
        if (questionTimeoutFailed) {
          const lifecycle = state.activeLifecycle
          if (lifecycle) {
            markTimeoutRequested(lifecycle, { source: "runtime", now: () => this.isoNow() })
            const outcome = normalizeExecutorEvent(lifecycle, {
              type: "executor.closed",
              diagnostic: {
                source: "agent-runtime",
                kind: "closed",
                message: AGENT_USER_QUESTION_TIMEOUT_MESSAGE,
              },
            })
            const projected = outcomeToAgentEvent({
              outcome,
              conversationId: conversation.id,
              providerId: message.providerId ?? conversation.providerId,
              sdkSessionId: liveSession.currentSessionId(),
              timestamp: this.isoNow(),
            })
            events.push(projected)
            this.emitEvent(message, conversation.id, projected)
            await this.persistAgentEvent(conversation.id, turnId, events.length, projected)
            await this.saveEventSdkSession(conversation.id, projected, liveSession)
            assistantHistoryPersisted = await this.saveEventHistory(conversation.id, projected, {
              assistantHistoryPersisted,
            }) || assistantHistoryPersisted
            error = outcomeMessage(outcome)
          } else {
            error = AGENT_USER_QUESTION_TIMEOUT_MESSAGE
          }
          break
        }
        continue
      }
    }

    await flushStreamedThinkingHistory()

    if (error && events[events.length - 1]?.type !== "error" && !hasTerminalTurnOutcome(events[events.length - 1])) {
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
    await this.applyFirstUserMessageTitleFallback(conversation.id)
    const saved = await this.saveExecutionResult(conversation, resultText, sdkSessionId, resultMetadata, {
      assistantHistoryPersisted,
    })

    return {
      conversationId: saved.id,
      events,
      resultText,
      agentSessionId: saved.sdkSessionId,
      threadId: saved.sdkSessionId,
      error,
      usage: resultUsage,
      modelName: resultModelName,
      costUsd: resultCostUsd,
      costCny: resultCostCny,
      costBreakdownCny: resultCostBreakdownCny,
      costCurrency: resultCostCurrency,
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
    let resultModelName: string | undefined
    let resultCostUsd: number | undefined
    let resultCostCny: number | undefined
    let resultCostBreakdownCny: AgentUsageCostBreakdownCny | undefined
    let resultCostCurrency: "CNY" | undefined
    let assistantHistoryPersisted = false
    let error: string | undefined
    try {
      const savedConversation = await this.repository.appendHistory(
        conversation.id,
        "user",
        message.content,
        mergeHistoryMetadata(
          attachmentHistoryMetadata(message.attachments),
          mainThreadPersonaHistoryMetadata(conversation),
        ),
      )
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
        error = AGENT_SESSION_ENDED_BEFORE_SEND_MESSAGE
      }
      while (!error && liveSession.alive() && !abortSignal.aborted) {
        const event = await nextLiveEventWithTimeout(liveSession, timeoutMs)
        if (!event) {
          const errorEvent: AgentEvent = {
            type: "error",
            message: AGENT_RELAY_TIMED_OUT_MESSAGE,
            conversationId: conversation.id,
            providerId: message.providerId ?? conversation.providerId,
            sdkSessionId: liveSession.currentSessionId(),
            timestamp: this.isoNow(),
          }
          events.push(errorEvent)
          this.emitEvent(message, conversation.id, errorEvent)
          await this.persistAgentEvent(conversation.id, turnId, events.length, errorEvent)
          await this.saveEventSdkSession(conversation.id, errorEvent, liveSession)
          assistantHistoryPersisted = await this.saveEventHistory(conversation.id, errorEvent) || assistantHistoryPersisted
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
        const assistantText = assistantEventText(event)
        if (assistantText) latestAssistantText = assistantText
        if (event.type === "result") {
          resultText = latestAssistantText || event.content || partialText
          partialText = resultText || partialText
          const finalized = await this.finalizeResultUsageMetadata({
            state,
            conversation,
            message,
            event,
            turnId,
            sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
            userMeta: message.userMeta ?? conversation.userMeta,
          })
          resultMetadata = finalized.metadata
          resultUsage = finalized.usage
          resultModelName = metadataString(resultMetadata, "model") ?? state.effectiveModel
          resultCostUsd = finalized.costUsd
          resultCostCny = finalized.costCny
          resultCostBreakdownCny = metadataUsageCostBreakdown(resultMetadata, "costBreakdownCny")
          resultCostCurrency = finalized.costCurrency
          events.push(finalized.event)
          this.emitEvent(message, conversation.id, finalized.event)
          await this.persistAgentEvent(conversation.id, turnId, events.length, finalized.event)
          await this.saveEventSdkSession(conversation.id, finalized.event, liveSession)
          assistantHistoryPersisted = await this.saveEventHistory(conversation.id, finalized.event, {
            assistantHistoryPersisted,
          }) || assistantHistoryPersisted
          await this.repository.saveUsage({
            conversationId: conversation.id,
            usage: resultUsage as ConversationEntryV1["usage"] | undefined,
            costUsd: resultCostUsd,
            costCny: resultCostCny,
            costCurrency: resultCostCurrency,
          })
          break
        }
        if (event.type === "error") {
          const sdkResultUsage = sdkResultUsageFromError(event)
          if (sdkResultUsage) {
            const sdkSessionId = event.sdkSessionId ?? liveSession.currentSessionId()
            const turnUsage = this.normalizedTurnUsage(
              conversation,
              sdkResultUsage,
              event.modelUsage,
              sdkSessionId,
            )
            resultUsage = sdkResultUsage
            resultCostUsd = this.normalizedEventCostUsd(conversation, event.costUsd, event.payload)
            resultCostCny = this.estimateLocalCostCny(
              state,
              sdkResultUsage,
              turnUsage.modelUsage,
            )?.total
            resultCostCurrency = resultCostCny === undefined ? undefined : "CNY"
            await this.repository.recordSdkResultUsage({
              conversationId: conversation.id,
              turnId,
              sdkResultUuid: event.sdkResultUuid,
              sdkSessionId,
              usage: sdkResultUsage,
              usageSummary: turnUsage.summary,
              modelUsage: event.modelUsage,
              userMeta: message.userMeta ?? conversation.userMeta,
            })
          }
          const lifecycle = state.activeLifecycle
          if (lifecycle) {
            const outcome = normalizeExecutorEvent(lifecycle, {
              type: "executor.error",
              diagnostic: diagnosticFromAgentError(event),
            })
            const projected = outcomeToAgentEvent({
              outcome,
              conversationId: conversation.id,
              providerId: message.providerId ?? conversation.providerId,
              sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
              timestamp: this.isoNow(),
            })
            events.push(projected)
            partialText = appendRelayText(partialText, projected)
          this.emitEvent(message, conversation.id, projected)
          await this.persistAgentEvent(conversation.id, turnId, events.length, projected)
          await this.saveEventSdkSession(conversation.id, projected, liveSession)
          assistantHistoryPersisted = await this.saveEventHistory(conversation.id, projected, {
            assistantHistoryPersisted,
          }) || assistantHistoryPersisted
          error = outcome.status === "completed" ? undefined : outcomeMessage(outcome)
            break
          }
          events.push(event)
          partialText = appendRelayText(partialText, event)
        this.emitEvent(message, conversation.id, event)
        await this.persistAgentEvent(conversation.id, turnId, events.length, event)
        await this.saveEventSdkSession(conversation.id, event, liveSession)
        assistantHistoryPersisted = await this.saveEventHistory(conversation.id, event) || assistantHistoryPersisted
        error = event.message
          break
        }
        events.push(event)
        partialText = appendRelayText(partialText, event)
      this.emitEvent(message, conversation.id, event)
      await this.persistAgentEvent(conversation.id, turnId, events.length, event)
      await this.saveEventSdkSession(conversation.id, event, liveSession)
      assistantHistoryPersisted = await this.saveEventHistory(conversation.id, event) || assistantHistoryPersisted
      if (event.type === "permissionRequest") {
          await liveSession.respondPermission(event.requestId, {
            behavior: "deny",
            message: permissionRelayDenyMessage(event),
          })
          if (isAskUserQuestionEvent(event)) {
            await this.persistUserQuestionResolution(conversation.id, event.requestId, {
              status: "skipped",
              resolvedAt: this.isoNow(),
            })
          }
          error = permissionRelayErrorMessage(event)
          await this.sessionManager.closeCurrentTurn(conversation.id)
          break
        }
      }
      if (abortSignal.aborted && !error) {
        const lifecycle = state.activeLifecycle
        if (lifecycle) {
          const reason = String(abortSignal.reason ?? "")
          if (reason.includes("timeout")) {
            markTimeoutRequested(lifecycle, {
              source: "relay",
              now: () => this.isoNow(),
            })
          }
          const outcome = normalizeExecutorEvent(lifecycle, {
            type: "executor.aborted",
            diagnostic: {
              source: "agent-runtime",
              kind: "aborted",
              message: reason || "abort signal",
            },
          })
          const projected = outcomeToAgentEvent({
            outcome,
            conversationId: conversation.id,
            providerId: message.providerId ?? conversation.providerId,
            sdkSessionId: liveSession.currentSessionId(),
            timestamp: this.isoNow(),
          })
          events.push(projected)
          this.emitEvent(message, conversation.id, projected)
          await this.persistAgentEvent(conversation.id, turnId, events.length, projected)
          await this.saveEventSdkSession(conversation.id, projected, liveSession)
          assistantHistoryPersisted = await this.saveEventHistory(conversation.id, projected, {
            assistantHistoryPersisted,
          }) || assistantHistoryPersisted
          await this.sessionManager.closeCurrentTurn(conversation.id)
          return {
            conversationId: conversation.id,
            events,
            resultText: partialText,
            partialText,
            agentSessionId: liveSession.currentSessionId(),
            threadId: liveSession.currentSessionId(),
            error: outcome.status === "completed" ? undefined : outcomeMessage(outcome),
            timedOut: outcome.status === "timed_out",
          }
        }
        const errorEvent: AgentEvent = {
          type: "error",
          message: AGENT_RELAY_TIMED_OUT_MESSAGE,
          conversationId: conversation.id,
          providerId: message.providerId ?? conversation.providerId,
          sdkSessionId: liveSession.currentSessionId(),
          timestamp: this.isoNow(),
        }
        events.push(errorEvent)
        this.emitEvent(message, conversation.id, errorEvent)
        await this.persistAgentEvent(conversation.id, turnId, events.length, errorEvent)
        await this.saveEventSdkSession(conversation.id, errorEvent, liveSession)
        assistantHistoryPersisted = await this.saveEventHistory(conversation.id, errorEvent) || assistantHistoryPersisted
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
      if (error && events[events.length - 1]?.type !== "error" && !hasTerminalTurnOutcome(events[events.length - 1])) {
        const errorResult = this.finishWithError(message, conversation.id, error)
        const errorEvent = errorResult.events[0]
        if (errorEvent) {
          events.push(errorEvent)
          await this.persistAgentEvent(conversation.id, turnId, events.length, errorEvent)
          assistantHistoryPersisted = await this.saveEventHistory(conversation.id, errorEvent) || assistantHistoryPersisted
        }
        error = errorResult.error
      }
      await this.applyFirstUserMessageTitleFallback(conversation.id)
      const saved = await this.saveExecutionResult(conversation, resultText, liveSession.currentSessionId(), resultMetadata, {
        assistantHistoryPersisted,
      })
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
        modelName: resultModelName,
        costUsd: resultCostUsd,
        costCny: resultCostCny,
        costBreakdownCny: resultCostBreakdownCny,
        costCurrency: resultCostCurrency,
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
    if (!active) throw new Error(AGENT_NO_ACTIVE_PROVIDER_MESSAGE)
    return active
  }

  private async awaitPendingPermission(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversationId: string,
    event: AgentPermissionRequestEvent,
    liveSession: AgentLiveSession,
    abortSignal?: AbortSignal,
  ): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    let timeoutFailureRecovery: Promise<void> | undefined
    let questionTimeoutFailed = false
    await new Promise<void>((resolve) => {
      let settled = false
      const abort = (): void => {
        if (!this.sessionManager.claimPendingPermissionResolution(pending)) return
        this.sessionManager.settlePendingPermission(pending)
        if (isAskUserQuestionEvent(event)) {
          const status = String(abortSignal?.reason ?? "").includes("timeout")
            ? "timed_out"
            : "cancelled"
          void this.persistUserQuestionResolution(conversationId, event.requestId, {
            status,
            resolvedAt: this.isoNow(),
          })
        }
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
        questions: event.questions,
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
        if (settled || !this.sessionManager.claimPendingPermissionResolution(pending)) return
        liveSession.respondPermission(event.requestId, {
          behavior: "deny",
          message: permissionTimeoutMessage(event),
        }).then(async () => {
          this.sessionManager.settlePendingPermission(pending)
          if (isAskUserQuestionEvent(event)) {
            await this.persistUserQuestionResolution(conversationId, event.requestId, {
              status: "timed_out",
              resolvedAt: this.isoNow(),
            })
          }
        }).catch((error) => {
          this.deps.logger?.warn("Permission timeout auto-deny failed.", {
            boundary: "agent-runtime.permission-timeout",
            conversationId,
            requestId: event.requestId,
            toolName: event.toolName,
            ...errorSummary(error),
          })
          questionTimeoutFailed = isAskUserQuestionEvent(event)
          timeoutFailureRecovery = (async () => {
            if (questionTimeoutFailed) {
              await this.persistUserQuestionResolution(conversationId, event.requestId, {
                status: "timed_out",
                resolvedAt: this.isoNow(),
              })
            }
            this.sessionManager.settlePendingPermission(pending)
            await this.sessionManager.closeCurrentTurn(conversationId)
          })()
        })
      }, this.permissionTimeoutMs)
    })
    await timeoutFailureRecovery
    return questionTimeoutFailed
  }

  private async saveEventSdkSession(
    conversationId: string,
    event: AgentEvent,
    liveSession: AgentLiveSession,
  ): Promise<void> {
    const sdkSessionId = event.sdkSessionId ?? liveSession.currentSessionId()
    if (!sdkSessionId) return
    if (this.savedSdkSessions.get(conversationId) === sdkSessionId) return
    await this.repository.saveSdkSession({ conversationId, sdkSessionId })
    this.savedSdkSessions.set(conversationId, sdkSessionId)
  }

  private async saveExecutionResult(
    conversation: ConversationEntryV1,
    resultText: string,
    sdkSessionId?: string,
    metadata?: ConversationEntryV1["history"][number]["metadata"],
    options: { readonly assistantHistoryPersisted?: boolean } = {},
  ): Promise<ConversationEntryV1> {
    let saved = conversation
    if (sdkSessionId) {
      saved = await this.repository.saveSdkSession({
        conversationId: conversation.id,
        sdkSessionId,
      })
      this.savedSdkSessions.set(conversation.id, sdkSessionId)
    }
    if (options.assistantHistoryPersisted) {
      const updated = await this.repository.mergeLastHistoryMetadata(saved.id, "assistant", metadata)
      saved = updated ?? saved
    } else if (resultText) {
      saved = await this.repository.appendHistory(saved.id, "assistant", resultText, metadata)
    }
    if (sdkSessionId || resultText || options.assistantHistoryPersisted) {
      this.emitConversationUpdated(saved)
    }
    return saved
  }

  private async cumulativeUsageMetadata(
    conversationId: string,
    metadata: ConversationEntryV1["history"][number]["metadata"] | undefined,
  ): Promise<ConversationEntryV1["history"][number]["metadata"] | undefined> {
    const usage = await this.repository.getUsageSummary(conversationId)
    if (!usage) return metadata
    return compactMetadata({
      ...(metadata ?? {}),
      usage,
    })
  }

  private async finalizeResultUsageMetadata(input: {
    readonly state: RuntimeSessionState
    readonly conversation: ConversationEntryV1
    readonly message: AgentMessage
    readonly event: Extract<AgentEvent, { type: "result" }>
    readonly turnId: string
    readonly sdkSessionId?: string
    readonly userMeta?: ConversationEntryV1["userMeta"]
  }): Promise<{
    readonly event: Extract<AgentEvent, { type: "result" }>
    readonly metadata: ConversationEntryV1["history"][number]["metadata"] | undefined
    readonly usage: Record<string, unknown> | undefined
    readonly costUsd: number | undefined
    readonly costCny: number | undefined
    readonly costCurrency: "CNY" | undefined
  }> {
    const usage = resultUsageFromEvent(input.event)
    const modelUsage = resultModelUsageFromEvent(input.event)
    const turnUsage = this.normalizedTurnUsage(
      input.conversation,
      usage,
      modelUsage,
      input.sdkSessionId,
    )
    let metadata = resultHistoryMetadata(input.event)
    metadata = mergeHistoryMetadata(
      metadata,
      turnUsage.modelUsage && turnUsage.summary ? { turnUsage: turnUsage.summary } : undefined,
    )
    metadata = mergeHistoryMetadata(metadata, mainThreadPersonaHistoryMetadata(input.conversation))
    metadata = this.withNormalizedSdkCostMetadata(input.conversation, input.event, metadata)
    metadata = this.withLocalCostMetadata(
      input.state,
      usage,
      turnUsage.modelUsage,
      metadata,
    )
    const costUsd = metadataNumber(metadata, "costUsd")
    const costCny = metadataNumber(metadata, "costCny")
    const costCurrency = costCny === undefined ? undefined : "CNY"
    await this.repository.recordSdkResultUsage({
      conversationId: input.conversation.id,
      turnId: input.turnId,
      sdkResultUuid: resultSdkResultUuidFromEvent(input.event),
      sdkSessionId: input.sdkSessionId,
      usage,
      usageSummary: turnUsage.summary,
      modelUsage,
      userMeta: input.userMeta ?? input.conversation.userMeta,
    })
    metadata = await this.cumulativeUsageMetadata(input.conversation.id, metadata)
    metadata = await this.cumulativeCostMetadata(input.conversation.id, metadata)
    return {
      event: {
        ...input.event,
        metadata,
        costUsd,
        costCny,
        costCurrency,
      },
      metadata,
      usage,
      costUsd,
      costCny,
      costCurrency,
    }
  }

  private async cumulativeCostMetadata(
    conversationId: string,
    metadata: ConversationEntryV1["history"][number]["metadata"] | undefined,
  ): Promise<ConversationEntryV1["history"][number]["metadata"] | undefined> {
    const turnCostCny = metadataNumber(metadata, "costCny")
    const turnCostUsd = metadataNumber(metadata, "costUsd")
    if (turnCostCny === undefined && turnCostUsd === undefined) return metadata
    const conversation = await this.repository.get(conversationId)
    const previousCostCny = conversation ? sumAssistantMetadataNumber(conversation.history, "costCny") : 0
    const previousCostUsd = conversation ? sumAssistantMetadataNumber(conversation.history, "costUsd") : 0
    const turnCostBreakdownCny = metadataCostBreakdown(metadata, "costBreakdownCny")
    const previousCostBreakdownCny = conversation ? sumAssistantMetadataCostBreakdown(conversation.history, "costBreakdownCny") : undefined
    return compactMetadata({
      ...(metadata ?? {}),
      ...(turnCostCny === undefined ? {} : { totalCostCny: roundCost(previousCostCny + turnCostCny) }),
      ...(turnCostUsd === undefined ? {} : { totalCostUsd: roundCost(previousCostUsd + turnCostUsd) }),
      ...(turnCostBreakdownCny === undefined ? {} : {
        totalCostBreakdownCny: addCostBreakdowns(previousCostBreakdownCny, turnCostBreakdownCny),
      }),
      ...(turnCostCny === undefined ? {} : { estimatedCost: true }),
    })
  }

  private withLocalCostMetadata(
    state: RuntimeSessionState,
    usage: Record<string, unknown> | undefined,
    normalizedModelUsage: Record<string, unknown> | undefined,
    metadata: ConversationEntryV1["history"][number]["metadata"] | undefined,
  ): ConversationEntryV1["history"][number]["metadata"] | undefined {
    const cleaned = metadataWithoutLocalCost(metadata)
    const cost = this.estimateLocalCostCny(state, usage, normalizedModelUsage)
    if (!cost) return cleaned
    return compactMetadata({
      ...(cleaned ?? {}),
      costCny: cost.total,
      costBreakdownCny: cost.breakdown,
      costCurrency: "CNY",
    })
  }

  private estimateLocalCostCny(
    state: RuntimeSessionState,
    usage: Record<string, unknown> | undefined,
    normalizedModelUsage?: Record<string, unknown>,
  ): { total: number; breakdown: Record<string, number> } | undefined {
    const perModelCost = this.estimatePerModelUsageCostCny(normalizedModelUsage)
    if (normalizedModelUsage && perModelCost.hasModelUsage) return perModelCost.cost

    const snapshot = estimateSynapseUsageCostSnapshot({
      modelName: state.effectiveModel,
      usage,
      priceRules: this.deps.getUsagePriceRules?.() ?? [],
    })
    if (!snapshot?.priceKnown || snapshot.costCny === undefined || !snapshot.costBreakdownCny) return undefined
    return {
      total: roundCost(snapshot.costCny),
      breakdown: {
        input: roundCost(snapshot.costBreakdownCny.input),
        output: roundCost(snapshot.costBreakdownCny.output),
        cacheRead: roundCost(snapshot.costBreakdownCny.cacheRead),
        cacheWrite: roundCost(snapshot.costBreakdownCny.cacheWrite),
        reasoning: roundCost(snapshot.costBreakdownCny.reasoning),
      },
    }
  }

  private normalizedTurnUsage(
    conversation: ConversationEntryV1,
    usage: Record<string, unknown> | undefined,
    modelUsage: Record<string, unknown> | undefined,
    sdkSessionId: string | undefined,
  ): NormalizedTurnUsage {
    const normalizedModelUsage = this.modelUsageForTurn(conversation, usage, modelUsage, sdkSessionId)
    return {
      modelUsage: normalizedModelUsage,
      summary: normalizedModelUsage
        ? sumClaudeSdkUsage(Object.values(normalizedModelUsage))
        : normalizeClaudeSdkUsage(usage),
    }
  }

  private modelUsageForTurn(
    conversation: ConversationEntryV1,
    usage: Record<string, unknown> | undefined,
    modelUsage: Record<string, unknown> | undefined,
    sdkSessionId: string | undefined,
  ): Record<string, Record<string, unknown>> | undefined {
    const current = normalizedModelUsageRecords(modelUsage)
    if (!current) return undefined
    const turnBreakdown = usageTokenBreakdownFromRecord(usage)
    const previous = this.previousModelUsageForSdkSession(conversation, sdkSessionId)

    const currentSum = sumModelUsageBreakdowns(current)
    if (turnBreakdown && usageBreakdownsEqual(currentSum, turnBreakdown)) return modelUsageRecordsFromBreakdowns(current)
    if (!previous) {
      if (!turnBreakdown || hasMatchingModelUsageBreakdown(current, turnBreakdown)) {
        return modelUsageRecordsFromBreakdowns(current)
      }
      return undefined
    }

    const delta = subtractModelUsageRecords(current, previous)
    if (!delta) return undefined
    if (
      !turnBreakdown
      || usageBreakdownsEqual(sumModelUsageBreakdowns(delta), turnBreakdown)
      || hasMatchingModelUsageBreakdown(delta, turnBreakdown)
    ) {
      return modelUsageRecordsFromBreakdowns(delta)
    }
    return undefined
  }

  private previousModelUsageForSdkSession(
    conversation: ConversationEntryV1,
    sdkSessionId: string | undefined,
  ): Record<string, ModelUsageBreakdown> | undefined {
    for (let index = conversation.history.length - 1; index >= 0; index -= 1) {
      const entry = conversation.history[index]
      if (entry?.role !== "assistant") continue
      const modelUsage = normalizedModelUsageRecords(recordMetadataValue(entry.metadata, "modelUsage"))
      if (!modelUsage) continue
      if (!sdkSessionId) return modelUsage
      const entrySdkSessionId = metadataString(entry.metadata, "sdkSessionId")
      if (entrySdkSessionId) {
        if (entrySdkSessionId === sdkSessionId) return modelUsage
        continue
      }
      if (!conversation.sdkSessionId || conversation.sdkSessionId === sdkSessionId) return modelUsage
    }
    return undefined
  }

  private withNormalizedSdkCostMetadata(
    conversation: ConversationEntryV1,
    event: Extract<AgentEvent, { type: "result" }>,
    metadata: ConversationEntryV1["history"][number]["metadata"] | undefined,
  ): ConversationEntryV1["history"][number]["metadata"] | undefined {
    const costUsd = metadataNumber(metadata, "costUsd")
    if (costUsd === undefined || !isSdkTotalCostPayload(event.payload)) return metadata
    const normalized = this.normalizedEventCostUsd(conversation, costUsd, event.payload)
    if (normalized === undefined) {
      const next = { ...(metadata ?? {}) }
      delete next.costUsd
      return Object.keys(next).length > 0 ? next : undefined
    }
    return compactMetadata({
      ...(metadata ?? {}),
      costUsd: normalized,
    })
  }

  private normalizedEventCostUsd(
    conversation: ConversationEntryV1,
    costUsd: number | undefined,
    payload: Record<string, unknown> | undefined,
  ): number | undefined {
    if (costUsd === undefined || !isSdkTotalCostPayload(payload)) return costUsd
    const previousCostUsd = sumAssistantMetadataNumber(conversation.history, "costUsd")
    if (costUsd + COST_EPSILON < previousCostUsd) return undefined
    return roundCost(Math.max(0, costUsd - previousCostUsd))
  }

  private estimatePerModelUsageCostCny(
    modelUsage: Record<string, unknown> | undefined,
  ): {
    readonly hasModelUsage: boolean
    readonly cost?: { total: number; breakdown: Record<string, number> }
  } {
    if (!modelUsage) return { hasModelUsage: false }

    let hasModelUsage = false
    let total = 0
    let breakdown: Record<string, number> | undefined
    for (const [modelName, rawUsage] of Object.entries(modelUsage)) {
      if (!isRecord(rawUsage)) continue
      if (!usageTokenBreakdownFromRecord(rawUsage)) continue
      hasModelUsage = true
      const snapshot = estimateSynapseUsageCostSnapshot({
        modelName,
        usage: rawUsage,
        priceRules: this.deps.getUsagePriceRules?.() ?? [],
      })
      if (!snapshot?.priceKnown || snapshot.costCny === undefined || !snapshot.costBreakdownCny) {
        return { hasModelUsage: true }
      }
      total += snapshot.costCny
      breakdown = addCostBreakdowns(breakdown, {
        input: snapshot.costBreakdownCny.input,
        output: snapshot.costBreakdownCny.output,
        cacheRead: snapshot.costBreakdownCny.cacheRead,
        cacheWrite: snapshot.costBreakdownCny.cacheWrite,
        reasoning: snapshot.costBreakdownCny.reasoning,
      })
    }

    if (!hasModelUsage || !breakdown) return { hasModelUsage }
    return {
      hasModelUsage: true,
      cost: {
        total: roundCost(total),
        breakdown,
      },
    }
  }

  private async saveEventHistory(
    conversationId: string,
    event: AgentEvent,
    options: { readonly assistantHistoryPersisted?: boolean } = {},
  ): Promise<boolean> {
    const terminalResultEntry = terminalResultHistoryEntry(event)
    const entry = terminalResultEntry ?? historyEntryForAgentEvent(event)
    if (!entry) return false
    try {
      if (terminalResultEntry && options.assistantHistoryPersisted) {
        const mergeMetadata = { ...(entry.metadata ?? {}) }
        delete mergeMetadata.agentEventType
        const updated = await this.repository.mergeLastHistoryMetadata(conversationId, "assistant", mergeMetadata)
        if (updated) return true
      }
      await this.repository.appendHistory(conversationId, entry.role, entry.content, entry.metadata)
      return entry.role === "assistant"
    } catch (error) {
      this.deps.logger?.warn("AgentRuntime history persistence failed.", {
        boundary: "agent-runtime.history-persistence",
        projectId: this.deps.projectId,
        conversationId,
        eventType: event.type,
        ...queuedTurnFailureMetadata(error),
      })
      if (event.type === "permissionRequest" && isAskUserQuestionEvent(event)) {
        throw new Error(AGENT_USER_QUESTION_PERSISTENCE_FAILED_MESSAGE, { cause: error })
      }
      return false
    }
  }

  private async persistUserQuestionResolution(
    conversationId: string,
    requestId: string,
    resolution: AgentUserQuestionResolution,
  ): Promise<void> {
    try {
      const conversation = await this.repository.resolveUserQuestion(conversationId, requestId, resolution)
      if (conversation) this.emitConversationUpdated(conversation)
    } catch (error) {
      this.deps.logger?.warn("Agent user question resolution persistence failed.", {
        boundary: "agent-runtime.user-question-resolution",
        projectId: this.deps.projectId,
        conversationId,
        requestId,
        status: resolution.status,
        ...queuedTurnFailureMetadata(error),
      })
    }
  }

  private async prepareEventForStorageAndDisplay(
    conversationId: string,
    turnId: string,
    event: AgentEvent,
  ): Promise<AgentEvent> {
    if (event.type !== "toolResult" || !event.imageBlocks?.length) {
      return stripTransientImageBlocks(event)
    }
    const store = this.deps.agentArtifactStore
    if (!store) return stripTransientImageBlocks(event)
    try {
      const imageArtifacts = await store.materializeToolResultImages({
        projectId: this.deps.projectId,
        conversationId,
        turnId,
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        imageBlocks: event.imageBlocks,
      })
      return stripTransientImageBlocks({
        ...event,
        ...(imageArtifacts.length > 0 ? { imageArtifacts } : {}),
      })
    } catch (error) {
      this.deps.logger?.warn("AgentRuntime image artifact persistence failed.", {
        boundary: "agent-runtime.image-artifact-persistence",
        projectId: this.deps.projectId,
        conversationId,
        turnId,
        toolName: event.toolName,
        ...queuedTurnFailureMetadata(error),
      })
      return stripTransientImageBlocks(event)
    }
  }

  private async persistAgentEvent(
    conversationId: string,
    turnId: string,
    sequence: number,
    event: AgentEvent,
  ): Promise<void> {
    if (!this.deps.agentEvents) return
    if (isAgentStreamDeltaEvent(event)) return
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
    const options = isAgentStreamEvent(event)
      ? { backpressure: "drop-oldest" as const, maxQueueSize: STREAM_EVENT_QUEUE_SIZE }
      : { backpressure: "block" as const }
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
    }, options)
    if (shouldSuppressReply(message)) return
    if (isAgentStreamDeltaEvent(event)) return
    // Record outbox entry as pending before dispatch. After dispatch completes
    // (or fails), update the status to "sent" or "failed" so outbox accurately
    // reflects delivery outcome rather than pre-emptively marking as "sent".
    const outbox = this.deps.outbox
    if (!outbox) return
    const replyTargets = this.deps.replyTargets
    void outbox.recordAgentEvent(target, event)
      .then((outboxId) => {
        if (!replyTargets) return undefined
        return replyTargets.dispatchAgentEvent(target, event).then(
          () => outbox.updateRecordStatus(outboxId, "sent"),
          (error: unknown) => outbox.updateRecordStatus(
            outboxId,
            "failed",
            error instanceof Error ? error.message : String(error),
          ),
        )
      })
      .catch(() => undefined)
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
    errorMeta?: {
      readonly errorKind?: Extract<AgentEvent, { type: "error" }>["errorKind"]
      readonly recoverable?: boolean
    },
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
        errorKind: errorMeta?.errorKind,
        recoverable: errorMeta?.recoverable,
      },
      scope: { sessionId: conversationId },
      timestamp: this.isoNow(),
    }, { backpressure: "block" })
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

function isNativeSlashRoute(
  result: AgentCommandRouterResult,
): result is Extract<AgentCommandRouterResult, { kind: "nativeSlash" }> {
  return "kind" in result && result.kind === "nativeSlash"
}

function nativeSlashPassthroughEvent(
  route: Extract<AgentCommandRouterResult, { kind: "nativeSlash" }>,
  sdkSessionId: string | undefined,
  timestamp: string,
): AgentEvent {
  const command = `/${route.name}`
  return {
    type: "sdkEvent",
    sdkType: "nativeSlashPassthrough",
    sdkSubtype: command,
    payload: { command },
    ...(sdkSessionId ? { sdkSessionId } : {}),
    timestamp,
  }
}

function nativeSlashCommandFromEvent(event: Extract<AgentEvent, { type: "sdkEvent" }>): string {
  const payloadCommand = typeof event.payload.command === "string" ? event.payload.command : undefined
  const command = payloadCommand ?? event.sdkSubtype ?? ""
  return command.startsWith("/") ? command : `/${command}`
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
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          toolInputSummary: truncateString(event.toolInput, MAX_SUMMARY_LENGTH),
        }),
      }
    case "toolResult":
      const artifactLabel = event.imageArtifacts?.length
        ? `${event.toolName} (${event.imageArtifacts.length} image${event.imageArtifacts.length === 1 ? "" : "s"})`
        : event.toolName
      return {
        role: "tool",
        content: truncateString(
          event.content ? redactSensitiveText(event.content.trim()) : undefined,
          MAX_HISTORY_CONTENT_LENGTH,
        ) || artifactLabel,
        metadata: compactMetadata({
          agentEventType: event.type,
          sdkSessionId: event.sdkSessionId,
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          imageArtifacts: event.imageArtifacts,
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
          startedAt: event.timestamp,
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
          questions: event.questions,
        }),
      }
    case "error":
      return {
        role: "system",
        content: event.message,
        metadata: compactMetadata({
          agentEventType: event.type,
          sdkSessionId: event.sdkSessionId,
          errorKind: event.errorKind,
          recoverable: event.recoverable,
        }),
      }
    case "assistant": {
      const content = assistantEventText(event)
      if (!content) return null
      return {
        role: "assistant",
        content,
        metadata: compactMetadata({
          agentEventType: event.type,
          sdkSessionId: event.sdkSessionId,
        }),
      }
    }
    case "text":
    case "result":
    case "sessionInit":
    case "stream":
    case "status":
    case "compactBoundary":
      return null
    case "sdkEvent":
      if (event.sdkType === "nativeSlashPassthrough") {
        const command = nativeSlashCommandFromEvent(event)
        return {
          role: "system",
          content: `SDK nativeSlashPassthrough ${command}`,
          metadata: compactMetadata({
            agentEventType: event.type,
            sdkSessionId: event.sdkSessionId,
            sdkType: event.sdkType,
            sdkSubtype: command,
          }),
        }
      }
      return null
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

function terminalResultHistoryEntry(event: AgentEvent): Pick<
  ConversationEntryV1["history"][number],
  "role" | "content" | "metadata"
> | null {
  if (event.type !== "result" || event.content.trim().length > 0 || !event.metadata?.turnOutcome) return null
  return {
    role: "assistant",
    content: "",
    metadata: compactMetadata({
      ...event.metadata,
      agentEventType: event.type,
      sdkSessionId: event.sdkSessionId,
    }),
  }
}

function isAgentStreamEvent(event: AgentEvent): event is Extract<AgentEvent, { type: "stream" }> {
  return event.type === "stream"
}

function isAgentStreamDeltaEvent(event: AgentEvent): event is Extract<AgentEvent, { type: "stream" }> {
  if (!isAgentStreamEvent(event)) return false
  if (event.deltaType?.endsWith("_delta")) return true
  return event.event.type === "content_block_delta"
}

function streamedThinkingDelta(event: AgentEvent): string {
  if (!isAgentStreamEvent(event)) return ""
  return event.deltaType === "thinking_delta" ? event.thinking ?? "" : ""
}

function resultHistoryMetadata(
  event: Extract<AgentEvent, { type: "result" }>,
): ConversationEntryV1["history"][number]["metadata"] | undefined {
  const turnUsage = resultUsageFromEvent(event)
  const metadata = compactMetadata({
    ...event.metadata,
    sdkSessionId: event.sdkSessionId,
    usage: turnUsage,
    turnUsage,
    modelUsage: resultModelUsageFromEvent(event),
    sdkResultUuid: resultSdkResultUuidFromEvent(event),
    costUsd: resultCostFromEvent(event),
    costCny: resultCostCnyFromEvent(event),
    costCurrency: resultCostCurrencyFromEvent(event),
  })
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function resultUsageFromEvent(event: Extract<AgentEvent, { type: "result" }>): Record<string, unknown> | undefined {
  return event.metadata?.usage ?? event.usage
}

function sdkResultUsageFromError(event: Extract<AgentEvent, { type: "error" }>): Record<string, unknown> | undefined {
  return event.usage
}

function latestAgentErrorEvent(events: readonly AgentEvent[]): Extract<AgentEvent, { type: "error" }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === "error") return event
  }
  return undefined
}

function resultModelUsageFromEvent(event: Extract<AgentEvent, { type: "result" }>): Record<string, unknown> | undefined {
  return event.metadata?.modelUsage ?? event.modelUsage
}

function resultSdkResultUuidFromEvent(event: Extract<AgentEvent, { type: "result" }>): string | undefined {
  return event.metadata?.sdkResultUuid ?? event.sdkResultUuid
}

function resultCostFromEvent(event: Extract<AgentEvent, { type: "result" }>): number | undefined {
  return event.metadata?.costUsd ?? event.costUsd
}

function resultCostCnyFromEvent(event: Extract<AgentEvent, { type: "result" }>): number | undefined {
  return event.metadata?.costCny ?? event.costCny
}

function resultCostCurrencyFromEvent(event: Extract<AgentEvent, { type: "result" }>): "CNY" | undefined {
  const value = event.metadata?.costCurrency ?? event.costCurrency
  return value === "CNY" ? value : undefined
}

function compactMetadata(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  )
}

function mergeHistoryMetadata(
  ...items: Array<ConversationEntryV1["history"][number]["metadata"] | undefined>
): ConversationEntryV1["history"][number]["metadata"] | undefined {
  const metadata = compactMetadata(Object.assign({}, ...items.filter(Boolean)))
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

function mainThreadPersonaHistoryMetadata(
  conversation: ConversationEntryV1,
): ConversationEntryV1["history"][number]["metadata"] | undefined {
  const snapshot = conversation.agentConfig?.activeMainThreadPersonaSnapshot
  if (!snapshot) return undefined
  return {
    mainThreadPersona: {
      id: snapshot.id,
      name: snapshot.name,
      source: snapshot.source,
      definitionHash: snapshot.definitionHash,
    },
  }
}

function metadataWithoutLocalCost(
  metadata: ConversationEntryV1["history"][number]["metadata"] | undefined,
): ConversationEntryV1["history"][number]["metadata"] | undefined {
  if (!metadata) return undefined
  const rest = { ...metadata }
  delete rest.costCny
  delete rest.costBreakdownCny
  delete rest.costCurrency
  delete rest.totalCostCny
  delete rest.totalCostBreakdownCny
  delete rest.estimatedCost
  return Object.keys(rest).length > 0 ? rest : undefined
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key]
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function sumAssistantMetadataNumber(
  history: readonly ConversationEntryV1["history"][number][],
  key: string,
): number {
  return history.reduce((total, entry) => {
    if (entry.role !== "assistant") return total
    return total + (metadataNumber(entry.metadata, key) ?? 0)
  }, 0)
}

function sumAssistantMetadataCostBreakdown(
  history: readonly ConversationEntryV1["history"][number][],
  key: string,
): Record<string, number> | undefined {
  return history.reduce<Record<string, number> | undefined>((total, entry) => {
    if (entry.role !== "assistant") return total
    const breakdown = metadataCostBreakdown(entry.metadata, key)
    if (!breakdown) return total
    return addCostBreakdowns(total, breakdown)
  }, undefined)
}

function normalizedModelUsageRecords(
  modelUsage: Record<string, unknown> | undefined,
): Record<string, ModelUsageBreakdown> | undefined {
  if (!modelUsage) return undefined
  const entries = Object.entries(modelUsage).flatMap(([modelName, rawUsage]) => {
    if (!isRecord(rawUsage)) return []
    const breakdown = usageTokenBreakdownFromRecord(rawUsage)
    return breakdown ? [[modelName, breakdown] as const] : []
  })
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function modelUsageRecordsFromBreakdowns(
  modelUsage: Record<string, ModelUsageBreakdown>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(Object.entries(modelUsage).map(([modelName, breakdown]) => [modelName, {
    inputTokens: breakdown.input,
    outputTokens: breakdown.output,
    cacheReadInputTokens: breakdown.cacheRead,
    cacheCreationInputTokens: breakdown.cacheWrite,
    ...(breakdown.reasoning > 0 ? { reasoningOutputTokens: breakdown.reasoning } : {}),
  }]))
}

function sumModelUsageBreakdowns(modelUsage: Record<string, ModelUsageBreakdown>): ModelUsageBreakdown {
  return Object.values(modelUsage).reduce<ModelUsageBreakdown>((total, breakdown) => ({
    input: total.input + breakdown.input,
    output: total.output + breakdown.output,
    cacheRead: total.cacheRead + breakdown.cacheRead,
    cacheWrite: total.cacheWrite + breakdown.cacheWrite,
    reasoning: total.reasoning + breakdown.reasoning,
  }), zeroUsageBreakdown())
}

function subtractModelUsageRecords(
  current: Record<string, ModelUsageBreakdown>,
  previous: Record<string, ModelUsageBreakdown>,
): Record<string, ModelUsageBreakdown> | undefined {
  if (Object.keys(previous).some((modelName) => !(modelName in current))) return undefined
  const entries: Array<readonly [string, ModelUsageBreakdown]> = []
  for (const [modelName, currentBreakdown] of Object.entries(current)) {
    const delta = subtractUsageBreakdowns(currentBreakdown, previous[modelName] ?? zeroUsageBreakdown())
    if (!delta) return undefined
    if (!isZeroUsageBreakdown(delta)) entries.push([modelName, delta])
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function hasMatchingModelUsageBreakdown(
  modelUsage: Record<string, ModelUsageBreakdown>,
  turnBreakdown: ModelUsageBreakdown,
): boolean {
  return Object.values(modelUsage).some((breakdown) => usageBreakdownsEqual(breakdown, turnBreakdown))
}

function subtractUsageBreakdowns(
  current: ModelUsageBreakdown,
  previous: ModelUsageBreakdown,
): ModelUsageBreakdown | undefined {
  const delta = {
    input: current.input - previous.input,
    output: current.output - previous.output,
    cacheRead: current.cacheRead - previous.cacheRead,
    cacheWrite: current.cacheWrite - previous.cacheWrite,
    reasoning: current.reasoning - previous.reasoning,
  }
  return Object.values(delta).some((value) => value < 0) ? undefined : delta
}

function usageBreakdownsEqual(a: ModelUsageBreakdown, b: ModelUsageBreakdown): boolean {
  return a.input === b.input
    && a.output === b.output
    && a.cacheRead === b.cacheRead
    && a.cacheWrite === b.cacheWrite
    && a.reasoning === b.reasoning
}

function isZeroUsageBreakdown(value: ModelUsageBreakdown): boolean {
  return usageBreakdownsEqual(value, zeroUsageBreakdown())
}

function zeroUsageBreakdown(): ModelUsageBreakdown {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  }
}

function recordMetadataValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = metadata?.[key]
  return isRecord(value) ? value : undefined
}

function isSdkTotalCostPayload(payload: Record<string, unknown> | undefined): boolean {
  const value = payload?.total_cost_usd
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function metadataCostBreakdown(metadata: Record<string, unknown> | undefined, key: string): Record<string, number> | undefined {
  const value = metadata?.[key]
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).flatMap(([entryKey, entryValue]) => {
    if (typeof entryValue !== "number" || !Number.isFinite(entryValue) || entryValue < 0) return []
    return [[entryKey, entryValue] as const]
  })
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function metadataUsageCostBreakdown(
  metadata: Record<string, unknown> | undefined,
  key: string,
): AgentUsageCostBreakdownCny | undefined {
  const value = metadata?.[key]
  if (!isRecord(value)) return undefined
  const input = finiteCostPart(value.input)
  const output = finiteCostPart(value.output)
  const cacheRead = finiteCostPart(value.cacheRead)
  const cacheWrite = finiteCostPart(value.cacheWrite)
  const reasoning = finiteCostPart(value.reasoning)
  if (
    input === undefined
    || output === undefined
    || cacheRead === undefined
    || cacheWrite === undefined
    || reasoning === undefined
  ) {
    return undefined
  }
  return { input, output, cacheRead, cacheWrite, reasoning }
}

function finiteCostPart(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function addCostBreakdowns(
  a: Record<string, number> | undefined,
  b: Record<string, number>,
): Record<string, number> {
  const keys = new Set([...(a ? Object.keys(a) : []), ...Object.keys(b)])
  return Object.fromEntries([...keys].map((key) => [key, roundCost((a?.[key] ?? 0) + (b[key] ?? 0))]))
}

function roundCost(value: number): number {
  return Number(value.toFixed(6))
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
    if (key === "imageBlocks") continue
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

function stripTransientImageBlocks<T extends AgentEvent>(event: T): T {
  if (event.type !== "toolResult" || !event.imageBlocks) return event
  const { imageBlocks: _imageBlocks, ...rest } = event
  return rest as T
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
    redactSensitiveText(value),
    MAX_SUMMARY_LENGTH,
  ) ?? ""
}

function permissionRelayDenyMessage(event: AgentPermissionRequestEvent): string {
  return isAskUserQuestionEvent(event)
    ? AGENT_RELAY_QUESTION_DENY_MESSAGE
    : AGENT_RELAY_PERMISSION_DENY_MESSAGE
}

function permissionRelayErrorMessage(event: AgentPermissionRequestEvent): string {
  return isAskUserQuestionEvent(event)
    ? AGENT_RELAY_QUESTION_ERROR_MESSAGE
    : AGENT_RELAY_PERMISSION_ERROR_MESSAGE
}

function permissionTimeoutMessage(event: AgentPermissionRequestEvent): string {
  return isAskUserQuestionEvent(event)
    ? AGENT_USER_QUESTION_TIMEOUT_MESSAGE
    : AGENT_PERMISSION_TIMEOUT_MESSAGE
}

function isAskUserQuestionEvent(event: AgentPermissionRequestEvent): boolean {
  return event.toolName === "AskUserQuestion"
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

function isAgentResponseActivityEvent(event: AgentEvent): boolean {
  return event.type === "assistant"
    || event.type === "text"
    || event.type === "thinking"
    || event.type === "toolUse"
    || event.type === "toolResult"
    || event.type === "permissionRequest"
    || event.type === "stream"
    || event.type === "result"
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

function hasTerminalTurnOutcome(event: AgentEvent | undefined): boolean {
  if (!event) return false
  if (event.type === "result") return Boolean(event.metadata?.turnOutcome)
  if (event.type === "error") return Boolean(event.turnOutcome)
  return false
}

function appendStreamedText(current: string, event: AgentEvent): string {
  if (event.type === "text") return `${current}${event.content}`
  if (event.type === "stream" && event.text) return `${current}${event.text}`
  return current
}
