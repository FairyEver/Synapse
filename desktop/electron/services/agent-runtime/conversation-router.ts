import { randomUUID } from "node:crypto"

import type {
  AgentEventEntryV1,
  ConversationEntryV1,
  DataNamespace,
} from "../../runtime/data-repo"
import type { ScopedEventBus } from "../../runtime/project-container"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { ReplyOutboxService, ReplyTarget } from "../reply-target"
import type { AgentCommandRouter, AgentCommandRouterResult } from "./command-router"
import type { AgentGovernanceService } from "./governance"
import type { AgentSessionRepository } from "./session-repository"
import type { SessionManager } from "./session-manager"
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
    dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): void
  }
  readonly agentEvents?: DataNamespace<AgentEventEntryV1>
  readonly now?: () => Date
}

const DEFAULT_PENDING_QUEUE_LIMIT = 5
const MAX_EVENT_PAYLOAD_BYTES = 8192
const MAX_SUMMARY_LENGTH = 1000

export class ConversationRouter {
  private readonly deps: ConversationRouterDeps
  private readonly repository: AgentSessionRepository
  private readonly sessionManager: SessionManager
  private readonly commandRouter: AgentCommandRouter | undefined
  private readonly pendingPermissions: Map<string, PendingPermissionState>

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
  }

  async send(
    message: AgentMessage,
    options: { readonly abortSignal?: AbortSignal } = {},
  ): Promise<AgentRuntimeTurnResult> {
    this.assertProject(message)
    const conversation = await this.getOrCreateConversation(message)
    return this.enqueueTurn(message, conversation, options.abortSignal)
  }

  async sendToConversation(
    message: AgentMessage,
    conversationId: string,
    options: { readonly abortSignal?: AbortSignal } = {},
  ): Promise<AgentRuntimeTurnResult> {
    this.assertProject(message)
    const conversation = await this.repository.get(conversationId)
    if (!conversation) {
      throw new Error(`Conversation "${conversationId}" not found`)
    }
    return this.enqueueTurn(message, conversation, options.abortSignal)
  }

  async sendNewSession(
    message: AgentMessage,
    name: string,
    options: { readonly abortSignal?: AbortSignal } = {},
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
      name,
      userMeta: userMetaFromMessage(message),
      resumePolicy: "fresh",
    })
    return this.enqueueTurn({ ...message, providerId }, conversation, options.abortSignal)
  }

  async sendSideSessionWithTimeout(
    message: AgentMessage,
    name: string,
    timeoutMs: number,
  ): Promise<AgentRuntimeRelayResult> {
    this.assertProject(message)
    const ac = new AbortController()
    const providerId = await this.resolveNewConversationProviderId(message)
    const conversation = await this.repository.createSideSession({
      sessionKey: message.sessionKey,
      platform: message.platform,
      channelKey: message.channelKey,
      workspaceKey: message.workspaceKey,
      workspacePath: message.workspacePath,
      providerId,
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
    abortSignal?: AbortSignal,
  ): Promise<AgentRuntimeTurnResult> {
    this.deps.replyTargets?.rememberReplyTarget(replyTargetFromMessage(message, conversation.id))
    const governance = this.deps.governance?.evaluateMessage(message)
    if (governance && !governance.allowed) {
      return this.finishWithError(message, conversation.id, governance.reason ?? "Message blocked")
    }

    const commandResult = await this.commandRouter?.handle(message, conversation)
    if (commandResult && isPromptCommandRoute(commandResult)) {
      message = { ...message, content: commandResult.content }
    } else if (commandResult) {
      for (const event of commandResult.events) {
        this.emitEvent(message, commandResult.conversationId, event)
      }
      return commandResult
    }

    const state = this.sessionManager.stateForConversation(conversation.id, message)
    if (state.busy && state.queue.length >= this.queueLimit()) {
      return this.finishWithError(message, conversation.id, "Session queue is full")
    }

    return new Promise<AgentRuntimeTurnResult>((resolve) => {
      state.queue.push({
        message,
        conversationId: conversation.id,
        abortSignal,
        resolve,
      })
      if (!state.busy) {
        void this.processQueue(state)
      }
    })
  }

  private async processQueue(state: RuntimeSessionState): Promise<void> {
    state.busy = true
    try {
      while (state.queue.length > 0) {
        const turn = state.queue.shift()
        if (!turn) continue
        const ac = new AbortController()
        const externalSignal = turn.abortSignal
        const abort = () => {
          ac.abort(externalSignal?.reason)
          void this.sessionManager.forceClose(turn.conversationId)
        }
        externalSignal?.addEventListener("abort", abort, { once: true })
        state.turnAbortController = ac
        try {
          if (externalSignal?.aborted) ac.abort(externalSignal.reason)
          if (state.closing || ac.signal.aborted) {
            turn.resolve(this.buildCancelledResult(turn.message, turn.conversationId))
            continue
          }
          const result = await this.processTurn(state, turn.message, turn.conversationId, ac.signal)
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
              error: messageText,
              projectId: this.deps.projectId,
              sessionKey: turn.message.sessionKey,
            })
            turn.resolve(this.finishWithError(turn.message, turn.conversationId, messageText))
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
    conversationId: string,
    abortSignal?: AbortSignal,
  ): Promise<AgentRuntimeTurnResult> {
    state.activeTurns += 1
    state.lastActivity = Date.now()
    const turnId = randomUUID()
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

      const liveSession = await this.sessionManager.getOrCreateSession({
        state,
        conversation,
        message,
        abortSignal,
      })
      const result = await this.processLiveTurn(state, message, conversation, liveSession, turnId, abortSignal)

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
    } finally {
      state.activeTurns = Math.max(0, state.activeTurns - 1)
      state.lastActivity = Date.now()
    }
  }

  private async processLiveTurn(
    state: RuntimeSessionState,
    message: AgentMessage,
    conversation: ConversationEntryV1,
    liveSession: AgentLiveSession,
    turnId: string,
    abortSignal?: AbortSignal,
  ): Promise<AgentRuntimeTurnResult> {
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
      await this.persistAgentEvent(conversation.id, turnId, events.length, event)
      await this.saveEventSdkSession(conversation.id, event, liveSession)
      await this.saveEventHistory(conversation.id, event)

      if (event.type === "permissionRequest") {
        await this.awaitPendingPermission(state, message, conversation.id, event, liveSession, abortSignal)
        continue
      }
      if (event.type === "result") {
        resultText = event.content
        await this.repository.saveUsage({
          conversationId: conversation.id,
          usage: event.usage as ConversationEntryV1["usage"] | undefined,
          costUsd: event.costUsd,
        })
        break
      }
      if (event.type === "error") {
        error = event.message
        break
      }
    }

    const sdkSessionId = liveSession.currentSessionId()
    const saved = await this.saveExecutionResult(conversation, resultText, sdkSessionId)

    return {
      conversationId: saved.id,
      events,
      resultText,
      agentSessionId: saved.sdkSessionId,
      threadId: saved.sdkSessionId,
      error,
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
    let error: string | undefined
    try {
      const savedConversation = await this.repository.appendHistory(conversation.id, "user", message.content)
      const liveSession = await this.sessionManager.getOrCreateSession({
        state,
        conversation: savedConversation,
        message,
        abortSignal,
      })
      await liveSession.send(message)
      while (liveSession.alive()) {
        const event = await nextLiveEventWithTimeout(liveSession, timeoutMs)
        if (!event) {
          await this.sessionManager.forceClose(conversation.id)
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
        await this.persistAgentEvent(conversation.id, turnId, events.length, event)
        await this.saveEventSdkSession(conversation.id, event, liveSession)
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
      const saved = await this.saveExecutionResult(conversation, resultText, liveSession.currentSessionId())
      return {
        conversationId: saved.id,
        events,
        resultText,
        partialText,
        agentSessionId: saved.sdkSessionId,
        threadId: saved.sdkSessionId,
        error,
        timedOut: false,
      }
    } catch (rawError) {
      const messageText = rawError instanceof Error ? rawError.message : String(rawError)
      return {
        ...this.finishWithError(message, conversation.id, messageText),
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
    await new Promise<void>((resolve) => {
      let settled = false
      let pending: PendingPermissionState
      const abort = (): void => {
        this.sessionManager.settlePendingPermission(pending)
      }
      const settle = (): void => {
        if (settled) return
        settled = true
        abortSignal?.removeEventListener("abort", abort)
        resolve()
      }
      pending = {
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
      if (abortSignal?.aborted) abort()
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
  ): Promise<ConversationEntryV1> {
    let saved = conversation
    if (sdkSessionId) {
      saved = await this.repository.saveSdkSession({
        conversationId: conversation.id,
        sdkSessionId,
      })
    }
    if (resultText) {
      saved = await this.repository.appendHistory(saved.id, "assistant", resultText)
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
  }

  private finishWithError(
    message: AgentMessage,
    conversationId: string,
    error: string,
  ): AgentRuntimeTurnResult {
    const event: AgentEvent = { type: "error", message: error }
    this.emitEvent(message, conversationId, event)
    return {
      conversationId,
      events: [event],
      resultText: "",
      error,
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
    })
    if (shouldSuppressReply(message)) return
    this.deps.outbox?.recordAgentEvent(target, event)
    this.deps.replyTargets?.dispatchAgentEvent(target, event)
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
        content: event.content?.trim() || event.toolName,
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
  if (typeof value === "string") return truncateString(value, MAX_SUMMARY_LENGTH)
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue)
  if (!isRecord(value)) return value
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const lower = key.toLowerCase()
    if (lower.includes("raw")) continue
    if (lower.includes("secret") || lower.includes("token") || lower.includes("password") || lower.includes("apikey")) {
      output[key] = "[redacted]"
      continue
    }
    output[key] = sanitizeValue(entry)
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function truncateString(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
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

function appendRelayText(current: string, event: AgentEvent): string {
  if (event.type === "text" || event.type === "result") {
    return `${current}${event.content}`
  }
  if (event.type === "error" && !current) return event.message
  return current
}
