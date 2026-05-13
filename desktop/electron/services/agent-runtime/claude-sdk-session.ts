import type {
  Options,
  PermissionMode,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }

import { bridgeSdkMessage, type AgentEventEnvelope } from "./sdk-event-bridge"
import type {
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
} from "./types"

export interface QueryLike {
  next(): Promise<IteratorResult<SDKMessage, void>>
  interrupt(): Promise<void>
  close(): void | Promise<void>
  streamInput?(stream: AsyncIterable<SDKUserMessage>): Promise<void>
}

export type QueryFactory = (input: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Record<string, unknown>
}) => QueryLike

export interface ClaudeSDKSessionOptions {
  readonly projectId: string
  readonly conversationId: string
  readonly providerId: string
  readonly cwd: string
  readonly sdkSessionId?: string
  readonly env: Record<string, string>
  readonly mode?: string
  readonly model?: string
  readonly maxTurns?: number
  readonly abortSignal?: AbortSignal
  readonly queryFactory?: QueryFactory
  readonly now?: () => Date
}

interface PendingPermission {
  readonly resolve: (decision: PermissionResult) => void
  readonly cleanup: () => void
}

interface ForwardedAbortController {
  readonly controller: AbortController
  cleanup(): void
}

export class ClaudeSDKSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"

  private readonly projectId: string
  private readonly conversationId: string
  private readonly providerId: string
  private readonly now: () => Date
  private readonly inputQueue = new AsyncQueue<SDKUserMessage>()
  private readonly eventQueue = new AsyncQueue<AgentEvent>()
  private readonly permissions = new Map<string, PendingPermission>()
  private readonly query: QueryLike
  private readonly abortController: AbortController | undefined
  private readonly abortCleanup: (() => void) | undefined
  private readonly pumpPromise: Promise<void>
  private closed = false
  private finished = false
  private sdkSessionId: string | undefined
  private permissionSeq = 0

  constructor(options: ClaudeSDKSessionOptions) {
    this.projectId = options.projectId
    this.conversationId = options.conversationId
    this.providerId = options.providerId
    this.sdkSessionId = options.sdkSessionId
    this.now = options.now ?? (() => new Date())
    const forwardedAbort = createForwardedAbortController(options.abortSignal)
    this.abortController = forwardedAbort?.controller
    this.abortCleanup = forwardedAbort?.cleanup

    const queryFactory = options.queryFactory ?? defaultQueryFactory
    this.query = queryFactory({
      prompt: this.inputQueue,
      options: this.buildQueryOptions(options),
    })
    this.pumpPromise = this.pumpQueryEvents()
  }

  async send(message: AgentMessage): Promise<void> {
    if (this.closed) return
    this.inputQueue.push({
      type: "user",
      message: {
        role: "user",
        content: message.content,
      },
      parent_tool_use_id: null,
    })
  }

  async respondPermission(
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void> {
    const pending = this.permissions.get(requestId)
    if (!pending) return

    this.permissions.delete(requestId)
    pending.cleanup()
    pending.resolve(toPermissionResult(decision))
  }

  nextEvent(): Promise<AgentEvent | null> {
    return this.eventQueue.next()
  }

  currentSessionId(): string | undefined {
    return this.sdkSessionId
  }

  alive(): boolean {
    return !this.closed && (!this.finished || this.eventQueue.hasValues())
  }

  async cancelCurrentTurn(): Promise<boolean> {
    if (!this.alive()) return false
    this.denyPendingPermissions("Current turn was cancelled before permission was resolved.")
    await this.query.interrupt()
    return true
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.finished = true
    this.inputQueue.close()
    this.denyPendingPermissions("Session closed before permission was resolved.")
    this.abortController?.abort()
    this.abortCleanup?.()
    this.eventQueue.close()
    void Promise.resolve()
      .then(() => this.query.close())
      .catch(() => undefined)
  }

  private buildQueryOptions(options: ClaudeSDKSessionOptions): Record<string, unknown> {
    const queryOptions: Partial<Options> = {
      cwd: options.cwd,
      env: options.env,
      canUseTool: (toolName, input, context) => this.canUseTool(toolName, input, context),
    }

    if (options.model) queryOptions.model = options.model
    if (options.maxTurns !== undefined) queryOptions.maxTurns = options.maxTurns
    if (options.sdkSessionId) queryOptions.resume = options.sdkSessionId
    if (this.abortController) queryOptions.abortController = this.abortController

    const permissionMode = parsePermissionMode(options.mode)
    if (permissionMode) queryOptions.permissionMode = permissionMode

    return queryOptions as Record<string, unknown>
  }

  private async canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    context: { signal: AbortSignal },
  ): Promise<PermissionResult> {
    if (this.closed) return { behavior: "deny", message: "Session is closed." }
    if (context.signal.aborted) return permissionCancelledResult()

    const requestId = this.nextPermissionRequestId()
    const timestamp = this.now().toISOString()
    const event: AgentEvent = {
      type: "permissionRequest",
      requestId,
      toolName,
      toolInput: summarizeToolInput(toolName, input),
      toolInputRaw: input,
      conversationId: this.conversationId,
      providerId: this.providerId,
      projectId: this.projectId,
      sdkSessionId: this.sdkSessionId,
      timestamp,
    }

    this.eventQueue.push(event)

    return new Promise<PermissionResult>((resolve) => {
      const abort = (): void => {
        if (!this.permissions.delete(requestId)) return
        resolve({ behavior: "deny", message: "Permission request was cancelled." })
      }
      context.signal.addEventListener("abort", abort, { once: true })
      this.permissions.set(requestId, {
        resolve,
        cleanup: () => context.signal.removeEventListener("abort", abort),
      })
      if (context.signal.aborted) abort()
    })
  }

  private async pumpQueryEvents(): Promise<void> {
    try {
      while (!this.closed) {
        const result = await this.query.next()
        if (result.done) break
        for (const event of this.bridgeMessage(result.value)) {
          this.eventQueue.push(event)
        }
      }
    } catch (error) {
      if (!this.closed) this.eventQueue.push(this.errorEvent(error))
    } finally {
      this.finished = true
      this.inputQueue.close()
      this.denyPendingPermissions("SDK query finished before permission was resolved.")
      this.abortCleanup?.()
      this.eventQueue.close()
    }
  }

  private errorEvent(error: unknown): AgentEvent {
    return {
      type: "error",
      message: errorMessage(error),
      conversationId: this.conversationId,
      providerId: this.providerId,
      sdkSessionId: this.sdkSessionId,
      timestamp: this.now().toISOString(),
    }
  }

  private bridgeMessage(message: SDKMessage): readonly AgentEvent[] {
    const raw = message as unknown as Record<string, unknown>
    const messageSessionId = typeof raw.session_id === "string" ? raw.session_id : undefined
    if (messageSessionId) this.sdkSessionId = messageSessionId

    const envelope: AgentEventEnvelope & { readonly sdkSessionId?: string } = {
      conversationId: this.conversationId,
      providerId: this.providerId,
      sdkSessionId: this.sdkSessionId,
      timestamp: this.now().toISOString(),
    }
    const bridged = bridgeSdkMessage(message, envelope)
    return Array.isArray(bridged) ? bridged : [bridged as AgentEvent]
  }

  private nextPermissionRequestId(): string {
    this.permissionSeq += 1
    return `${this.conversationId}-permission-${this.permissionSeq}`
  }

  private denyPendingPermissions(message: string): void {
    const pendingPermissions = Array.from(this.permissions.values())
    this.permissions.clear()
    for (const pending of pendingPermissions) {
      pending.cleanup()
      pending.resolve({ behavior: "deny", message })
    }
  }
}

const permissionModes = new Set<PermissionMode>([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
])

function defaultQueryFactory(input: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Record<string, unknown>
}): QueryLike {
  return new LazyQuery(input)
}

class LazyQuery implements QueryLike {
  private readonly query: Promise<Query>

  constructor(input: {
    readonly prompt: AsyncIterable<SDKUserMessage>
    readonly options: Record<string, unknown>
  }) {
    this.query = import("@anthropic-ai/claude-agent-sdk")
      .then(({ query }) => query({
        prompt: input.prompt,
        options: input.options as Options,
      }))
  }

  async next(): Promise<IteratorResult<SDKMessage, void>> {
    return (await this.query).next()
  }

  async interrupt(): Promise<void> {
    await (await this.query).interrupt()
  }

  async close(): Promise<void> {
    await (await this.query).close()
  }

  async streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void> {
    await (await this.query).streamInput(stream)
  }
}

function parsePermissionMode(mode: string | undefined): PermissionMode | undefined {
  if (!mode) return undefined
  return permissionModes.has(mode as PermissionMode) ? mode as PermissionMode : undefined
}

function createForwardedAbortController(signal: AbortSignal | undefined): ForwardedAbortController | undefined {
  if (!signal) return undefined
  const controller = new AbortController()
  if (signal.aborted) {
    controller.abort(signal.reason)
    return { controller, cleanup: () => undefined }
  }
  const abort = (): void => {
    controller.abort(signal.reason)
  }
  signal.addEventListener("abort", abort, { once: true })
  return {
    controller,
    cleanup: () => signal.removeEventListener("abort", abort),
  }
}

function toPermissionResult(decision: AgentPermissionDecision): PermissionResult {
  if (decision.behavior === "allow") {
    return {
      behavior: "allow",
      updatedInput: decision.updatedInput,
    }
  }

  return {
    behavior: "deny",
    message: decision.message
      ?? "The user denied this tool use. Stop and wait for the user's instructions.",
  }
}

function permissionCancelledResult(): PermissionResult {
  return { behavior: "deny", message: "Permission request was cancelled." }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === "string" ? error : "SDK query failed"
}

function summarizeToolInput(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName === "Bash" && typeof input.command === "string") return input.command
  const summary = JSON.stringify(input)
  return summary === "{}" ? undefined : summary
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(value: IteratorResult<T, void>) => void> = []
  private closed = false

  push(value: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ done: false, value })
      return
    }
    this.values.push(value)
  }

  next(): Promise<T | null> {
    const value = this.values.shift()
    if (value) return Promise.resolve(value)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.waiters.push((result) => {
        resolve(result.done ? null : result.value)
      })
    })
  }

  hasValues(): boolean {
    return this.values.length > 0
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) {
      waiter({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T, void> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value) return Promise.resolve({ done: false, value })
        if (this.closed) return Promise.resolve({ done: true, value: undefined })
        return new Promise((resolve) => {
          this.waiters.push(resolve)
        })
      },
    }
  }
}
