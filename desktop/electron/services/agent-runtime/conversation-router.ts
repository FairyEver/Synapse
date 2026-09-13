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
  AGENT_RENDERER_UNAVAILABLE_MESSAGE,
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
import {
  AgentAttachmentDirectoryAuthorizationError,
  type SessionManager,
} from "./session-manager"
import type { AgentProjectAfterTurnInput, AgentProjectAfterTurnOutput } from "./project-contributions"
import {
  attachmentHistoryMetadata,
  userMessagePresentationHistoryMetadata,
  userMessagePresentationHistoryMetadataFromRefs,
} from "./attachments"
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
  AgentTurnAdmissionResult,
  AgentRuntimeRelayResult,
  AgentRuntimeTurnResult,
  AgentSteerResult,
  AgentToolResultEvent,
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
import {
  MAX_STREAM_DIAGNOSTIC_BYTES_PER_TURN,
  MAX_STREAM_DIAGNOSTIC_EVENTS_PER_TURN,
  type StreamDiagnosticCapture,
  type StreamDiagnosticChunkPayload,
} from "./stream-diagnostics"
import { agentConversationDeliveryOptions } from "./event-delivery"
import type { AttachmentStagingService } from "./attachment-staging-service"
import type { AgentFileCheckpointService } from "./agent-file-checkpoint-service"
import { persistContextContinuation, withContextContinuationUsage, type AgentContextRotation } from "./context-continuation"
import { buildContextRecoveryHandoff } from "./context-recovery"

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
    canDispatchAgentEvent?(target: ReplyTarget): boolean
    dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): Promise<void>
  }
  readonly agentEvents?: DataNamespace<AgentEventEntryV1>
  readonly agentArtifactStore?: AgentArtifactStore
  readonly attachmentStagingService?: AttachmentStagingService
  readonly fileCheckpoints?: AgentFileCheckpointService
  readonly getUsagePriceRules?: () => readonly ModelPriceRule[]
  readonly loadExperimentalSynapseToolRouterEnabled?: () => boolean | Promise<boolean>
  readonly loadEnabledConnectorIds?: () => readonly string[] | Promise<readonly string[]>
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
const MAX_TURN_RESULT_EVENTS = 512
const FILE_CHECKPOINT_EVENT_SEQUENCE_BASE = 1_000_000
const AFTER_TURN_EVENT_SEQUENCE_BASE = 1_100_000
const RENDERER_STREAM_FLUSH_MS = 50
const MAX_RENDERER_STREAM_BATCH_EVENTS = 128
const MAX_RENDERER_STREAM_BATCH_BYTES = 64 * 1024
const MAX_RENDERER_EVENT_TEXT_BYTES = 60 * 1024
const MAX_RENDERER_PENDING_STREAM_BYTES = 512 * 1024
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

interface PendingRendererStreamBatch {
  readonly message: AgentMessage
  readonly conversationId: string
  readonly events: Array<{
    readonly event: AgentEvent
    readonly sequence: number
    readonly timestamp: string
    readonly bytes: number
  }>
  bytes: number
  resyncRequired: boolean
  timer?: ReturnType<typeof setTimeout>
}

export interface ConversationTurnOptions {
  readonly abortSignal?: AbortSignal
  readonly liveEventTimeoutMs?: number
  readonly onResponseStarted?: () => void
  readonly turnId?: string
  readonly contextRecoveryPriority?: boolean
}

type AgentTurnSubmissionHandle =
  | {
    readonly accepted: true
    readonly conversationId: string
    readonly turnId: string
    readonly disposition: "started" | "queued"
    readonly queuePosition: number
    readonly completion: Promise<AgentRuntimeTurnResult>
  }
  | {
    readonly accepted: false
    readonly conversationId: string
    readonly reason: "rejected" | "queue_full"
    readonly result: AgentRuntimeTurnResult
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
  private readonly streamDiagnostics = new Map<string, StreamDiagnosticCapture>()
  private readonly rendererStreamBatches = new Map<string, PendingRendererStreamBatch>()
  private readonly rendererInFlightBatches = new Map<string, string>()
  private readonly rendererSubscriptions = new Map<number, string | null | undefined>()
  private readonly pausedRendererIds = new Set<number>()
  private readonly pausedRendererConversations = new Map<number, Set<string>>()
  private deliverySequence = 0
  private readonly deliveryEpoch = randomUUID()

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

  setRendererSubscription(
    rendererId: number,
    subscribed: boolean,
    conversationId?: string | null,
  ): void {
    const previous = this.rendererSubscriptions.get(rendererId)
    if (subscribed) this.rendererSubscriptions.set(rendererId, conversationId)
    else this.rendererSubscriptions.delete(rendererId)
    if (!subscribed || previous !== conversationId) this.clearRendererDeliveryState(rendererId)
  }

  ackRendererEventBatch(rendererId: number, conversationId: string, batchId: string): boolean {
    const key = `${this.deps.projectId}:${conversationId}`
    if (this.rendererInFlightBatches.get(key) !== `${rendererId}:${batchId}`) return false
    this.rendererInFlightBatches.delete(key)
    this.flushRendererStreamBatch(key)
    return true
  }

  detachRenderer(rendererId: number): void {
    this.rendererSubscriptions.delete(rendererId)
    this.pausedRendererIds.delete(rendererId)
    this.pausedRendererConversations.delete(rendererId)
    this.clearRendererDeliveryState(rendererId)
  }

  pauseRendererDelivery(rendererId: number): void {
    this.pausedRendererIds.add(rendererId)
    this.clearRendererDeliveryState(rendererId)
  }

  async resumeRendererDelivery(rendererId: number): Promise<void> {
    this.pausedRendererIds.delete(rendererId)
    const conversationIds = this.pausedRendererConversations.get(rendererId)
    this.pausedRendererConversations.delete(rendererId)
    if (!conversationIds || conversationIds.size === 0) return
    for (const conversationId of conversationIds) {
      const conversation = await this.repository.get(conversationId)
      if (!conversation) continue
      this.emitRendererResync(rendererId, conversation)
    }
  }

  private clearRendererDeliveryState(rendererId: number): void {
    for (const [key, pending] of this.rendererStreamBatches) {
      if (pending.message.originRendererId !== rendererId) continue
      if (pending.timer) clearTimeout(pending.timer)
      this.rendererStreamBatches.delete(key)
      this.rendererInFlightBatches.delete(key)
    }
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

  async submitToConversation(
    message: AgentMessage,
    conversationId: string,
    options: ConversationTurnOptions = {},
  ): Promise<AgentTurnAdmissionResult> {
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
    const submission = await this.admitTurn(effectiveMessage, effectiveConversation, options)
    if (!submission.accepted) {
      return {
        accepted: false,
        conversationId: submission.conversationId,
        reason: submission.reason,
        error: submission.result.error ?? AGENT_TURN_FAILED_MESSAGE,
      }
    }
    void submission.completion.catch((error) => {
      this.deps.logger?.warn("Detached Agent turn completion failed.", {
        boundary: "agent-runtime.detached-turn",
        projectId: this.deps.projectId,
        conversationId: submission.conversationId,
        turnId: submission.turnId,
        ...queuedTurnFailureMetadata(error),
      })
    })
    return {
      accepted: true,
      conversationId: submission.conversationId,
      turnId: submission.turnId,
      disposition: submission.disposition,
      queuePosition: submission.queuePosition,
    }
  }

  async steer(input: {
    readonly conversationId: string
    readonly expectedTurnId: string
    readonly clientMessageId: string
    readonly content: string
    readonly submittedAt: string
  }): Promise<AgentSteerResult> {
    const state = this.sessionManager.stateForConversation(input.conversationId)
    const base = {
      conversationId: input.conversationId,
      clientMessageId: input.clientMessageId,
    }
    if (!state.busy || !state.activeLifecycle) return { ...base, status: "no-active-turn" }
    if (state.activeLifecycle.turnId !== input.expectedTurnId) {
      return { ...base, status: "turn-changed", turnId: state.activeLifecycle.turnId }
    }
    if (state.cancelState || state.activeLifecycle.state === "cancelling" || state.activeLifecycle.state === "force_cancelling") {
      return { ...base, status: "cancel-pending", turnId: state.activeLifecycle.turnId }
    }
    if (state.permissionAdmissionPending || state.pending) {
      return { ...base, status: "permission-pending", turnId: state.activeLifecycle.turnId }
    }
    if (!state.steerAdmissionsOpen) {
      return { ...base, status: "turn-changed", turnId: state.activeLifecycle.turnId }
    }
    const liveSession = state.liveSession
    if (!liveSession?.alive()) {
      return { ...base, status: "session-ended", turnId: state.activeLifecycle.turnId }
    }
    if (!liveSession.steer) {
      return { ...base, status: "unsupported", turnId: state.activeLifecycle.turnId }
    }

    state.activeSteers ??= new Map()
    const existing = state.activeSteers.get(input.clientMessageId)
    if (existing) {
      if (existing.content !== input.content) {
        return { ...base, status: "unsupported", turnId: state.activeLifecycle.turnId }
      }
      const accepted = await existing.acceptance
      if (accepted) await existing.historyPersistence
      return { ...base, status: accepted ? "accepted" : "session-ended", turnId: input.expectedTurnId }
    }
    const acceptance = liveSession.steer({
      clientMessageId: input.clientMessageId,
      content: input.content,
      submittedAt: input.submittedAt,
    }).catch((error) => {
      this.deps.logger?.warn("Agent live session rejected steer input.", {
        boundary: "agent-runtime.steer-input",
        projectId: this.deps.projectId,
        conversationId: input.conversationId,
        turnId: input.expectedTurnId,
        clientMessageId: input.clientMessageId,
        ...queuedTurnFailureMetadata(error),
      })
      return false
    })
    const activeSteer = {
      content: input.content,
      submittedAt: input.submittedAt,
      replayed: false,
      acceptance,
      historyPersistence: undefined as Promise<void> | undefined,
    }
    state.activeSteers.set(input.clientMessageId, activeSteer)
    activeSteer.historyPersistence = acceptance.then(async (accepted) => {
      if (accepted) await this.persistAcceptedSteer(input)
    })
    const accepted = await activeSteer.acceptance
    if (!accepted) {
      if (state.activeSteers.get(input.clientMessageId) === activeSteer) {
        state.activeSteers.delete(input.clientMessageId)
      }
      return { ...base, status: "session-ended", turnId: input.expectedTurnId }
    }
    await activeSteer.historyPersistence
    return { ...base, status: "accepted", turnId: input.expectedTurnId }
  }

  private async persistAcceptedSteer(input: {
    readonly conversationId: string
    readonly expectedTurnId: string
    readonly clientMessageId: string
    readonly content: string
  }): Promise<void> {
    try {
      const conversation = await this.repository.appendHistory(
        input.conversationId,
        "user",
        input.content,
        {
          messageKind: "steer",
          clientMessageId: input.clientMessageId,
          turnId: input.expectedTurnId,
        },
      )
      this.emitConversationUpdated(conversation)
    } catch (error) {
      this.deps.logger?.warn("Agent steer history persistence failed after SDK acceptance.", {
        boundary: "agent-runtime.steer-history",
        projectId: this.deps.projectId,
        conversationId: input.conversationId,
        turnId: input.expectedTurnId,
        clientMessageId: input.clientMessageId,
        ...queuedTurnFailureMetadata(error),
      })
    }
  }

  async sendNewSession(
    message: AgentMessage,
    name: string,
    options: NewConversationTurnOptions = {},
  ): Promise<AgentRuntimeTurnResult> {
    this.assertProject(message)
    const providerId = await this.resolveNewConversationProviderId(message)
    const experimentalSynapseToolRouterEnabled = await this.loadExperimentalSynapseToolRouterEnabled()
    const connectorIds = await this.loadEnabledConnectorIds()
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
      experimentalSynapseToolRouterEnabled,
      connectorIds,
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

    const governance = this.deps.governance?.evaluateMessage(message)
    if (governance && !governance.allowed) {
      return {
        ...this.finishWithError(message, "", governance.reason ?? AGENT_MESSAGE_BLOCKED_MESSAGE),
        timedOut: false,
      }
    }

    const ac = new AbortController()
    const providerId = await this.resolveNewConversationProviderId(message)
    const experimentalSynapseToolRouterEnabled = await this.loadExperimentalSynapseToolRouterEnabled()
    const connectorIds = await this.loadEnabledConnectorIds()
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
      experimentalSynapseToolRouterEnabled,
      connectorIds,
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
    const submission = await this.admitTurn(message, conversation, options)
    return submission.accepted ? submission.completion : submission.result
  }

  private async admitTurn(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    options: ConversationTurnOptions = {},
  ): Promise<AgentTurnSubmissionHandle> {
    this.deps.replyTargets?.rememberReplyTarget(replyTargetFromMessage(message, conversation.id))
    const governance = this.deps.governance?.evaluateMessage(message)
    if (governance && !governance.allowed) {
      return {
        accepted: false,
        conversationId: conversation.id,
        reason: "rejected",
        result: this.finishWithError(message, conversation.id, governance.reason ?? AGENT_MESSAGE_BLOCKED_MESSAGE),
      }
    }

    const turnId = options.turnId ?? randomUUID()
    const lifecycle = createTurnLifecycle({
      turnId,
      conversationId: conversation.id,
      now: () => this.isoNow(),
    })
    let liveMessage = message
    let liveContentOverride: string | undefined
    let nativeSlashPassthrough: Extract<AgentCommandRouterResult, { kind: "nativeSlash" }> | undefined
    const commandResult = await this.commandRouter?.handle(message, conversation, { turnId })
    if (commandResult && isPromptCommandRoute(commandResult)) {
      liveContentOverride = commandResult.content
    } else if (commandResult && isNativeSlashRoute(commandResult)) {
      nativeSlashPassthrough = commandResult
    } else if (commandResult) {
      for (const [index, event] of commandResult.events.entries()) {
        this.emitEvent(message, commandResult.conversationId, event)
        await this.persistAgentEvent(commandResult.conversationId, turnId, index + 1, event)
        await this.saveEventHistory(commandResult.conversationId, event)
      }
      return {
        accepted: true,
        conversationId: commandResult.conversationId,
        turnId,
        disposition: "started",
        queuePosition: 0,
        completion: Promise.resolve(commandResult),
      }
    }

    const state = this.sessionManager.stateForConversation(conversation.id, message)
    if (state.busy && state.queue.length >= this.queueLimit()) {
      return {
        accepted: false,
        conversationId: conversation.id,
        reason: "queue_full",
        result: this.finishWithError(message, conversation.id, AGENT_QUEUE_FULL_MESSAGE),
      }
    }
    message = await this.prepareStagedAttachmentMessage(message, conversation, turnId)
    liveMessage = liveContentOverride === undefined
      ? message
      : { ...message, content: liveContentOverride }
    const userHistoryMetadata = await this.prepareUserMessageHistory(message)

    const disposition = state.busy ? "queued" as const : "started" as const
    const recoveryPriority = options.contextRecoveryPriority || Boolean(conversation.contextRecovery)
    const queuePosition = state.busy ? recoveryPriority ? 1 : state.queue.length + 1 : 0
    const completion = new Promise<AgentRuntimeTurnResult>((resolve) => {
      const turn = {
        message,
        conversationId: conversation.id,
        turnId,
        lifecycle,
        userHistoryMetadata,
        abortSignal: options.abortSignal,
        liveEventTimeoutMs: options.liveEventTimeoutMs,
        onResponseStarted: options.onResponseStarted,
        resolve,
      }
      this.liveMessages.set(turn, liveMessage)
      if (nativeSlashPassthrough) {
        this.nativeSlashPassthroughs.set(turn, nativeSlashPassthrough)
      }
      if (recoveryPriority) {
        state.contextRecoveryPaused = false
        state.queue.unshift(turn)
      } else {
        state.queue.push(turn)
      }
      if (!state.busy) {
        state.busy = true
        void this.processQueue(state)
      } else if (options.abortSignal) {
        const onAbort = () => {
          const idx = state.queue.indexOf(turn)
          if (idx >= 0) {
            state.queue.splice(idx, 1)
            void (async () => {
              await this.rollbackStagedAttachmentMessage(message, conversation.id, turnId)
              await this.deps.agentArtifactStore?.removeUserMessageArtifactsForTurn(
                conversation.id,
                turnId,
              )
              resolve(this.buildCancelledResult(message, conversation.id))
            })()
          }
        }
        if (options.abortSignal.aborted) {
          onAbort()
        } else {
          options.abortSignal.addEventListener("abort", onAbort, { once: true })
        }
      }
    })
    return {
      accepted: true,
      conversationId: conversation.id,
      turnId,
      disposition,
      queuePosition,
      completion,
    }
  }

  private async processQueue(state: RuntimeSessionState): Promise<void> {
    try {
      while (state.queue.length > 0) {
        if (state.contextRecoveryPaused) break
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
            await this.rollbackStagedAttachmentMessage(turn.message, turn.conversationId, turn.turnId)
            await this.deps.agentArtifactStore?.removeUserMessageArtifactsForTurn(
              turn.conversationId,
              turn.turnId,
            )
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
            turn.userHistoryMetadata,
            ac.signal,
            turn.liveEventTimeoutMs,
            turn.onResponseStarted,
          )
          if (ac.signal.aborted && !isRendererUnavailableResult(result)) {
            await this.rollbackStagedAttachmentMessage(turn.message, turn.conversationId, turn.turnId)
            turn.resolve(this.buildCancelledResult(turn.message, turn.conversationId))
          } else {
            if (result.error) {
              await this.rollbackStagedAttachmentMessage(turn.message, turn.conversationId, turn.turnId)
            }
            turn.resolve(result)
          }
        } catch (error) {
          await this.rollbackStagedAttachmentMessage(turn.message, turn.conversationId, turn.turnId)
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
            const result = this.finishWithError(
              turn.message,
              turn.conversationId,
              messageText,
              error instanceof AgentAttachmentDirectoryAuthorizationError,
            )
            await this.persistFailureEvent(turn.conversationId, result.events[0])
            turn.resolve(result)
          }
        } finally {
          if (
            (turn.message.attachmentRefs?.length ?? 0) > 0
            || (turn.message.contextRecoveryTurnId && (turn.message.attachments?.length ?? 0) > 0)
          ) {
            await this.sessionManager.closeCurrentTurn(turn.conversationId)
          }
          externalSignal?.removeEventListener("abort", abort)
          this.nativeSlashPassthroughs.delete(turn)
          state.turnAbortController = undefined
          if (state.activeLifecycle?.turnId === turn.turnId) {
            state.activeLifecycle = undefined
          }
          state.steerAdmissionsOpen = false
          state.permissionAdmissionPending = false
          state.activeSteers = undefined
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
    userHistoryMetadata: Record<string, unknown> | undefined,
    abortSignal?: AbortSignal,
    liveEventTimeoutMs?: number,
    onResponseStarted?: () => void,
  ): Promise<AgentRuntimeTurnResult> {
    state.activeTurns += 1
    state.activeRendererId = message.platform === "local-renderer" ? message.originRendererId : undefined
    state.rendererUnavailable = false
    state.lastActivity = Date.now()
    try {
      let conversation = await this.repository.get(conversationId)
      if (!conversation) {
        await this.deps.agentArtifactStore?.removeUserMessageArtifactsForTurn(conversationId, turnId)
        throw new Error(`Conversation "${conversationId}" was deleted while queued`)
      }
      const recovery = conversation.contextRecovery
      const isRecoveryContinuation = recovery?.status === "prepared"
        && recovery.failedTurnId === message.contextRecoveryTurnId
      const recoveryHandoff = isRecoveryContinuation
        ? buildContextRecoveryHandoff({
            conversation,
            workspacePath: message.workspacePath ?? conversation.workspacePath ?? this.deps.workDir,
          })
        : undefined
      if (recovery) {
        conversation = await this.repository.clearContextRecovery(conversation.id)
        this.emitConversationUpdated(conversation)
      }
      conversation = await this.appendUserMessageHistory(
        conversation,
        message,
        turnId,
        userHistoryMetadata,
      )
      this.emitConversationUpdated(conversation)
      await this.appendSupersededCheckpointEvents(message, conversation, turnId)

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
        const preparedMessageBase = recoveryHandoff
          ? { ...liveMessage, content: recoveryHandoff }
          : liveMessage
        const preparedMessage = await Promise.resolve(this.deps.prepareMessage?.(preparedMessageBase, {
          isNewLiveSession: sessionHandle.created,
          conversationId: conversation.id,
          turnId,
        }) ?? preparedMessageBase)
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
        await this.appendFileCheckpointEvent(message, result, conversation.id, turnId, (state.liveSession ?? sessionHandle.liveSession))
        await this.appendAfterTurnEvents(message, result, conversation.id, turnId, sessionHandle.created)

        await this.handleContextCapacityFailure({ state, message, conversation, turnId, result })

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
      state.activeRendererId = undefined
      state.rendererUnavailable = false
      state.lastActivity = Date.now()
    }
  }

  private async handleContextCapacityFailure(input: {
    readonly state: RuntimeSessionState
    readonly message: AgentMessage
    readonly conversation: ConversationEntryV1
    readonly turnId: string
    readonly result: AgentRuntimeTurnResult
  }): Promise<void> {
    const errorEvent = latestAgentErrorEvent(input.result.events)
    const errorKind = errorEvent?.errorKind
    const requestBodyTooLarge = errorKind === "request_body_too_large"
    const contextRefillThrashing = errorKind === "context_refill_thrashing"
    if (!requestBodyTooLarge && !contextRefillThrashing) return
    if (requestBodyTooLarge && (
      input.state.sdkSettings?.autoCompactEnabled !== true
      || input.state.sdkSettings.autoCompactWindow !== 200_000
    )) return

    await this.sessionManager.closeCurrentTurn(input.conversation.id)
    this.forgetSavedSdkSession(input.conversation.id)
    input.state.contextRecoveryPaused = input.message.platform === "local-renderer"
    const updated = input.message.platform === "local-renderer"
      ? await this.repository.markContextRecoveryRequired(
          input.conversation.id,
          input.turnId,
          input.conversation.agentType,
          errorKind,
        )
      : await this.repository.clearCurrentAgentSessionId(
          input.conversation.id,
          input.conversation.agentType,
        )
    this.emitConversationUpdated(updated)
    this.deps.logger?.warn("Agent context capacity recovery is required.", {
      boundary: "agent-runtime.context-recovery.required",
      projectId: this.deps.projectId,
      conversationId: input.conversation.id,
      providerId: input.message.providerId ?? input.conversation.providerId,
      errorKind,
      providerScope: requestBodyTooLarge ? "bailian-cn" : undefined,
      autoCompactWindowTokens: input.state.sdkSettings?.autoCompactWindow,
      maxRequestBodyBytes: requestBodyTooLarge ? 6 * 1024 * 1024 : undefined,
      failedTurnId: input.turnId,
      lastTrustedContextTokens: latestContextUsedTokens(input.result.events),
      recoveryStatus: input.message.platform === "local-renderer" ? "required" : "not-applicable",
      attachmentCount: (input.message.attachments?.length ?? 0) + (input.message.attachmentRefs?.length ?? 0),
      attachmentBytes: [
        ...(input.message.attachments ?? []),
        ...(input.message.attachmentRefs ?? []),
      ].reduce((total, attachment) => total + (
        "byteSize" in attachment
          ? attachment.byteSize
          : attachment.size ?? 0
      ), 0),
    })
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

  private async rotateContextSession(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversationId: string,
    turnId: string,
    liveSession: AgentLiveSession,
    abortSignal?: AbortSignal,
    nextSequence?: () => number,
  ): Promise<AgentLiveSession> {
    const checkAdmission = (): void => {
      if (state.cancelState || state.rendererUnavailable || abortSignal?.aborted) throw new Error(AGENT_CANCELLED_MESSAGE)
    }
    checkAdmission()
    await Promise.all([...state.activeSteers?.values() ?? []].map((steer) => steer.historyPersistence))
    checkAdmission()
    const rotation = liveSession.contextRotation?.()
    const store = this.deps.agentArtifactStore
    const conversation = await this.repository.get(conversationId)
    checkAdmission()
    if (!rotation || !store || !conversation) throw new Error("上下文交接资料不可用。")
    try {
      const content = await persistContextContinuation({
        store, projectId: this.deps.projectId, conversation, turnId,
        workspacePath: message.workspacePath ?? this.deps.workDir,
        runtimeMessage: message.content, rotation, abortSignal,
      })
      checkAdmission()
      // Persist before closing; the old SDK is paused at a request boundary.
      // A new SDK cannot rewind files changed in its predecessor.
      await this.appendFileCheckpointEvent(message, {
        conversationId, events: [], resultText: "",
      }, conversationId, turnId, liveSession, nextSequence)
      checkAdmission()
      await this.sessionManager.closeCurrentTurn(conversationId)
      checkAdmission()
      this.forgetSavedSdkSession(conversationId)
      const clean = await this.repository.clearCurrentAgentSessionId(conversationId, conversation.agentType)
      if (state.cancelState || state.rendererUnavailable || abortSignal?.aborted) throw new Error(AGENT_CANCELLED_MESSAGE)
      await this.appendSupersededCheckpointEvents(message, clean, turnId, nextSequence)
      checkAdmission()
      await this.checkRendererAgentSpawn(message, clean)
      checkAdmission()
      const handle = await this.sessionManager.getOrCreateSession({ state, conversation: clean, message, abortSignal })
      if (state.cancelState || state.rendererUnavailable || abortSignal?.aborted) {
        await this.sessionManager.closeCurrentTurn(conversationId)
        throw new Error(AGENT_CANCELLED_MESSAGE)
      }
      if (message.platform === "local-renderer") handle.liveSession.beginFileCheckpoint?.(turnId)
      if (!await handle.liveSession.send({ ...message, content, runtimeTurnId: turnId, attachments: undefined })) {
        throw new Error(AGENT_SESSION_ENDED_BEFORE_SEND_MESSAGE)
      }
      this.deps.logger?.info("Agent continued after automatic context rotation.", {
        boundary: "agent-runtime.context-rotation", projectId: this.deps.projectId,
        conversationId, turnId, reason: rotation.reason, completedBatches: rotation.completedBatches,
      })
      return handle.liveSession
    } catch (error) {
      await this.sessionManager.closeCurrentTurn(conversationId)
      if (state.cancelState || abortSignal?.aborted) throw new Error(AGENT_CANCELLED_MESSAGE, { cause: error })
      throw new Error("无法保存或恢复上下文，请重试。", { cause: error })
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
    let persistedSequence = 0
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
    let stageAssistantPersisted = false
    let streamedThinking = ""
    let streamedThinkingStartedAt: string | undefined
    let error: string | undefined
    let responseStarted = false
    let rotationsWithoutProgress = 0
    const contextRotations: Pick<AgentContextRotation, "usage">[] = []

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
    const persistRendererLossPartial = async (): Promise<void> => {
      if (!state.rendererUnavailable || assistantHistoryPersisted) return
      const content = latestAssistantText || streamedText
      if (!content.trim()) return
      const partialEvent: AgentEvent = {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: content }] },
        content,
        conversationId: conversation.id,
        providerId: message.providerId ?? conversation.providerId,
        sdkSessionId: liveSession.currentSessionId(),
        timestamp: this.isoNow(),
      }
      appendBoundedTurnEvent(events, partialEvent)
      await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, partialEvent)
      assistantHistoryPersisted = await this.saveEventHistory(conversation.id, partialEvent, {
        assistantHistoryPersisted,
      }) || assistantHistoryPersisted
      resultText = content
    }

    if (message.platform === "local-renderer") liveSession.beginFileCheckpoint?.(turnId)
    state.activeSteers = new Map()
    state.steerAdmissionsOpen = true
    const accepted = await liveSession.send({ ...message, runtimeTurnId: turnId })
    if (!accepted) {
      state.steerAdmissionsOpen = false
      await this.sessionManager.closeCurrentTurn(conversation.id)
      error = AGENT_SESSION_ENDED_BEFORE_SEND_MESSAGE
    } else if (nativeSlashPassthrough) {
      const event = nativeSlashPassthroughEvent(nativeSlashPassthrough, liveSession.currentSessionId(), this.isoNow())
      appendBoundedTurnEvent(events, event)
      this.emitEvent(message, conversation.id, event)
      await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, event)
      await this.saveEventSdkSession(conversation.id, event, liveSession)
      await this.saveEventHistory(conversation.id, event)
    }
    while (!error && liveSession.alive()) {
      const event = await nextLiveEventWithTimeout(liveSession, liveEventTimeoutMs)
      if (!event) {
        state.steerAdmissionsOpen = false
        error = liveSession.alive() ? AGENT_SESSION_TIMED_OUT_MESSAGE : AGENT_SESSION_ENDED_MESSAGE
        if (liveSession.alive()) {
          await this.sessionManager.closeCurrentTurn(conversation.id)
        }
        break
      }
      if (event.type === "sdkEvent" && event.sdkType === "contextRotationRequested" && liveSession.contextRotation?.()) {
        state.steerAdmissionsOpen = false
        const rotation = liveSession.contextRotation()!
        contextRotations.push({ usage: rotation.usage })
        rotationsWithoutProgress = rotation.completedBatches > 0 ? 0 : rotationsWithoutProgress + 1
        if (rotationsWithoutProgress > 1 || state.cancelState || state.rendererUnavailable || abortSignal?.aborted) {
          await this.sessionManager.closeCurrentTurn(conversation.id)
          error = state.cancelState || abortSignal?.aborted ? AGENT_CANCELLED_MESSAGE
            : state.rendererUnavailable ? AGENT_RENDERER_UNAVAILABLE_MESSAGE
            : "当前模型的固定上下文已占满可用空间，请减少已加载的工具或指令。"
          break
        }
        await flushStreamedThinkingHistory()
        liveSession = await this.rotateContextSession(state, message, conversation.id, turnId, liveSession, abortSignal, () => ++persistedSequence)
        const compactEvent: AgentEvent = {
          type: "compactBoundary", payload: { automaticSessionRotation: true },
          conversationId: conversation.id, providerId: message.providerId ?? conversation.providerId,
          sdkSessionId: liveSession.currentSessionId(), timestamp: this.isoNow(),
        }
        appendBoundedTurnEvent(events, compactEvent)
        this.emitEvent(message, conversation.id, compactEvent)
        await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, compactEvent)
        await this.saveEventHistory(conversation.id, compactEvent)
        latestAssistantText = ""
        streamedText = ""
        assistantHistoryPersisted = false
        stageAssistantPersisted = false
        state.steerAdmissionsOpen = !state.cancelState
        continue
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
      } else if (event.type !== "sdkEvent") {
        await flushStreamedThinkingHistory()
      }

      if (isUserMessageReplayEvent(event)) {
        await markMatchingSteerReplayed(state, event)
        continue
      }

      if (state.rendererUnavailable) {
        state.steerAdmissionsOpen = false
        await persistRendererLossPartial()
        const projected = rendererUnavailableEvent({
          conversationId: conversation.id,
          providerId: message.providerId ?? conversation.providerId,
          sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
          timestamp: this.isoNow(),
        })
        appendBoundedTurnEvent(events, projected)
        this.emitEvent(message, conversation.id, projected)
        await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, projected)
        await this.saveEventHistory(conversation.id, projected)
        error = projected.message
        break
      }

      if (event.type === "result") {
        resultText = latestAssistantText || event.content || streamedText
        if ((event.queuedTurnCount ?? 0) > 0) {
          if (resultText && !stageAssistantPersisted) {
            const stageEvent: AgentEvent = {
              type: "assistant",
              message: { role: "assistant", content: [{ type: "text", text: resultText }] },
              content: resultText,
              conversationId: conversation.id,
              providerId: message.providerId ?? conversation.providerId,
              sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
              timestamp: event.timestamp ?? this.isoNow(),
            }
            appendBoundedTurnEvent(events, stageEvent)
            this.emitEvent(message, conversation.id, stageEvent)
            await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, stageEvent)
            assistantHistoryPersisted = await this.saveEventHistory(conversation.id, stageEvent, {
              assistantHistoryPersisted,
            }) || assistantHistoryPersisted
          }
          stageAssistantPersisted = false
          latestAssistantText = ""
          streamedText = ""
          continue
        }
        state.steerAdmissionsOpen = false
        const finalized = await this.finalizeResultUsageMetadata({
          state,
          conversation,
          message,
          event: withContextContinuationUsage(event, contextRotations),
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
        appendBoundedTurnEvent(events, finalized.event)
        this.emitEvent(message, conversation.id, finalized.event)
        await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, finalized.event)
        await this.saveEventSdkSession(conversation.id, finalized.event, liveSession)
        assistantHistoryPersisted = await this.saveEventHistory(conversation.id, finalized.event, {
          assistantHistoryPersisted,
        }) || assistantHistoryPersisted
        await this.repository.saveUsage({
          conversationId: conversation.id,
          usage: resultUsage as ConversationEntryV1["usage"] | undefined,
          costUsd: metadataNumber(resultMetadata, "totalCostUsd") ?? resultCostUsd,
          costCny: metadataNumber(resultMetadata, "totalCostCny") ?? resultCostCny,
          costCurrency: resultCostCurrency,
        })
        break
      }

      if (event.type === "error") {
        state.steerAdmissionsOpen = false
        const finalized = await this.finalizeErrorUsage({
          state,
          conversation,
          event: withContextContinuationUsage(event, contextRotations),
          turnId,
          sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
          userMeta: message.userMeta ?? conversation.userMeta,
        })
        resultUsage = finalized.usage
        resultCostUsd = finalized.costUsd
        resultCostCny = finalized.costCny
        resultCostCurrency = finalized.costCurrency
        const enrichedError = finalized.event
        const lifecycle = state.activeLifecycle
        if (lifecycle) {
          const outcome = normalizeExecutorEvent(lifecycle, {
            type: "executor.error",
            diagnostic: diagnosticFromAgentError(enrichedError),
          })
          const projectedOutcome = outcomeToAgentEvent({
            outcome,
            conversationId: conversation.id,
            providerId: message.providerId ?? conversation.providerId,
            sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
            timestamp: this.isoNow(),
          })
          const projected = projectedOutcome.type === "error"
            ? {
                ...projectedOutcome,
                usage: enrichedError.usage,
                modelUsage: enrichedError.modelUsage,
                sdkResultUuid: enrichedError.sdkResultUuid,
                costUsd: enrichedError.costUsd,
                costCny: enrichedError.costCny,
                costCurrency: enrichedError.costCurrency,
                payload: enrichedError.payload,
              }
            : projectedOutcome
          appendBoundedTurnEvent(events, projected)
          this.emitEvent(message, conversation.id, projected)
          await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, projected)
          await this.saveEventSdkSession(conversation.id, projected, liveSession)
          assistantHistoryPersisted = await this.saveEventHistory(conversation.id, projected, {
            assistantHistoryPersisted,
          }) || assistantHistoryPersisted
          error = outcome.status === "completed" ? undefined : outcomeMessage(outcome)
          break
        }
        appendBoundedTurnEvent(events, enrichedError)
        this.emitEvent(message, conversation.id, enrichedError)
        await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, enrichedError)
        await this.saveEventSdkSession(conversation.id, enrichedError, liveSession)
        await this.saveEventHistory(conversation.id, enrichedError)
        error = enrichedError.message
        break
      }

      const preparedEvent = await this.prepareEventForStorageAndDisplay(conversation.id, turnId, event)
      if (preparedEvent.type === "permissionRequest") {
        state.permissionAdmissionPending = true
      }
      appendBoundedTurnEvent(events, preparedEvent)
      this.emitEvent(message, conversation.id, preparedEvent)
      await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, preparedEvent)
      await this.saveEventSdkSession(conversation.id, preparedEvent, liveSession)
      const preparedEventHistoryPersisted = await this.saveEventHistory(conversation.id, preparedEvent)
      assistantHistoryPersisted = preparedEventHistoryPersisted || assistantHistoryPersisted
      if (preparedEvent.type === "assistant" && preparedEventHistoryPersisted) {
        stageAssistantPersisted = true
      }

      if (preparedEvent.type === "permissionRequest") {
        const questionTimeoutFailed = await this.awaitPendingPermission(
          state,
          message,
          conversation.id,
          preparedEvent,
          liveSession,
          abortSignal,
        )
        state.permissionAdmissionPending = false
        if (questionTimeoutFailed) {
          state.steerAdmissionsOpen = false
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
            appendBoundedTurnEvent(events, projected)
            this.emitEvent(message, conversation.id, projected)
            await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, projected)
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
        if (!state.cancelState && liveSession.alive()) state.steerAdmissionsOpen = true
        continue
      }
    }

    if (state.rendererUnavailable && !error && !hasTerminalTurnOutcome(events[events.length - 1])) {
      error = AGENT_RENDERER_UNAVAILABLE_MESSAGE
    }
    if (!error && !events.some((event) => event.type === "result" || event.type === "error")) {
      error = AGENT_SESSION_ENDED_MESSAGE
    }
    await flushStreamedThinkingHistory()
    await persistRendererLossPartial()

    if (error && events[events.length - 1]?.type !== "error" && !hasTerminalTurnOutcome(events[events.length - 1])) {
      const errorEvent: AgentEvent = state.rendererUnavailable
        ? rendererUnavailableEvent({
            conversationId: conversation.id,
            providerId: message.providerId ?? conversation.providerId,
            sdkSessionId: liveSession.currentSessionId(),
            timestamp: this.isoNow(),
          })
        : {
            type: "error",
            message: sanitizeErrorText(error),
            conversationId: conversation.id,
            providerId: message.providerId ?? conversation.providerId,
            sdkSessionId: liveSession.currentSessionId(),
            timestamp: this.isoNow(),
          }
      appendBoundedTurnEvent(events, errorEvent)
      this.emitEvent(message, conversation.id, errorEvent)
      await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, errorEvent)
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
    for (const [index, event] of events.entries()) {
      appendBoundedTurnEvent(mutableEvents, event)
      this.emitEvent(message, conversationId, event)
      await this.persistAgentEvent(conversationId, turnId, AFTER_TURN_EVENT_SEQUENCE_BASE + index, event)
      await this.saveEventHistory(conversationId, event)
    }
  }

  private async appendFileCheckpointEvent(
    message: AgentMessage,
    result: AgentRuntimeTurnResult,
    conversationId: string,
    turnId: string,
    liveSession: AgentLiveSession,
    nextSequence?: () => number,
  ): Promise<void> {
    if (message.platform !== "local-renderer" || !this.deps.fileCheckpoints || !liveSession.finalizeFileCheckpoint) return
    try {
      const capture = await liveSession.finalizeFileCheckpoint()
      if (!capture) return
      const checkpointEvents = await this.deps.fileCheckpoints.persistCapture(conversationId, capture)
      const mutableEvents = result.events as AgentEvent[]
      for (const [index, event] of checkpointEvents.entries()) {
        appendBoundedTurnEvent(mutableEvents, event)
        this.emitEvent(message, conversationId, event)
        await this.persistAgentEvent(conversationId, turnId, nextSequence?.() ?? FILE_CHECKPOINT_EVENT_SEQUENCE_BASE + index, event)
        await this.saveEventHistory(conversationId, event)
      }
    } catch (error) {
      this.deps.logger?.warn("Agent file checkpoint persistence failed.", {
        boundary: "agent-runtime.file-checkpoint.persist",
        projectId: this.deps.projectId,
        conversationId,
        turnId,
        ...errorMetadata(error),
      })
    }
  }

  private async appendSupersededCheckpointEvents(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    turnId: string,
    nextSequence?: () => number,
  ): Promise<void> {
    if (message.platform !== "local-renderer" || !this.deps.fileCheckpoints) return
    try {
      const events = await this.deps.fileCheckpoints.supersedeAvailable(conversation.id)
      for (const [index, event] of events.entries()) {
        this.emitEvent(message, conversation.id, event)
        await this.persistAgentEvent(conversation.id, turnId, nextSequence?.() ?? index, event)
        await this.saveEventHistory(conversation.id, event)
      }
    } catch (error) {
      this.deps.logger?.warn("Agent file checkpoint supersede failed.", {
        boundary: "agent-runtime.file-checkpoint.supersede",
        projectId: this.deps.projectId,
        conversationId: conversation.id,
        turnId,
        ...errorMetadata(error),
      })
    }
  }

  async appendExternalEvent(
    conversation: ConversationEntryV1,
    event: AgentEvent,
  ): Promise<void> {
    const message: AgentMessage = {
      projectId: conversation.projectId,
      sessionKey: conversation.sessionKey,
      platform: conversation.platform ?? "local-renderer",
      workspaceKey: conversation.workspaceKey,
      workspacePath: conversation.workspacePath,
      content: "",
    }
    this.emitEvent(message, conversation.id, event)
    await this.persistAgentEvent(conversation.id, event.turnId ?? randomUUID(), 1, event)
    await this.saveEventHistory(conversation.id, event)
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
    let persistedSequence = 0
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
      message = await this.prepareStagedAttachmentMessage(message, conversation, turnId)
      const userHistoryMetadata = await this.prepareUserMessageHistory(message)
      const savedConversation = await this.appendUserMessageHistory(
        conversation,
        message,
        turnId,
        userHistoryMetadata,
      )
      const sessionHandle = await this.sessionManager.getOrCreateSession({
        state,
        conversation: savedConversation,
        message,
        abortSignal,
      })
      let liveSession = sessionHandle.liveSession
      let rotationsWithoutProgress = 0
      const contextRotations: Pick<AgentContextRotation, "usage">[] = []
      const liveMessage = await Promise.resolve(this.deps.prepareMessage?.(message, {
        isNewLiveSession: sessionHandle.created,
        conversationId: savedConversation.id,
        turnId,
      }) ?? message)
      const accepted = await liveSession.send({ ...liveMessage, runtimeTurnId: turnId })
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
          appendBoundedTurnEvent(events, errorEvent)
          this.emitEvent(message, conversation.id, errorEvent)
          await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, errorEvent)
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
        if (event.type === "sdkEvent" && event.sdkType === "contextRotationRequested" && liveSession.contextRotation?.()) {
          const rotation = liveSession.contextRotation()!
          contextRotations.push({ usage: rotation.usage })
          rotationsWithoutProgress = rotation.completedBatches > 0 ? 0 : rotationsWithoutProgress + 1
          if (rotationsWithoutProgress > 1 || abortSignal.aborted) {
            await this.sessionManager.closeCurrentTurn(conversation.id)
            error = abortSignal.aborted ? AGENT_CANCELLED_MESSAGE : "当前模型的固定上下文已占满可用空间。"
            break
          }
          liveSession = await this.rotateContextSession(state, liveMessage, conversation.id, turnId, liveSession, abortSignal, () => ++persistedSequence)
          latestAssistantText = ""
          assistantHistoryPersisted = false
          continue
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
            event: withContextContinuationUsage(event, contextRotations),
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
          appendBoundedTurnEvent(events, finalized.event)
          this.emitEvent(message, conversation.id, finalized.event)
          await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, finalized.event)
          await this.saveEventSdkSession(conversation.id, finalized.event, liveSession)
          assistantHistoryPersisted = await this.saveEventHistory(conversation.id, finalized.event, {
            assistantHistoryPersisted,
          }) || assistantHistoryPersisted
          await this.repository.saveUsage({
            conversationId: conversation.id,
            usage: resultUsage as ConversationEntryV1["usage"] | undefined,
            costUsd: metadataNumber(resultMetadata, "totalCostUsd") ?? resultCostUsd,
            costCny: metadataNumber(resultMetadata, "totalCostCny") ?? resultCostCny,
            costCurrency: resultCostCurrency,
          })
          break
        }
        if (event.type === "error") {
          const finalized = await this.finalizeErrorUsage({
            state,
            conversation,
            event: withContextContinuationUsage(event, contextRotations),
            turnId,
            sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
            userMeta: message.userMeta ?? conversation.userMeta,
          })
          resultUsage = finalized.usage
          resultCostUsd = finalized.costUsd
          resultCostCny = finalized.costCny
          resultCostCurrency = finalized.costCurrency
          const enrichedError = finalized.event
          const lifecycle = state.activeLifecycle
          if (lifecycle) {
            const outcome = normalizeExecutorEvent(lifecycle, {
              type: "executor.error",
              diagnostic: diagnosticFromAgentError(enrichedError),
            })
            const projectedOutcome = outcomeToAgentEvent({
              outcome,
              conversationId: conversation.id,
              providerId: message.providerId ?? conversation.providerId,
              sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
              timestamp: this.isoNow(),
            })
            const projected = projectedOutcome.type === "error"
              ? {
                  ...projectedOutcome,
                  usage: enrichedError.usage,
                  modelUsage: enrichedError.modelUsage,
                  sdkResultUuid: enrichedError.sdkResultUuid,
                  costUsd: enrichedError.costUsd,
                  costCny: enrichedError.costCny,
                  costCurrency: enrichedError.costCurrency,
                  payload: enrichedError.payload,
                }
              : projectedOutcome
            appendBoundedTurnEvent(events, projected)
            partialText = appendRelayText(partialText, projected)
            this.emitEvent(message, conversation.id, projected)
            await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, projected)
            await this.saveEventSdkSession(conversation.id, projected, liveSession)
            assistantHistoryPersisted = await this.saveEventHistory(conversation.id, projected, {
              assistantHistoryPersisted,
            }) || assistantHistoryPersisted
            error = outcome.status === "completed" ? undefined : outcomeMessage(outcome)
            break
          }
          appendBoundedTurnEvent(events, enrichedError)
          partialText = appendRelayText(partialText, enrichedError)
          this.emitEvent(message, conversation.id, enrichedError)
          await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, enrichedError)
          await this.saveEventSdkSession(conversation.id, enrichedError, liveSession)
          assistantHistoryPersisted = await this.saveEventHistory(conversation.id, enrichedError) || assistantHistoryPersisted
          error = enrichedError.message
          break
        }
        appendBoundedTurnEvent(events, event)
        partialText = appendRelayText(partialText, event)
        this.emitEvent(message, conversation.id, event)
        await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, event)
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
          appendBoundedTurnEvent(events, projected)
          this.emitEvent(message, conversation.id, projected)
          await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, projected)
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
        appendBoundedTurnEvent(events, errorEvent)
        this.emitEvent(message, conversation.id, errorEvent)
        await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, errorEvent)
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
      if (!error && !events.some((event) => event.type === "result" || event.type === "error")) {
        error = AGENT_SESSION_ENDED_MESSAGE
      }
      if (error && events[events.length - 1]?.type !== "error" && !hasTerminalTurnOutcome(events[events.length - 1])) {
        const errorResult = this.finishWithError(message, conversation.id, error)
        const errorEvent = errorResult.events[0]
        if (errorEvent) {
          appendBoundedTurnEvent(events, errorEvent)
          await this.persistAgentEvent(conversation.id, turnId, ++persistedSequence, errorEvent)
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

  private async prepareUserMessageHistory(
    message: AgentMessage,
  ): Promise<Record<string, unknown> | undefined> {
    if (message.contextRecoveryTurnId) {
      return userMessagePresentationHistoryMetadata({ ...message, attachments: undefined })
    }
    if (message.attachmentRefs && message.attachmentRefs.length > 0) {
      return userMessagePresentationHistoryMetadataFromRefs(message, message.attachmentRefs)
    }
    if (message.displayContent === undefined) {
      return attachmentHistoryMetadata(message.attachments)
    }
    return userMessagePresentationHistoryMetadata(message)
  }

  private async prepareStagedAttachmentMessage(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    turnId: string,
  ): Promise<AgentMessage> {
    const refs = message.attachmentRefs ?? []
    if (refs.length === 0) return message
    const service = this.deps.attachmentStagingService
    if (!service || !message.attachmentDraftScopeId) {
      throw new Error("Agent attachment staging is unavailable")
    }
    const attachmentIds = refs.map((ref) => ref.attachmentId)
    const committed = await service.commit({
      actor: rendererAgentActor(message),
      projectId: message.projectId,
      draftScopeId: message.attachmentDraftScopeId,
      attachmentIds,
      conversationId: conversation.id,
      turnId,
    })
    let runtime
    try {
      runtime = await service.resolveCommittedForRuntime({
        projectId: message.projectId,
        conversationId: conversation.id,
        turnId,
        attachmentIds,
      })
    } catch (error) {
      await service.rollbackCommit({
        actor: rendererAgentActor(message),
        projectId: message.projectId,
        draftScopeId: message.attachmentDraftScopeId,
        attachmentIds,
        conversationId: conversation.id,
        turnId,
      })
      throw error
    }
    const committedRefs = committed.map((item) => item.ref)
    return {
      ...message,
      attachmentRefs: committedRefs,
      attachments: runtime.attachments,
      runtimeAttachmentDirectories: runtime.controlledDirectories,
      attachmentTurnId: turnId,
    }
  }

  private async rollbackStagedAttachmentMessage(
    message: AgentMessage,
    conversationId: string,
    turnId: string,
  ): Promise<void> {
    const refs = message.attachmentRefs ?? []
    const service = this.deps.attachmentStagingService
    if (refs.length === 0 || !service || !message.attachmentDraftScopeId) return
    try {
      await service.rollbackCommit({
        actor: rendererAgentActor(message),
        projectId: message.projectId,
        draftScopeId: message.attachmentDraftScopeId,
        attachmentIds: refs.map((ref) => ref.attachmentId),
        conversationId,
        turnId,
      })
    } catch (error) {
      this.deps.logger?.warn("Agent attachment commit rollback failed.", {
        boundary: "agent-runtime.attachment.rollback",
        projectId: message.projectId,
        conversationId,
        turnId,
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
  }

  private async appendUserMessageHistory(
    conversation: ConversationEntryV1,
    message: AgentMessage,
    turnId: string,
    metadata: Record<string, unknown> | undefined,
  ): Promise<ConversationEntryV1> {
    try {
      return await this.repository.appendHistory(
        conversation.id,
        "user",
        message.content,
        mergeHistoryMetadata(metadata, mainThreadPersonaHistoryMetadata(conversation)),
      )
    } catch (error) {
      await this.deps.agentArtifactStore?.removeUserMessageArtifactsForTurn(conversation.id, turnId)
      throw error
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
    const experimentalSynapseToolRouterEnabled = await this.loadExperimentalSynapseToolRouterEnabled()
    const connectorIds = await this.loadEnabledConnectorIds()
    return this.repository.getOrCreateActive(
      { ...message, providerId },
      { experimentalSynapseToolRouterEnabled, connectorIds },
    )
  }

  private async loadExperimentalSynapseToolRouterEnabled(): Promise<boolean> {
    return (await this.deps.loadExperimentalSynapseToolRouterEnabled?.()) !== false
  }

  private async loadEnabledConnectorIds(): Promise<readonly string[]> {
    return [...new Set(await this.deps.loadEnabledConnectorIds?.() ?? [])]
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
        turnId: state.activeLifecycle?.turnId,
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolInputRaw: event.toolInputRaw,
        questions: event.questions,
        blockedPath: event.blockedPath,
        sessionDirectoryGrantAvailable: event.sessionDirectoryGrantAvailable,
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

  private async finalizeErrorUsage(input: {
    readonly state: RuntimeSessionState
    readonly conversation: ConversationEntryV1
    readonly event: Extract<AgentEvent, { type: "error" }>
    readonly turnId: string
    readonly sdkSessionId?: string
    readonly userMeta?: ConversationEntryV1["userMeta"]
  }): Promise<{
    readonly event: Extract<AgentEvent, { type: "error" }>
    readonly usage: Record<string, unknown> | undefined
    readonly costUsd: number | undefined
    readonly costCny: number | undefined
    readonly costCurrency: "CNY" | undefined
  }> {
    const turnCostUsd = this.normalizedEventCostUsd(
      input.conversation,
      input.event.costUsd,
      input.event.payload,
    )
    const usage = sdkResultUsageFromError(input.event)
    let turnCostCny: number | undefined
    if (usage) {
      const turnUsage = this.normalizedTurnUsage(
        input.conversation,
        usage,
        input.event.modelUsage,
        input.sdkSessionId,
      )
      turnCostCny = this.estimateLocalCostCny(
        input.state,
        usage,
        turnUsage.modelUsage,
      )?.total
      await this.repository.recordSdkResultUsage({
        conversationId: input.conversation.id,
        turnId: input.turnId,
        sdkResultUuid: input.event.sdkResultUuid,
        sdkSessionId: input.sdkSessionId,
        usage,
        usageSummary: turnUsage.summary,
        modelUsage: input.event.modelUsage,
        userMeta: input.userMeta ?? input.conversation.userMeta,
      })
    }
    if (turnCostUsd !== undefined || turnCostCny !== undefined) {
      await this.repository.saveUsage({
        conversationId: input.conversation.id,
        costUsd: turnCostUsd === undefined
          ? undefined
          : roundCost(sumHistoryMetadataNumber(input.conversation.history, "costUsd") + turnCostUsd),
        costCny: turnCostCny === undefined
          ? undefined
          : roundCost(sumHistoryMetadataNumber(input.conversation.history, "costCny") + turnCostCny),
        costCurrency: turnCostCny === undefined ? undefined : "CNY",
      })
    }
    const costCurrency = turnCostCny === undefined ? undefined : "CNY"
    return {
      event: {
        ...input.event,
        costUsd: turnCostUsd,
        costCny: turnCostCny,
        costCurrency,
      },
      usage,
      costUsd: usage ? turnCostUsd : undefined,
      costCny: turnCostCny,
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
    const previousCostCny = conversation ? sumHistoryMetadataNumber(conversation.history, "costCny") : 0
    const previousCostUsd = conversation ? sumHistoryMetadataNumber(conversation.history, "costUsd") : 0
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
      if (!entry) continue
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
    const previousCostUsd = sumHistoryMetadataNumber(conversation.history, "costUsd")
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
    if (isAgentStreamDeltaEvent(event)) {
      this.captureStreamDiagnostic(turnId, sequence, event)
      return
    }
    try {
      if (isTerminalAgentEvent(event)) {
        await this.flushStreamDiagnostics(conversationId, turnId)
      }
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
    } finally {
      if (isTerminalAgentEvent(event)) this.streamDiagnostics.delete(turnId)
    }
  }

  private captureStreamDiagnostic(turnId: string, sequence: number, event: AgentEvent): void {
    const capture = this.streamDiagnostics.get(turnId) ?? {
      frames: [],
      capturedBytes: 0,
      observedEventCount: 0,
      truncated: false,
    }
    capture.observedEventCount += 1
    if (capture.truncated) return

    const payload = sanitizeEventPayload(event)
    const createdAt = this.isoNow()
    const frame = { sequence, createdAt, payload }
    const frameBytes = Buffer.byteLength(JSON.stringify(frame), "utf8")
    if (
      capture.frames.length >= MAX_STREAM_DIAGNOSTIC_EVENTS_PER_TURN
      || capture.capturedBytes + frameBytes > MAX_STREAM_DIAGNOSTIC_BYTES_PER_TURN
    ) {
      capture.truncated = true
      this.streamDiagnostics.set(turnId, capture)
      return
    }

    capture.frames.push(frame)
    capture.capturedBytes += frameBytes
    this.streamDiagnostics.set(turnId, capture)
  }

  private async flushStreamDiagnostics(conversationId: string, turnId: string): Promise<void> {
    const capture = this.streamDiagnostics.get(turnId)
    if (!capture || capture.observedEventCount === 0 || !this.deps.agentEvents) return
    const payload: StreamDiagnosticChunkPayload = {
      type: "streamDiagnostics",
      schemaVersion: 1,
      source: "claude-agent-sdk-stream-event",
      frames: capture.frames,
      observedEventCount: capture.observedEventCount,
      capturedEventCount: capture.frames.length,
      capturedBytes: capture.capturedBytes,
      truncated: capture.truncated,
      limits: {
        maxEventsPerTurn: MAX_STREAM_DIAGNOSTIC_EVENTS_PER_TURN,
        maxBytesPerTurn: MAX_STREAM_DIAGNOSTIC_BYTES_PER_TURN,
      },
    }
    await this.deps.agentEvents.upsert({
      id: `${conversationId}:${turnId}:stream-diagnostics`,
      schemaVersion: 1,
      projectId: this.deps.projectId,
      conversationId,
      turnId,
      eventType: "streamDiagnostics",
      payload,
      createdAt: this.isoNow(),
    })
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
    recoverable = false,
  ): AgentRuntimeTurnResult {
    const safeError = sanitizeErrorText(error)
    const event: AgentEvent = {
      type: "error",
      message: safeError,
      ...(recoverable ? { recoverable: true } : {}),
    }
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
    const rendererId = message.originRendererId
    if (message.platform === "local-renderer" && rendererId !== undefined) {
      if (this.pausedRendererIds.has(rendererId)) {
        const conversations = this.pausedRendererConversations.get(rendererId) ?? new Set<string>()
        conversations.add(conversationId)
        this.pausedRendererConversations.set(rendererId, conversations)
        return
      }
      if (isAgentStreamDeltaEvent(event) && !this.isRendererDisplaying(rendererId, conversationId)) {
        return
      }
    }
    const target = replyTargetFromMessage(message, conversationId, event)
    const sequence = this.nextDeliverySequence()
    if (message.platform === "local-renderer" && isAgentStreamDeltaEvent(event)) {
      this.enqueueRendererStreamEvent(message, conversationId, event, sequence)
      return
    }
    if (message.platform === "local-renderer") {
      this.flushRendererStreamBatch(`${this.deps.projectId}:${conversationId}`)
    }
    const options = this.deliveryOptions(conversationId)
    const rendererEvent = projectAgentEventForRenderer(event)
    this.deps.eventBus?.emit({
      domain: "agent",
      type: event.type,
      payload: {
        event: rendererEvent,
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
        platform: message.platform,
        deliveryEpoch: this.deliveryEpoch,
        sequence,
      },
      scope: {
        sessionId: conversationId,
        ...(rendererId !== undefined ? { rendererIds: [rendererId] } : {}),
      },
      timestamp: this.isoNow(),
    }, options)
    if (shouldSuppressReply(message)) return
    if (isAgentStreamDeltaEvent(event)) return
    // Record outbox entry as pending before dispatch. After dispatch completes
    // (or fails), update the status to "sent" or "failed" so outbox accurately
    // reflects delivery outcome rather than pre-emptively marking as "sent".
    const outbox = this.deps.outbox
    const replyTargets = this.deps.replyTargets
    if (!outbox || !replyTargets?.canDispatchAgentEvent?.(target)) return
    void outbox.recordAgentEvent(target, event)
      .then((outboxId) => {
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

  private enqueueRendererStreamEvent(
    message: AgentMessage,
    conversationId: string,
    event: AgentEvent,
    sequence: number,
  ): void {
    const key = `${this.deps.projectId}:${conversationId}`
    const batch = this.rendererStreamBatches.get(key) ?? {
      message,
      conversationId,
      events: [],
      bytes: 0,
      resyncRequired: false,
    }
    const projected = projectAgentEventForRenderer(event)
    const timestamp = this.isoNow()
    const bytes = Buffer.byteLength(JSON.stringify(projected), "utf8")
    if (batch.bytes + bytes > MAX_RENDERER_PENDING_STREAM_BYTES) {
      batch.events.splice(0)
      batch.bytes = 0
      batch.resyncRequired = true
    } else if (!batch.resyncRequired) {
      const previous = batch.events[batch.events.length - 1]
      const merged = previous ? mergeAdjacentStreamEvents(previous.event, projected) : undefined
      if (previous && merged) {
        const mergedBytes = Buffer.byteLength(JSON.stringify(merged), "utf8")
        batch.bytes += mergedBytes - previous.bytes
        batch.events[batch.events.length - 1] = { event: merged, sequence, timestamp, bytes: mergedBytes }
      } else {
        batch.events.push({ event: projected, sequence, timestamp, bytes })
        batch.bytes += bytes
      }
    }
    if (!batch.timer) {
      batch.timer = setTimeout(() => this.flushRendererStreamBatch(key), RENDERER_STREAM_FLUSH_MS)
    }
    this.rendererStreamBatches.set(key, batch)
  }

  private flushRendererStreamBatch(key: string): void {
    if (this.rendererInFlightBatches.has(key)) return
    const pending = this.rendererStreamBatches.get(key)
    if (!pending) return
    if (pending.timer) clearTimeout(pending.timer)
    pending.timer = undefined
    const options = this.deliveryOptions(pending.conversationId)
    const events: typeof pending.events = []
    let bytes = 0
    while (pending.events.length > 0 && events.length < MAX_RENDERER_STREAM_BATCH_EVENTS) {
      const candidate = pending.events[0]
      if (!candidate) break
      if (events.length > 0 && bytes + candidate.bytes > MAX_RENDERER_STREAM_BATCH_BYTES) break
      pending.events.shift()
      pending.bytes -= candidate.bytes
      events.push(candidate)
      bytes += candidate.bytes
    }
    if (pending.events.length === 0) this.rendererStreamBatches.delete(key)
    else this.rendererStreamBatches.set(key, pending)
    const batchId = randomUUID()
    const rendererId = pending.message.originRendererId
    if (
      rendererId !== undefined
      && (this.pausedRendererIds.has(rendererId) || !this.isRendererDisplaying(rendererId, pending.conversationId))
    ) {
      return
    }
    if (!this.deps.eventBus) return
    if (rendererId !== undefined) this.rendererInFlightBatches.set(key, `${rendererId}:${batchId}`)
    this.deps.eventBus.emit({
      domain: "agent",
      type: "eventBatch",
      payload: {
        batchId,
        projectId: this.deps.projectId,
        sessionKey: pending.message.sessionKey,
        platform: pending.message.platform,
        conversationId: pending.conversationId,
        deliveryEpoch: this.deliveryEpoch,
        events: events.map(({ event, sequence, timestamp }) => ({ event, sequence, timestamp })),
        resyncRequired: pending.resyncRequired,
      },
      scope: {
        sessionId: pending.conversationId,
        ...(rendererId !== undefined ? { rendererIds: [rendererId] } : {}),
      },
      timestamp: this.isoNow(),
    }, options)
  }

  private emitConversationUpdated(conversation: ConversationEntryV1): void {
    const rendererIds = [...this.rendererSubscriptions.keys()]
    this.deps.eventBus?.emit({
      domain: "agent",
      type: "conversationUpdated",
      payload: {
        projectId: this.deps.projectId,
        sessionKey: conversation.sessionKey,
        platform: conversation.platform ?? "local",
        conversationId: conversation.id,
      },
      scope: {
        sessionId: conversation.id,
        ...(rendererIds.length > 0 ? { rendererIds } : {}),
      },
      timestamp: this.isoNow(),
    }, this.deliveryOptions(conversation.id))
  }

  private isRendererDisplaying(rendererId: number, conversationId: string): boolean {
    if (!this.rendererSubscriptions.has(rendererId)) return true
    const selectedConversationId = this.rendererSubscriptions.get(rendererId)
    return selectedConversationId === undefined || selectedConversationId === conversationId
  }

  private emitRendererResync(rendererId: number, conversation: ConversationEntryV1): void {
    if (!this.deps.eventBus) return
    const key = `${this.deps.projectId}:${conversation.id}`
    if (this.rendererInFlightBatches.has(key)) return
    const batchId = randomUUID()
    this.rendererInFlightBatches.set(key, `${rendererId}:${batchId}`)
    this.deps.eventBus.emit({
      domain: "agent",
      type: "eventBatch",
      payload: {
        batchId,
        projectId: this.deps.projectId,
        sessionKey: conversation.sessionKey,
        platform: conversation.platform ?? "local-renderer",
        conversationId: conversation.id,
        deliveryEpoch: this.deliveryEpoch,
        events: [],
        resyncRequired: true,
      },
      scope: { sessionId: conversation.id, rendererIds: [rendererId] },
      timestamp: this.isoNow(),
    }, this.deliveryOptions(conversation.id))
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
    }, this.deliveryOptions(conversationId))
  }

  private deliveryOptions(conversationId: string) {
    return agentConversationDeliveryOptions(this.deps.projectId, conversationId)
  }

  private nextDeliverySequence(): number {
    this.deliverySequence += 1
    return this.deliverySequence
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

function isUserMessageReplayEvent(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: "sdkEvent" }> {
  return event.type === "sdkEvent" && event.sdkType === "userMessageReplay"
}

function markMatchingSteerReplayed(
  state: RuntimeSessionState,
  event: Extract<AgentEvent, { type: "sdkEvent" }>,
): Promise<void> | undefined {
  const content = typeof event.payload.content === "string" ? event.payload.content : undefined
  const timestamp = typeof event.payload.timestamp === "string" ? event.payload.timestamp : undefined
  if (!content || !timestamp) return undefined
  for (const steer of state.activeSteers?.values() ?? []) {
    if (!steer.replayed && steer.content === content && steer.submittedAt === timestamp) {
      steer.replayed = true
      return steer.historyPersistence
    }
  }
  return undefined
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
    case "toolResult": {
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
          blockedPath: event.blockedPath,
          sessionDirectoryGrantAvailable: event.sessionDirectoryGrantAvailable,
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
          turnOutcome: event.turnOutcome,
          usage: event.usage,
          modelUsage: event.modelUsage,
          sdkResultUuid: event.sdkResultUuid,
          costUsd: event.costUsd,
          costCny: event.costCny,
          costCurrency: event.costCurrency,
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
    case "fileCheckpoint":
      return {
        role: "system",
        content: `${event.fileCount} files changed`,
        metadata: compactMetadata({
          agentEventType: event.type,
          sdkSessionId: event.sdkSessionId,
          checkpointId: event.checkpointId,
          status: event.status,
          insertions: event.insertions,
          deletions: event.deletions,
          files: event.files,
          fileCount: event.fileCount,
          coverageWarning: event.coverageWarning,
        }),
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
      if (event.sdkType === "synapseToolRouterFallback") {
        return {
          role: "system",
          content: "部分工具暂不可用，已使用可用工具继续。",
          metadata: compactMetadata({
            agentEventType: event.type,
            sdkSessionId: event.sdkSessionId,
            sdkType: event.sdkType,
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

function isTerminalAgentEvent(event: AgentEvent): boolean {
  return event.type === "result" || event.type === "error"
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
    queuedTurnCount: event.queuedTurnCount,
    userMessageUuid: event.userMessageUuid,
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

function latestContextUsedTokens(events: readonly AgentEvent[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event) continue
    const contextUsage = event.type === "result"
      ? event.metadata?.contextUsage
      : "contextUsage" in event
        ? event.contextUsage
        : undefined
    if (contextUsage && contextUsage.usedTokens > 0) return contextUsage.usedTokens
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

function sumHistoryMetadataNumber(
  history: readonly ConversationEntryV1["history"][number][],
  key: string,
): number {
  return history.reduce((total, entry) => {
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

const MAX_SANITIZED_EVENT_DEPTH = 64

function sanitizeValue(
  value: unknown,
  ancestors: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (typeof value === "string") return sanitizeErrorText(value)
  if (!value || typeof value !== "object") return value
  if (ancestors.has(value)) return "[Circular]"
  if (depth >= MAX_SANITIZED_EVENT_DEPTH) return "[truncated]"
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.slice(0, 20).map((entry) => sanitizeValue(entry, ancestors, depth + 1))
    }
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
      output[key] = sanitizeValue(entry, ancestors, depth + 1)
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

function stripTransientImageBlocks<T extends AgentEvent>(event: T): T {
  if (event.type !== "toolResult" || !event.imageBlocks) return event
  const { imageBlocks, ...rest } = event as AgentToolResultEvent
  void imageBlocks
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

function isRendererUnavailableResult(result: AgentRuntimeTurnResult): boolean {
  return result.events.some((event) => event.type === "error" && event.errorKind === "renderer_unavailable")
}

function appendStreamedText(current: string, event: AgentEvent): string {
  if (event.type === "text") return `${current}${event.content}`
  if (event.type === "stream" && event.text) return `${current}${event.text}`
  return current
}

function appendBoundedTurnEvent(events: AgentEvent[], event: AgentEvent): void {
  // Stream deltas are transport/display details. The accumulated text and
  // persisted timeline are authoritative, so retaining every delta in the
  // terminal result only creates a second unbounded copy of the turn.
  if (event.type === "stream") return
  if (
    event.type === "sdkEvent"
    && event.sdkType !== "userMessageReplay"
    && event.sdkType !== "nativeSlashPassthrough"
  ) return

  if (event.type === "assistant") {
    let previousAssistant = -1
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.type === "assistant") {
        previousAssistant = index
        break
      }
    }
    if (previousAssistant >= 0) events.splice(previousAssistant, 1)
  }
  if (events.length >= MAX_TURN_RESULT_EVENTS) {
    const replaceable = events.findIndex((candidate) => (
      candidate.type !== "result"
      && candidate.type !== "error"
      && candidate.type !== "permissionRequest"
      && candidate.type !== "toolResult"
    ))
    if (replaceable >= 0) events.splice(replaceable, 1)
    else if (event.type !== "result" && event.type !== "error") return
    else events.shift()
  }
  events.push(event)
}

function projectAgentEventForRenderer(event: AgentEvent): AgentEvent {
  const projected = { ...event } as Record<string, unknown>
  delete projected.payload
  delete projected.contentBlocks
  delete projected.imageBlocks
  delete projected.usage
  delete projected.modelUsage

  for (const key of ["content", "text", "thinking", "partialJson", "toolInput", "message"] as const) {
    const value = projected[key]
    if (typeof value === "string") projected[key] = truncateUtf8(value, MAX_RENDERER_EVENT_TEXT_BYTES)
  }
  if (event.type === "assistant") {
    const content = assistantEventText(event) ?? ""
    projected.content = truncateUtf8(content, MAX_RENDERER_EVENT_TEXT_BYTES)
    projected.message = { role: "assistant", content: [] }
  }
  if (event.type === "stream") {
    projected.event = { type: event.deltaType ?? "delta" }
  }
  if (event.type === "compactBoundary") projected.payload = {}
  if (event.type === "sessionInit") {
    projected.tools = event.tools?.slice(0, 128)
    projected.mcpServers = event.mcpServers?.slice(0, 64).map((server) => ({
      ...(typeof server.name === "string" ? { name: server.name } : {}),
      ...(typeof server.status === "string" ? { status: server.status } : {}),
    }))
  }
  if ("toolInputRaw" in projected) {
    const rawBytes = Buffer.byteLength(JSON.stringify(projected.toolInputRaw), "utf8")
    if (rawBytes > MAX_RENDERER_EVENT_TEXT_BYTES) delete projected.toolInputRaw
  }
  return projected as unknown as AgentEvent
}

function mergeAdjacentStreamEvents(previous: AgentEvent, next: AgentEvent): AgentEvent | undefined {
  if (previous.type !== "stream" || next.type !== "stream") return undefined
  if (previous.deltaType !== next.deltaType || previous.blockIndex !== next.blockIndex) return undefined
  const merged = {
    ...next,
    text: mergeBoundedDelta(previous.text, next.text),
    thinking: mergeBoundedDelta(previous.thinking, next.thinking),
    partialJson: mergeBoundedDelta(previous.partialJson, next.partialJson),
  }
  return merged
}

function mergeBoundedDelta(previous: string | undefined, next: string | undefined): string | undefined {
  if (previous === undefined && next === undefined) return undefined
  return truncateUtf8(`${previous ?? ""}${next ?? ""}`, MAX_RENDERER_EVENT_TEXT_BYTES)
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) low = middle
    else high = middle - 1
  }
  return value.slice(0, low)
}

function rendererUnavailableEvent(input: {
  readonly conversationId: string
  readonly providerId?: string
  readonly sdkSessionId?: string
  readonly timestamp: string
}): Extract<AgentEvent, { type: "error" }> {
  return {
    ...input,
    type: "error",
    message: AGENT_RENDERER_UNAVAILABLE_MESSAGE,
    errorKind: "renderer_unavailable",
    recoverable: true,
    turnOutcome: {
      status: "interrupted",
      reason: "renderer_unavailable",
      recoverable: true,
      message: AGENT_RENDERER_UNAVAILABLE_MESSAGE,
      diagnostics: [{ source: "agent-runtime", kind: "renderer_unavailable" }],
    },
  }
}
