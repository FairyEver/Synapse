import fs from "node:fs"
import type { DatabaseSync } from "node:sqlite"
import type {
  CcConversationChunk,
  CcConversationDetail,
  CcConversationListInput,
  CcConversationListItem,
  CcConversationListResult,
  CcConversationMatchSnippet,
  CcRecordDetailRow,
  CcRecordDetailsInput,
  CcRecordDetailsResult,
  CcRecordListItem,
  CcRecordListInput,
  CcRecordListResult,
} from "../../../src/types/usage-analysis-conversations"
import { errorLogMeta as baseErrorLogMeta } from "../../../src/lib/error-sanitize"
import { roundModelUsageCost } from "../model-price"
import { parseCcConversationFile, parseCcConversationFileChunk } from "./cc-conversation-parser"
import { createUsageRangeFilter } from "./range"

type ServiceOptions = {
  readonly db: DatabaseSync
  readonly logger?: CcConversationLogger
}

type CcConversationLogger = {
  info(message: string, details?: Record<string, unknown>): void
  warn(message: string, details?: Record<string, unknown>): void
  error(message: string, details?: Record<string, unknown>): void
}

type SessionRow = {
  readonly session_id: string
  readonly file_path: string
  readonly workspace_key: string
  readonly workspace_label: string
  readonly started_at: string
  readonly ended_at: string
  readonly model_summary: string
  readonly tool_call_count: number
}

type AggregateRow = {
  readonly session_id: string
  readonly tokens: number
  readonly estimated_cost: number
  readonly last_timestamp_ms: number
}

type RecordAggregateRow = AggregateRow & {
  readonly request_count: number
}

const MAX_QUERY_LIMIT = 5000
const DETAIL_CHUNK_FILE_SIZE_BYTES = 2 * 1024 * 1024
const DETAIL_CHUNK_LIMIT = 200
const noopCcConversationLogger: CcConversationLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function toNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function toCostNumber(value: unknown): number {
  return roundModelUsageCost(toNumber(value))
}

function normalizeLimit(value: unknown): number {
  const limit = Math.trunc(Number(value))
  if (!Number.isFinite(limit)) return 50
  return Math.min(Math.max(limit, 1), MAX_QUERY_LIMIT)
}

function normalizeOffset(value: unknown): number {
  const offset = Math.trunc(Number(value))
  return Number.isFinite(offset) && offset > 0 ? offset : 0
}

function titleFromSession(row: SessionRow): string {
  return row.workspace_label || row.workspace_key || row.session_id
}

function textFromRaw(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(textFromRaw).filter(Boolean).join("\n")
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(textFromRaw).filter(Boolean).join("\n")
  }
  return ""
}

function createSnippet(text: string, query: string): string {
  const index = text.indexOf(query)
  if (index < 0) return ""
  return text.slice(Math.max(0, index - 40), index + query.length + 80)
}

function snippetPriority(snippet: CcConversationMatchSnippet): number {
  if (snippet.eventType === "user") return 0
  if (snippet.eventType === "assistant") return 1
  return 2
}

function sqlBindList(values: readonly string[]): string {
  return values.map(() => "?").join(", ")
}

function errorLogMeta(error: unknown): Record<string, unknown> {
  return baseErrorLogMeta(error, { includeMessage: true })
}

function conversationFilterSummary(input: CcConversationListInput): Record<string, unknown> {
  return {
    hasQuery: Boolean(input.query?.trim()),
    rawText: input.rawText === true,
    hasProject: Boolean(input.project?.trim()),
    hasModel: Boolean(input.model?.trim()),
    hasTool: Boolean(input.tool?.trim()),
    hasEventType: Boolean(input.eventType?.trim()),
    preset: input.preset,
  }
}

export class CcConversationService {
  private readonly db: DatabaseSync
  private readonly logger: CcConversationLogger

  constructor(options: ServiceOptions) {
    this.db = options.db
    this.logger = options.logger ?? noopCcConversationLogger
  }

  listConversations(input: CcConversationListInput): CcConversationListResult {
    const limit = normalizeLimit(input.limit)
    const offset = normalizeOffset(input.offset)
    const params: (string | number)[] = []
    const where: string[] = []
    const range = createUsageRangeFilter(input)

    if (range.sinceTimestampMs !== undefined) {
      where.push("EXISTS (SELECT 1 FROM cc_usage_events u WHERE u.session_id = s.session_id AND u.timestamp_ms >= ?)")
      params.push(range.sinceTimestampMs)
    }
    if (range.untilTimestampMs !== undefined) {
      where.push("EXISTS (SELECT 1 FROM cc_usage_events u WHERE u.session_id = s.session_id AND u.timestamp_ms <= ?)")
      params.push(range.untilTimestampMs)
    }
    if (range.sinceDate) {
      where.push("EXISTS (SELECT 1 FROM cc_usage_events u WHERE u.session_id = s.session_id AND u.date >= ?)")
      params.push(range.sinceDate)
    }
    if (range.untilDate) {
      where.push("EXISTS (SELECT 1 FROM cc_usage_events u WHERE u.session_id = s.session_id AND u.date <= ?)")
      params.push(range.untilDate)
    }

    if (input.project?.trim()) {
      where.push("s.workspace_key = ?")
      params.push(input.project.trim())
    }
    if (input.model?.trim()) {
      where.push("s.model_summary LIKE ?")
      params.push(`%${input.model.trim()}%`)
    }
    if (input.query?.trim() && !input.rawText) {
      where.push("(s.session_id LIKE ? OR s.workspace_key LIKE ? OR s.workspace_label LIKE ? OR s.model_summary LIKE ?)")
      const query = `%${input.query.trim()}%`
      params.push(query, query, query, query)
    }
    if (input.tool?.trim()) {
      where.push("EXISTS (SELECT 1 FROM cc_tool_events t WHERE t.session_id = s.session_id AND t.tool_name = ?)")
      params.push(input.tool.trim())
    }

    try {
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
      const count = this.db.prepare(`
        SELECT COUNT(*) AS total
        FROM cc_sessions s
        ${whereSql}
      `).get(...params) as { total?: number } | undefined
      const rows = this.db.prepare(`
        SELECT s.*
        FROM cc_sessions s
        ${whereSql}
        ORDER BY COALESCE(NULLIF(s.ended_at, ''), s.started_at) DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as SessionRow[]
      const aggregates = this.queryRecordAggregates(rows.map((row) => row.session_id))
      const result = {
        items: rows.map((row) => this.toListItem(row, {
          aggregate: aggregates.get(row.session_id),
        })),
        total: toNumber(count?.total),
        partial: false,
      }
      this.logger.info("CC conversations listed.", {
        limit,
        offset,
        total: result.total,
        returnedCount: result.items.length,
        filters: conversationFilterSummary(input),
      })
      return result
    } catch (error) {
      this.logger.error("CC conversations list failed.", {
        limit,
        offset,
        filters: conversationFilterSummary(input),
        ...errorLogMeta(error),
      })
      throw error
    }
  }

  async getConversation(sessionId: string): Promise<CcConversationDetail> {
    const row = this.getSessionRow(sessionId)
    if (!row) {
      this.logger.error("CC conversation session row missing.", { sessionId })
      throw new Error(`Claude Code session not found: ${sessionId}`)
    }
    if (!fs.existsSync(row.file_path)) {
      this.logger.error("CC conversation source file missing.", {
        sessionId,
        filePath: row.file_path,
      })
      throw new Error(`Claude Code transcript file is missing: ${row.file_path}`)
    }

    let fileSizeBytes = 0
    try {
      fileSizeBytes = fs.statSync(row.file_path).size
      if (fileSizeBytes > DETAIL_CHUNK_FILE_SIZE_BYTES) {
        const chunk = await parseCcConversationFileChunk(row.file_path, { limit: DETAIL_CHUNK_LIMIT })
        this.logger.info("CC conversation loaded.", {
          sessionId,
          filePath: row.file_path,
          fileSizeBytes,
          eventCount: chunk.events.length,
          parseErrorCount: chunk.parseErrors.length,
          chunked: true,
          hasMore: chunk.hasMore,
        })
        return {
          session: this.toListItem(row, { eventCount: chunk.events.length }),
          events: chunk.events,
          parseErrors: chunk.parseErrors,
          hasMore: chunk.hasMore,
          ...(chunk.nextCursor ? { nextCursor: chunk.nextCursor } : {}),
        }
      }

      const parsed = await parseCcConversationFile(row.file_path)
      this.logger.info("CC conversation loaded.", {
        sessionId,
        filePath: row.file_path,
        fileSizeBytes,
        eventCount: parsed.events.length,
        parseErrorCount: parsed.parseErrors.length,
      })
      return {
        session: this.toListItem(row, { eventCount: parsed.events.length }),
        events: parsed.events,
        parseErrors: parsed.parseErrors,
        hasMore: false,
      }
    } catch (error) {
      this.logger.error("CC conversation load failed.", {
        sessionId,
        filePath: row.file_path,
        fileSizeBytes,
        ...errorLogMeta(error),
      })
      throw error
    }
  }

  async getConversationChunk(sessionId: string, cursor?: string, limit = DETAIL_CHUNK_LIMIT): Promise<CcConversationChunk> {
    const row = this.getSessionRow(sessionId)
    if (!row) {
      this.logger.error("CC conversation session row missing.", { sessionId })
      throw new Error(`Claude Code session not found: ${sessionId}`)
    }
    if (!fs.existsSync(row.file_path)) {
      this.logger.error("CC conversation source file missing.", {
        sessionId,
        filePath: row.file_path,
      })
      throw new Error(`Claude Code transcript file is missing: ${row.file_path}`)
    }

    let fileSizeBytes = 0
    try {
      fileSizeBytes = fs.statSync(row.file_path).size
      const chunk = await parseCcConversationFileChunk(row.file_path, { cursor, limit })
      this.logger.info("CC conversation chunk loaded.", {
        sessionId,
        filePath: row.file_path,
        fileSizeBytes,
        eventCount: chunk.events.length,
        parseErrorCount: chunk.parseErrors.length,
        hasMore: chunk.hasMore,
      })
      return chunk
    } catch (error) {
      this.logger.error("CC conversation chunk load failed.", {
        sessionId,
        filePath: row.file_path,
        fileSizeBytes,
        hasCursor: Boolean(cursor),
        ...errorLogMeta(error),
      })
      throw error
    }
  }

  async searchConversationText(input: CcConversationListInput): Promise<CcConversationListResult> {
    const query = input.query?.trim()
    if (!query || !input.rawText) return this.listConversations(input)

    const cursorOffset = input.cursor ? normalizeOffset(input.cursor) : normalizeOffset(input.offset)
    const candidateResult = this.listConversations({
      ...input,
      query: undefined,
      rawText: false,
      offset: cursorOffset,
      cursor: undefined,
    })
    const candidates = candidateResult.items
    const matches: CcConversationListItem[] = []
    let missingFileCount = 0
    let parseErrorCount = 0

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate.sourceFilePath)) {
        missingFileCount += 1
        this.logger.warn("CC conversation search skipped missing source file.", {
          sessionId: candidate.sessionId,
          filePath: candidate.sourceFilePath,
        })
        continue
      }

      let parsed: Awaited<ReturnType<typeof parseCcConversationFile>>
      try {
        parsed = await parseCcConversationFile(candidate.sourceFilePath)
        parseErrorCount += parsed.parseErrors.length
      } catch (error) {
        this.logger.error("CC conversation search parse failed.", {
          sessionId: candidate.sessionId,
          filePath: candidate.sourceFilePath,
          ...errorLogMeta(error),
        })
        throw error
      }
      const snippets: CcConversationMatchSnippet[] = []

      for (const event of parsed.events) {
        if (input.eventType?.trim() && event.type !== input.eventType.trim()) continue
        const text = textFromRaw(event.raw)
        const snippet = createSnippet(text, query)
        if (!snippet) continue
        snippets.push({
          eventId: event.id,
          eventType: event.type,
          ...(event.timestamp ? { timestamp: event.timestamp } : {}),
          text: snippet,
        })
      }

      if (snippets.length > 0) {
        matches.push({
          ...candidate,
          matchSnippets: snippets.sort((a, b) => snippetPriority(a) - snippetPriority(b)).slice(0, 3),
        })
      }
    }

    const nextOffset = cursorOffset + candidates.length
    const nextCursor = nextOffset < candidateResult.total ? String(nextOffset) : undefined
    const result = {
      items: matches,
      total: candidateResult.total,
      ...(nextCursor ? { nextCursor } : {}),
      partial: Boolean(nextCursor),
    }
    this.logger.info("CC conversation raw text search completed.", {
      candidateCount: candidates.length,
      candidateTotal: candidateResult.total,
      cursorOffset,
      matchedCount: matches.length,
      missingFileCount,
      parseErrorCount,
      partial: result.partial,
      queryLength: query.length,
    })
    return result
  }

  listRecords(input: CcRecordListInput): CcRecordListResult {
    const limit = normalizeLimit(input.limit)
    const offset = normalizeOffset(input.offset)
    try {
      const { whereSql, params } = this.createSessionListFilter(input)
      const count = this.db.prepare(`
        SELECT COUNT(*) AS total
        FROM cc_sessions s
        ${whereSql}
      `).get(...params) as { total?: number } | undefined
      const rows = this.db.prepare(`
        SELECT s.*
        FROM cc_sessions s
        ${whereSql}
        ORDER BY COALESCE(NULLIF(s.ended_at, ''), s.started_at) DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset) as SessionRow[]
      const aggregates = this.queryRecordAggregates(rows.map((row) => row.session_id))
      const result = {
        items: rows.map((row) => this.toRecordListItem(row, aggregates.get(row.session_id))),
        total: toNumber(count?.total),
        partial: false,
      }
      this.logger.info("CC records listed.", {
        limit,
        offset,
        total: result.total,
        returnedCount: result.items.length,
        filters: conversationFilterSummary(input),
      })
      return result
    } catch (error) {
      this.logger.error("CC records list failed.", {
        limit,
        offset,
        filters: conversationFilterSummary(input),
        ...errorLogMeta(error),
      })
      throw error
    }
  }

  async searchRecordsText(input: CcRecordListInput): Promise<CcRecordListResult> {
    const conversations = await this.searchConversationText(input)
    return {
      ...conversations,
      items: conversations.items.map((item) => ({
        ...item,
        requestCount: this.countUsageEvents(item.sessionId),
      })),
    }
  }

  listRecordDetails(input: CcRecordDetailsInput): CcRecordDetailsResult {
    const sessionId = input.sessionId.trim()
    if (!sessionId) return { sessionId, rows: [], total: 0 }

    const limit = normalizeLimit(input.limit)
    const offset = normalizeOffset(input.offset)
    try {
      const count = this.db.prepare(`
        SELECT COUNT(*) AS total
        FROM cc_usage_events
        WHERE session_id = ?
      `).get(sessionId) as { total?: number } | undefined
      const rows = this.db.prepare(`
        SELECT u.*, COALESCE(t.tool_calls, 0) AS tool_calls, COALESCE(t.duration_ms, 0) AS duration_ms
        FROM cc_usage_events u
        LEFT JOIN (
          SELECT session_id, timestamp_ms, COUNT(*) AS tool_calls, SUM(COALESCE(duration_ms, 0)) AS duration_ms
          FROM cc_tool_events
          WHERE session_id = ?
          GROUP BY session_id, timestamp_ms
        ) t ON t.session_id = u.session_id AND t.timestamp_ms = u.timestamp_ms
        WHERE u.session_id = ?
        ORDER BY u.timestamp_ms DESC
        LIMIT ? OFFSET ?
      `).all(sessionId, sessionId, limit, offset) as Record<string, unknown>[]
      const result = {
        sessionId,
        rows: rows.map(toRecordDetailRow),
        total: toNumber(count?.total),
      }
      this.logger.info("CC record details listed.", {
        sessionId,
        limit,
        offset,
        total: result.total,
        returnedCount: result.rows.length,
      })
      return result
    } catch (error) {
      this.logger.error("CC record details list failed.", {
        sessionId,
        limit,
        offset,
        ...errorLogMeta(error),
      })
      throw error
    }
  }

  private getSessionRow(sessionId: string): SessionRow | undefined {
    return this.db.prepare("SELECT * FROM cc_sessions WHERE session_id = ?").get(sessionId) as SessionRow | undefined
  }

  private countUsageEvents(sessionId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM cc_usage_events
      WHERE session_id = ?
    `).get(sessionId) as { total?: number } | undefined
    return toNumber(row?.total)
  }

  private createSessionListFilter(input: CcConversationListInput): { whereSql: string; params: (string | number)[] } {
    const params: (string | number)[] = []
    const where: string[] = []
    const range = createUsageRangeFilter(input)

    if (range.sinceTimestampMs !== undefined) {
      where.push("EXISTS (SELECT 1 FROM cc_usage_events u WHERE u.session_id = s.session_id AND u.timestamp_ms >= ?)")
      params.push(range.sinceTimestampMs)
    }
    if (range.untilTimestampMs !== undefined) {
      where.push("EXISTS (SELECT 1 FROM cc_usage_events u WHERE u.session_id = s.session_id AND u.timestamp_ms <= ?)")
      params.push(range.untilTimestampMs)
    }
    if (range.sinceDate) {
      where.push("EXISTS (SELECT 1 FROM cc_usage_events u WHERE u.session_id = s.session_id AND u.date >= ?)")
      params.push(range.sinceDate)
    }
    if (range.untilDate) {
      where.push("EXISTS (SELECT 1 FROM cc_usage_events u WHERE u.session_id = s.session_id AND u.date <= ?)")
      params.push(range.untilDate)
    }

    if (input.project?.trim()) {
      where.push("s.workspace_key = ?")
      params.push(input.project.trim())
    }
    if (input.model?.trim()) {
      where.push("s.model_summary LIKE ?")
      params.push(`%${input.model.trim()}%`)
    }
    if (input.query?.trim() && !input.rawText) {
      where.push("(s.session_id LIKE ? OR s.workspace_key LIKE ? OR s.workspace_label LIKE ? OR s.model_summary LIKE ?)")
      const query = `%${input.query.trim()}%`
      params.push(query, query, query, query)
    }
    if (input.tool?.trim()) {
      where.push("EXISTS (SELECT 1 FROM cc_tool_events t WHERE t.session_id = s.session_id AND t.tool_name = ?)")
      params.push(input.tool.trim())
    }

    return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params }
  }

  private queryRecordAggregates(sessionIds: readonly string[]): Map<string, RecordAggregateRow> {
    if (sessionIds.length === 0) return new Map()
    const rows = this.db.prepare(`
      SELECT
        session_id,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,
        SUM(total_cost) AS estimated_cost,
        MAX(timestamp_ms) AS last_timestamp_ms,
        COUNT(*) AS request_count
      FROM cc_usage_events
      WHERE session_id IN (${sqlBindList(sessionIds)})
      GROUP BY session_id
    `).all(...sessionIds) as RecordAggregateRow[]
    return new Map(rows.map((row) => [row.session_id, row]))
  }

  private toListItem(
    row: SessionRow,
    options: {
      readonly aggregate?: AggregateRow
      readonly eventCount?: number
    } = {},
  ): CcConversationListItem {
    const aggregate = options.aggregate
    return {
      sessionId: row.session_id,
      title: titleFromSession(row),
      workspaceKey: row.workspace_key,
      workspaceLabel: row.workspace_label,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      modelSummary: row.model_summary,
      tokens: toNumber(aggregate?.tokens),
      estimatedCost: toCostNumber(aggregate?.estimated_cost),
      toolCalls: toNumber(row.tool_call_count),
      eventCount: options.eventCount ?? 0,
      attachmentCount: 0,
      lastUsedAt: aggregate?.last_timestamp_ms ? new Date(aggregate.last_timestamp_ms).toISOString() : row.ended_at,
      sourceFilePath: row.file_path,
    }
  }

  private toRecordListItem(row: SessionRow, aggregate: RecordAggregateRow | undefined): CcRecordListItem {
    return {
      sessionId: row.session_id,
      title: titleFromSession(row),
      workspaceKey: row.workspace_key,
      workspaceLabel: row.workspace_label,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      modelSummary: row.model_summary,
      tokens: toNumber(aggregate?.tokens),
      estimatedCost: toCostNumber(aggregate?.estimated_cost),
      toolCalls: toNumber(row.tool_call_count),
      eventCount: 0,
      attachmentCount: 0,
      requestCount: toNumber(aggregate?.request_count),
      lastUsedAt: aggregate?.last_timestamp_ms ? new Date(aggregate.last_timestamp_ms).toISOString() : row.ended_at,
      sourceFilePath: row.file_path,
    }
  }
}

function isoFromTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

function usageTokenTotal(row: Record<string, unknown>): number {
  return toNumber(row.input_tokens)
    + toNumber(row.output_tokens)
    + toNumber(row.cache_read_tokens)
    + toNumber(row.cache_write_tokens)
    + toNumber(row.reasoning_tokens)
}

function toRecordDetailRow(row: Record<string, unknown>): CcRecordDetailRow {
  const durationMs = toNumber(row.duration_ms)
  return {
    id: String(row.id ?? ""),
    usageEventId: String(row.id ?? ""),
    timestamp: isoFromTimestamp(toNumber(row.timestamp_ms)),
    timestampMs: toNumber(row.timestamp_ms),
    sessionId: String(row.session_id ?? ""),
    workspaceLabel: String(row.workspace_label || row.workspace_key || "unknown"),
    model: String(row.model || "unknown"),
    tokens: usageTokenTotal(row),
    pricedTokens: toNumber(row.priced_tokens),
    unpricedTokens: toNumber(row.unpriced_tokens),
    estimatedCost: toCostNumber(row.total_cost),
    tokenBreakdown: {
      input: toNumber(row.input_tokens),
      output: toNumber(row.output_tokens),
      cacheRead: toNumber(row.cache_read_tokens),
      cacheWrite: toNumber(row.cache_write_tokens),
      reasoning: toNumber(row.reasoning_tokens),
    },
    toolCalls: toNumber(row.tool_calls),
    ...(durationMs > 0 ? { durationMs } : {}),
  }
}
