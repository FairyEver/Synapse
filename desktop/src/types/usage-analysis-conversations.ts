export type CcConversationRangePreset = "today" | "7d" | "30d" | "90d" | "all"

export type CcConversationFocus = {
  readonly eventId?: string
  readonly usageEventId?: string
  readonly toolEventId?: string
  readonly timestampMs?: number
}

export type CcConversationListInput = {
  readonly preset: CcConversationRangePreset
  readonly query?: string
  readonly rawText?: boolean
  readonly project?: string
  readonly model?: string
  readonly tool?: string
  readonly eventType?: string
  readonly limit?: number
  readonly offset?: number
  readonly cursor?: string
}

export type CcConversationMatchSnippet = {
  readonly eventId: string
  readonly eventType: string
  readonly timestamp?: string
  readonly text: string
}

export type CcConversationListItem = {
  readonly sessionId: string
  readonly title: string
  readonly workspaceKey: string
  readonly workspaceLabel: string
  readonly startedAt: string
  readonly endedAt: string
  readonly modelSummary: string
  readonly tokens: number
  readonly estimatedCost: number
  readonly toolCalls: number
  readonly eventCount: number
  readonly attachmentCount: number
  readonly lastUsedAt: string
  readonly sourceFilePath: string
  readonly matchSnippets?: readonly CcConversationMatchSnippet[]
}

export type CcConversationListResult = {
  readonly items: readonly CcConversationListItem[]
  readonly total: number
  readonly nextCursor?: string
  readonly partial: boolean
}

export type CcRecordListInput = CcConversationListInput

export type CcRecordListItem = CcConversationListItem & {
  readonly requestCount: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
}

export type CcRecordDetailRow = {
  readonly id: string
  readonly usageEventId?: string
  readonly timestamp: string
  readonly timestampMs?: number
  readonly sessionId: string
  readonly workspaceLabel: string
  readonly model: string
  readonly tokens: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly tokenBreakdown: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
    readonly reasoning: number
  }
  readonly toolCalls: number
  readonly durationMs?: number
}

export type CcRecordListResult = {
  readonly items: readonly CcRecordListItem[]
  readonly total: number
  readonly nextCursor?: string
  readonly partial: boolean
}

export type CcRecordDetailsInput = {
  readonly sessionId: string
  readonly limit?: number
  readonly offset?: number
}

export type CcRecordDetailsResult = {
  readonly sessionId: string
  readonly rows: readonly CcRecordDetailRow[]
  readonly total: number
}

export type CcRawConversationEvent = {
  readonly id: string
  readonly type: string
  readonly timestamp?: string
  readonly timestampMs?: number
  readonly lineNumber: number
  readonly byteOffset: number
  readonly uuid?: string
  readonly parentUuid?: string | null
  readonly role?: string
  readonly model?: string
  readonly contentBlocks: readonly Record<string, unknown>[]
  readonly usage?: Record<string, unknown>
  readonly toolName?: string
  readonly toolUseId?: string
  readonly raw: Record<string, unknown>
}

export type CcConversationParseError = {
  readonly id: string
  readonly lineNumber: number
  readonly byteOffset: number
  readonly message: string
  readonly rawLine: string
}

export type CcConversationDetail = {
  readonly session: CcConversationListItem
  readonly events: readonly CcRawConversationEvent[]
  readonly parseErrors: readonly CcConversationParseError[]
  readonly hasMore: boolean
  readonly nextCursor?: string
}

export type CcConversationChunkInput = {
  readonly sessionId: string
  readonly cursor?: string
  readonly limit?: number
}

export type CcConversationChunk = {
  readonly events: readonly CcRawConversationEvent[]
  readonly parseErrors: readonly CcConversationParseError[]
  readonly hasMore: boolean
  readonly nextCursor?: string
}

export type CcConversationWindowRequest = {
  readonly sessionId: string
  readonly title?: string
  readonly focus?: CcConversationFocus
}
