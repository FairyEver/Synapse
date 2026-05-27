import fs from "node:fs"
import type { DatabaseSync } from "node:sqlite"
import type {
  CcConversationDetail,
  CcConversationListInput,
  CcConversationListItem,
  CcConversationListResult,
  CcConversationMatchSnippet,
} from "../../../src/types/usage-analysis-conversations"
import { parseCcConversationFile } from "./cc-conversation-parser"
import { createUsageRangeFilter } from "./range"

type ServiceOptions = {
  readonly db: DatabaseSync
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

function toNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function normalizeLimit(value: unknown): number {
  const limit = Math.trunc(Number(value))
  if (!Number.isFinite(limit)) return 50
  return Math.min(Math.max(limit, 1), 200)
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

export class CcConversationService {
  private readonly db: DatabaseSync

  constructor(options: ServiceOptions) {
    this.db = options.db
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

    return {
      items: rows.map((row) => this.toListItem(row)),
      total: toNumber(count?.total),
      partial: false,
    }
  }

  async getConversation(sessionId: string): Promise<CcConversationDetail> {
    const row = this.getSessionRow(sessionId)
    if (!row) throw new Error(`Claude Code session not found: ${sessionId}`)
    if (!fs.existsSync(row.file_path)) throw new Error(`Claude Code transcript file is missing: ${row.file_path}`)

    const parsed = await parseCcConversationFile(row.file_path)

    return {
      session: this.toListItem(row, parsed.events.length),
      events: parsed.events,
      parseErrors: parsed.parseErrors,
      hasMore: false,
    }
  }

  async searchConversationText(input: CcConversationListInput): Promise<CcConversationListResult> {
    const query = input.query?.trim()
    if (!query || !input.rawText) return this.listConversations(input)

    const candidates = this.listConversations({ ...input, query: undefined, rawText: false, limit: 100 }).items
    const matches: CcConversationListItem[] = []

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate.sourceFilePath)) continue

      const parsed = await parseCcConversationFile(candidate.sourceFilePath)
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

    return { items: matches, total: matches.length, partial: candidates.length >= 100 }
  }

  private getSessionRow(sessionId: string): SessionRow | undefined {
    return this.db.prepare("SELECT * FROM cc_sessions WHERE session_id = ?").get(sessionId) as SessionRow | undefined
  }

  private toListItem(row: SessionRow, eventCount = 0): CcConversationListItem {
    const aggregate = this.db.prepare(`
      SELECT
        session_id,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,
        SUM(total_cost) AS estimated_cost,
        MAX(timestamp_ms) AS last_timestamp_ms
      FROM cc_usage_events
      WHERE session_id = ?
      GROUP BY session_id
    `).get(row.session_id) as AggregateRow | undefined

    return {
      sessionId: row.session_id,
      title: titleFromSession(row),
      workspaceKey: row.workspace_key,
      workspaceLabel: row.workspace_label,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      modelSummary: row.model_summary,
      tokens: toNumber(aggregate?.tokens),
      estimatedCost: toNumber(aggregate?.estimated_cost),
      toolCalls: toNumber(row.tool_call_count),
      eventCount,
      attachmentCount: 0,
      lastUsedAt: aggregate?.last_timestamp_ms ? new Date(aggregate.last_timestamp_ms).toISOString() : row.ended_at,
      sourceFilePath: row.file_path,
    }
  }
}
