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

export type CcConversationWindowRequest = {
  readonly sessionId: string
  readonly title?: string
  readonly focus?: CcConversationFocus
}
