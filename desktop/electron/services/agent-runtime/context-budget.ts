export const DEFAULT_TOOL_OUTPUT_BATCH_MAX_BYTES = 150 * 1024

const DEFAULT_ESTIMATED_REQUEST_BYTES_PER_TOKEN = 4

export interface AgentPayloadCost {
  readonly bytes: number
  /** null means native multimodal tokenization has not been observed yet. */
  readonly tokens: number | null
  readonly source: "text-upper-bound" | "native-non-text" | "sdk"
  readonly batch: number
}

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
  readonly pendingEstimatedTokens: number
  readonly unknownTokenCosts: number
  readonly costWatermark: number
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
  private retainedNonTextBytes = 0
  private pendingModelVisibleBytes = 0
  private pendingCosts: (AgentPayloadCost & { watermark: number })[] = []
  private watermark = 0
  private observedWatermark = 0
  private batchToolOutputBytes = 0
  private batchTextOutputBytes = 0
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
    if (this.initialRequestBytes > 0) this.pendingCosts.push({ bytes: this.initialRequestBytes,
      tokens: this.initialRequestBytes, source: "text-upper-bound", batch: 0, watermark: ++this.watermark })
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
    this.batchTextOutputBytes = 0
    this.turnToolOutputBytes = 0
    this.recordModelVisibleBytes(userMessageBytes)
  }

  recordModelVisibleBytes(bytes: number): void {
    const normalized = nonNegativeInteger(bytes)
    if (normalized === undefined) return
    this.retainedRequestBytes += normalized
    this.pendingModelVisibleBytes += normalized
    this.pendingCosts.push({ bytes: normalized, tokens: normalized, source: "text-upper-bound",
      batch: 0, watermark: ++this.watermark })
  }

  costWatermark(): number { return this.watermark }

  observeContextTokens(tokens: number, coveredWatermark = this.watermark): void {
    const normalized = nonNegativeInteger(tokens)
    if (normalized === undefined || coveredWatermark < this.observedWatermark) return
    this.observedWatermark = Math.min(coveredWatermark, this.watermark)
    this.observedContextTokens = normalized
    this.pendingCosts = this.pendingCosts.filter((cost) => cost.watermark > this.observedWatermark)
    this.pendingModelVisibleBytes = this.pendingCosts.reduce((sum, cost) => sum + cost.bytes, 0)
  }

  availableToolOutputBytes(): number {
    return Math.max(0, Math.min(
      this.limits.maxToolResultBytes,
      this.limits.maxToolBatchBytes - this.batchTextOutputBytes,
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

  /** Native SDK owns visual token accounting. Base64 is only a transport cost. */
  availableNonTextBytes(): number {
    return this.remainingRequestBodyBudget()
  }

  recordToolOutputCost(cost: AgentPayloadCost): void {
    const bytes = nonNegativeInteger(cost.bytes)
    if (bytes === undefined || (cost.tokens !== null && nonNegativeInteger(cost.tokens) === undefined)) return
    if (cost.source === "native-non-text") this.retainedNonTextBytes += bytes
    if (cost.source !== "native-non-text") this.batchTextOutputBytes += bytes
    this.batchToolOutputBytes += bytes
    this.turnToolOutputBytes += bytes
    this.retainedToolOutputBytes += bytes
    this.retainedRequestBytes += bytes
    this.pendingModelVisibleBytes += bytes
    this.pendingCosts.push({ ...cost, bytes, watermark: ++this.watermark })
  }

  recordToolOutput(bytes: number, batch = 1): void {
    this.recordToolOutputCost({ bytes, tokens: bytes, source: "text-upper-bound", batch })
  }

  finishToolBatch(): AgentContextBudgetSnapshot {
    const snapshot = this.snapshot()
    this.batchToolOutputBytes = 0
    this.batchTextOutputBytes = 0
    return snapshot
  }

  completeCompaction(tokens: number, compactedConversationBytes = 0, retainedToolResultTokens?: number, coveredWatermark = this.watermark): AgentContextBudgetSnapshot {
    if (coveredWatermark < this.observedWatermark) return this.snapshot()
    const pendingCosts = this.pendingCosts.filter((cost) => cost.watermark > coveredWatermark)
    const normalizedTokens = nonNegativeInteger(tokens)
    if (normalizedTokens !== undefined) this.observedContextTokens = normalizedTokens
    const normalizedCompactedBytes = nonNegativeInteger(compactedConversationBytes) ?? 0
    // A successful compact may keep a substantial tool-result tail.
    if (retainedToolResultTokens !== undefined) {
      this.retainedToolOutputBytes = Math.max(this.retainedNonTextBytes, retainedToolResultTokens * 4)
        + pendingCosts.filter((cost) => cost.batch > 0 && cost.source !== "native-non-text").reduce((sum, cost) => sum + cost.bytes, 0)
    }
    this.retainedRequestBytes = this.initialRequestBytes + normalizedCompactedBytes + this.retainedToolOutputBytes
      + pendingCosts.filter((cost) => cost.batch === 0).reduce((sum, cost) => sum + cost.bytes, 0)
    this.pendingCosts = pendingCosts
    this.pendingModelVisibleBytes = pendingCosts.reduce((sum, cost) => sum + cost.bytes, 0)
    this.observedWatermark = coveredWatermark
    this.batchToolOutputBytes = 0
    this.batchTextOutputBytes = 0
    return this.snapshot()
  }

  snapshot(): AgentContextBudgetSnapshot {
    const observedTokens = this.observedContextTokens ?? 0
    const pendingEstimatedTokens = this.pendingCosts.reduce((sum, cost) => sum + (cost.tokens ?? 0), 0)
    const estimatedRequestTokens = observedTokens + pendingEstimatedTokens
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
      pendingEstimatedTokens,
      unknownTokenCosts: this.pendingCosts.filter((cost) => cost.tokens === null).length,
      costWatermark: this.watermark,
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
    const evictableTextBytes = this.retainedToolOutputBytes - this.retainedNonTextBytes
    // Native token reductions cannot identify which Base64 payload was evicted.
    const evictedBytes = current === 0
      ? evictableTextBytes
      : Math.floor(evictableTextBytes * ((previous - current) / previous))
    this.retainedToolOutputBytes = Math.max(0, this.retainedToolOutputBytes - evictedBytes)
    this.retainedRequestBytes = Math.max(this.initialRequestBytes, this.retainedRequestBytes - evictedBytes)
    return evictedBytes
  }

  private remainingContextTokenBudget(): number {
    const limit = this.requestTokenLimit
    if (limit === undefined) return Number.MAX_SAFE_INTEGER
    return Math.max(0, limit - this.snapshot().estimatedRequestTokens)
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
