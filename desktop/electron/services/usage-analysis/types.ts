export type UsageTool = "cc" | "codex"
export type UsageRangePreset = "today" | "7d" | "30d" | "90d" | "all"
export type UsageTimeBucketGranularity = "day" | "hour"

export interface UsageRangeInput {
  readonly preset: UsageRangePreset
  readonly bucket?: UsageTimeBucketGranularity
}

export interface UsageDetailInput extends UsageRangeInput {
  readonly limit?: number
  readonly offset?: number
}

export interface UsageRangeFilter {
  readonly sinceDate?: string
  readonly untilDate?: string
  readonly sinceHour?: string
  readonly untilHour?: string
  readonly sinceTimestampMs?: number
  readonly untilTimestampMs?: number
}

export interface UsageTokenBreakdown {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export interface UsageCostBreakdown {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export interface UsageRefreshResult {
  readonly scannedFiles: number
  readonly parsedFiles: number
  readonly skippedFiles: number
  readonly failedFiles: number
  readonly usageEvents: number
  readonly toolEvents: number
  readonly elapsedMs: number
}

export interface UsageMetric {
  readonly label: string
  readonly value: string
  readonly subValue?: string
}

export interface UsageOverviewReport {
  readonly generatedAt: string
  readonly totals: {
    readonly tokens: number
    readonly pricedTokens: number
    readonly unpricedTokens: number
    readonly estimatedCost: number
    readonly requests: number
    readonly conversations: number
    readonly toolCalls: number
    readonly activeDays: number
  }
  readonly tokenBreakdown: UsageTokenBreakdown
  readonly costBreakdown: UsageCostBreakdown
  readonly topModels: UsageModelRow[]
  readonly topProjects: UsageProjectRow[]
  readonly topTools: UsageToolRow[]
  readonly trend: UsageTimeBucket[]
}

export interface UsageTimeBucket {
  readonly bucket: string
  readonly tokens: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly requests: number
  readonly conversations: number
  readonly toolCalls: number
  readonly dominantModel: string
  readonly modelBreakdown: UsageTimeModelBucket[]
}

export interface UsageTimeModelBucket extends UsageTokenBreakdown {
  readonly model: string
  readonly tokens: number
}

export interface UsageModelRow {
  readonly model: string
  readonly provider?: string
  readonly tokens: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly requests: number
  readonly averageTokensPerRequest: number
}

export interface UsageProjectRow {
  readonly workspaceKey: string
  readonly workspaceLabel: string
  readonly sessions: number
  readonly requests: number
  readonly tokens: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly toolCalls: number
  readonly lastUsedAt: string
}

export interface UsageToolRow {
  readonly toolName: string
  readonly category: string
  readonly calls: number
  readonly failures: number
  readonly failureRate: number
  readonly averageDurationMs: number
}

export interface UsageDetailRow {
  readonly id: string
  readonly timestamp: string
  readonly sessionId: string
  readonly workspaceLabel: string
  readonly model: string
  readonly tokens: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly tokenBreakdown: UsageTokenBreakdown
  readonly toolCalls: number
  readonly durationMs?: number
}
