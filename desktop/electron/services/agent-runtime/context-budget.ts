export const DEFAULT_TOOL_OUTPUT_BATCH_MAX_BYTES = 150 * 1024

const DEFAULT_ESTIMATED_REQUEST_BYTES_PER_TOKEN = 4

export interface AgentContextBudgetLimits {
  readonly maxToolResultBytes: number
  readonly maxToolBatchBytes?: number
  readonly maxContextTokens?: number
  readonly maxRequestBodyBytes?: number
  readonly requestBodyBudgetBytes?: number
  readonly initialRequestBytes?: number
}

export interface AgentContextBudgetSnapshot {
  readonly observedContextTokens?: number
  readonly estimatedRequestTokens: number
  readonly estimatedRequestBytes: number
  readonly retainedRequestBytes: number
  readonly retainedToolOutputBytes: number
  readonly pendingModelVisibleBytes: number
  readonly batchToolOutputBytes: number
  readonly turnToolOutputBytes: number
  readonly maxContextTokens?: number
  readonly requestBodyBudgetBytes?: number
  readonly maxRequestBodyBytes?: number
}

export class AgentContextBudget {
  private readonly limits: Required<Pick<
    AgentContextBudgetLimits,
    "maxToolResultBytes" | "maxToolBatchBytes"
  >> & Omit<AgentContextBudgetLimits, "maxToolBatchBytes">

  private requestTokenLimit: number | undefined
  private observedContextTokens: number | undefined
  private readonly initialRequestBytes: number
  private retainedRequestBytes: number
  private retainedToolOutputBytes = 0
  private pendingModelVisibleBytes = 0
  private batchToolOutputBytes = 0
  private turnToolOutputBytes = 0

  constructor(limits: AgentContextBudgetLimits) {
    this.limits = {
      ...limits,
      maxToolBatchBytes: positiveInteger(limits.maxToolBatchBytes)
        ?? DEFAULT_TOOL_OUTPUT_BATCH_MAX_BYTES,
    }
    this.requestTokenLimit = positiveInteger(limits.maxContextTokens)
    this.initialRequestBytes = nonNegativeInteger(limits.initialRequestBytes) ?? 0
    this.retainedRequestBytes = this.initialRequestBytes
    this.pendingModelVisibleBytes = this.initialRequestBytes
  }

  updateRequestTokenLimit(threshold: number): void {
    const limit = positiveInteger(threshold)
    if (limit !== undefined) {
      // This is the actual input/window limit, not the SDK's compact trigger.
      this.requestTokenLimit = limit
    }
  }

  beginTurn(userMessageBytes: number): void {
    this.batchToolOutputBytes = 0
    this.turnToolOutputBytes = 0
    this.recordModelVisibleBytes(userMessageBytes)
  }

  recordModelVisibleBytes(bytes: number): void {
    const normalized = nonNegativeInteger(bytes)
    if (normalized === undefined) return
    this.retainedRequestBytes += normalized
    this.pendingModelVisibleBytes += normalized
  }

  observeContextTokens(tokens: number): void {
    const normalized = nonNegativeInteger(tokens)
    if (normalized === undefined) return
    this.observedContextTokens = normalized
    this.pendingModelVisibleBytes = 0
  }

  availableToolOutputBytes(): number {
    return Math.max(0, Math.min(
      this.limits.maxToolResultBytes,
      this.limits.maxToolBatchBytes - this.batchToolOutputBytes,
      this.remainingContextTokenBudget(),
      this.remainingRequestBodyBudget(),
    ))
  }

  availableModelVisibleBytes(): number {
    return Math.max(0, Math.min(
      this.remainingContextTokenBudget(),
      this.remainingRequestBodyBudget(),
    ))
  }

  recordToolOutput(bytes: number): void {
    const normalized = nonNegativeInteger(bytes)
    if (normalized === undefined) return
    this.batchToolOutputBytes += normalized
    this.turnToolOutputBytes += normalized
    this.retainedToolOutputBytes += normalized
    this.recordModelVisibleBytes(normalized)
  }

  finishToolBatch(): AgentContextBudgetSnapshot {
    const snapshot = this.snapshot()
    this.batchToolOutputBytes = 0
    return snapshot
  }

  completeCompaction(tokens: number, compactedConversationBytes = 0, retainedToolResultTokens?: number): AgentContextBudgetSnapshot {
    const normalizedTokens = nonNegativeInteger(tokens)
    if (normalizedTokens !== undefined) this.observedContextTokens = normalizedTokens
    const normalizedCompactedBytes = nonNegativeInteger(compactedConversationBytes) ?? 0
    // A successful compact may keep a substantial tool-result tail.
    if (retainedToolResultTokens !== undefined) {
      this.retainedToolOutputBytes = Math.max(0, retainedToolResultTokens * 4)
    }
    this.retainedRequestBytes = this.initialRequestBytes + normalizedCompactedBytes + this.retainedToolOutputBytes
    this.pendingModelVisibleBytes = 0
    this.batchToolOutputBytes = 0
    return this.snapshot()
  }

  snapshot(): AgentContextBudgetSnapshot {
    const observedTokens = this.observedContextTokens ?? 0
    const estimatedRequestTokens = observedTokens + this.pendingModelVisibleBytes
    const estimatedRequestBytes = Math.max(
      this.retainedRequestBytes,
      estimatedBytesForTokens(observedTokens) + this.pendingModelVisibleBytes,
    )
    return {
      ...(this.observedContextTokens === undefined
        ? {}
        : { observedContextTokens: this.observedContextTokens }),
      estimatedRequestTokens,
      estimatedRequestBytes,
      retainedRequestBytes: this.retainedRequestBytes,
      retainedToolOutputBytes: this.retainedToolOutputBytes,
      pendingModelVisibleBytes: this.pendingModelVisibleBytes,
      batchToolOutputBytes: this.batchToolOutputBytes,
      turnToolOutputBytes: this.turnToolOutputBytes,
      ...(this.requestTokenLimit === undefined
        ? {}
        : { maxContextTokens: this.requestTokenLimit }),
      ...(this.limits.requestBodyBudgetBytes === undefined
        ? {}
        : { requestBodyBudgetBytes: this.limits.requestBodyBudgetBytes }),
      ...(this.limits.maxRequestBodyBytes === undefined
        ? {}
        : { maxRequestBodyBytes: this.limits.maxRequestBodyBytes }),
    }
  }

  applyNativeToolResultEviction(previousTokens: number, currentTokens: number): number {
    const previous = positiveInteger(previousTokens)
    const current = nonNegativeInteger(currentTokens)
    if (previous === undefined || current === undefined || current >= previous) return 0
    const evictedBytes = current === 0
      ? this.retainedToolOutputBytes
      : Math.floor(this.retainedToolOutputBytes * ((previous - current) / previous))
    this.retainedToolOutputBytes = Math.max(0, this.retainedToolOutputBytes - evictedBytes)
    this.retainedRequestBytes = Math.max(this.initialRequestBytes, this.retainedRequestBytes - evictedBytes)
    return evictedBytes
  }

  private remainingContextTokenBudget(): number {
    const limit = this.requestTokenLimit
    if (limit === undefined) return Number.MAX_SAFE_INTEGER
    return Math.max(0, limit - (this.observedContextTokens ?? 0) - this.pendingModelVisibleBytes)
  }

  private remainingRequestBodyBudget(): number {
    const limit = positiveInteger(this.limits.requestBodyBudgetBytes)
      ?? positiveInteger(this.limits.maxRequestBodyBytes)
    if (limit === undefined) return Number.MAX_SAFE_INTEGER
    const estimate = this.snapshot().estimatedRequestBytes
    return Math.max(0, limit - estimate)
  }
}

function estimatedBytesForTokens(tokens: number): number {
  return tokens * DEFAULT_ESTIMATED_REQUEST_BYTES_PER_TOKEN
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value : undefined
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value : undefined
}
