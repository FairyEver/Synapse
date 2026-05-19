import type { DatabaseSync } from "node:sqlite"
import {
  parseClaudeUsageFile,
  type ParsedToolEvent,
  type ParsedUsageEvent,
  type ParsedUsageFile,
  type ParsedUsageSession,
} from "./cc-parser"
import { createUsageRangeFilter, localHourKey } from "./range"
import { collectJsonlFiles, fingerprintFile } from "./scan"
import type {
  UsageDetailRow,
  UsageModelRow,
  UsageOverviewReport,
  UsageProjectRow,
  UsageRangeInput,
  UsageRefreshResult,
  UsageTimeBucket,
  UsageTokenBreakdown,
  UsageToolRow,
} from "./types"

interface UsageAnalysisServiceOptions {
  readonly db: DatabaseSync
  readonly roots: string[]
}

interface ScanFileRow {
  readonly size: number
  readonly mtime_ms: number
  readonly parse_status: string
}

interface UsageEventRow {
  readonly id: string
  readonly session_id: string
  readonly timestamp_ms: number
  readonly date: string
  readonly hour: string
  readonly workspace_key: string
  readonly workspace_label: string
  readonly model: string
  readonly provider: string
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_read_tokens: number
  readonly cache_write_tokens: number
  readonly reasoning_tokens: number
  readonly cost_input: number
  readonly cost_output: number
  readonly cost_cache_read: number
  readonly cost_cache_write: number
  readonly cost_reasoning: number
  readonly total_cost: number
}

interface SessionRow {
  readonly session_id: string
  readonly file_path: string
  readonly workspace_key: string
  readonly workspace_label: string
  readonly provider: string
  readonly source: string
  readonly cli_version: string
  readonly started_at: string
  readonly ended_at: string
  readonly model_summary: string
  readonly request_count: number
  readonly conversation_count: number
  readonly tool_call_count: number
}

interface ToolEventRow {
  readonly id: string
  readonly session_id: string
  readonly timestamp_ms: number
  readonly date: string
  readonly workspace_key: string
  readonly tool_name: string
  readonly category: string
  readonly status: string
  readonly exit_code: number | null
  readonly duration_ms: number | null
}

interface ParsedTaskLike {
  readonly id: string
  readonly sessionId: string
  readonly startedAt: string
  readonly completedAt: string
  readonly durationMs: number | null
  readonly timeToFirstTokenMs: number | null
}

interface ParsedFileWithTasks extends ParsedUsageFile {
  readonly taskEvents?: readonly ParsedTaskLike[]
}

interface AggregateValue {
  tokens: number
  estimatedCost: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  requests: number
}

function tokenTotal(row: UsageEventRow): number {
  return row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens + row.reasoning_tokens
}

function emptyTokenBreakdown(): UsageTokenBreakdown {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
}

function addUsageToAggregate(aggregate: AggregateValue, row: UsageEventRow): void {
  aggregate.input += row.input_tokens
  aggregate.output += row.output_tokens
  aggregate.cacheRead += row.cache_read_tokens
  aggregate.cacheWrite += row.cache_write_tokens
  aggregate.reasoning += row.reasoning_tokens
  aggregate.tokens += tokenTotal(row)
  aggregate.estimatedCost += row.total_cost
  aggregate.requests += 1
}

function createAggregate(): AggregateValue {
  return {
    tokens: 0,
    estimatedCost: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    requests: 0,
  }
}

function compareDesc(a: number, b: number): number {
  return b - a
}

function isoFromTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

export class CcUsageAnalysisService {
  protected readonly db: DatabaseSync
  protected readonly roots: string[]
  protected readonly prefix: "cc" | "cx" = "cc"

  constructor(options: UsageAnalysisServiceOptions) {
    this.db = options.db
    this.roots = options.roots
  }

  async refresh(): Promise<UsageRefreshResult> {
    return refreshUsageNamespace({
      db: this.db,
      prefix: this.prefix,
      roots: this.roots,
      parseFile: parseClaudeUsageFile,
    })
  }

  getOverview(range: UsageRangeInput): UsageOverviewReport {
    const usageRows = this.queryUsageRows(range)
    const toolRows = this.queryToolRows(range)
    const totals = this.createTotals(usageRows, toolRows)
    return {
      generatedAt: new Date().toISOString(),
      totals,
      tokenBreakdown: this.createTokenBreakdown(usageRows),
      costBreakdown: {
        input: usageRows.reduce((sum, row) => sum + row.cost_input, 0),
        output: usageRows.reduce((sum, row) => sum + row.cost_output, 0),
        cacheRead: usageRows.reduce((sum, row) => sum + row.cost_cache_read, 0),
        cacheWrite: usageRows.reduce((sum, row) => sum + row.cost_cache_write, 0),
        reasoning: usageRows.reduce((sum, row) => sum + row.cost_reasoning, 0),
      },
      topModels: this.getModels(range).slice(0, 5),
      topProjects: this.getProjects(range).slice(0, 5),
      topTools: this.getTools(range).slice(0, 5),
      trend: this.getTime(range).slice(-30),
    }
  }

  getTime(range: UsageRangeInput): UsageTimeBucket[] {
    const usageRows = this.queryUsageRows(range)
    const toolRows = this.queryToolRows(range)
    const useHour = range.preset === "7d"
    const byBucket = new Map<string, { aggregate: AggregateValue; models: Map<string, number>; sessions: Set<string> }>()
    for (const row of usageRows) {
      const bucket = useHour ? row.hour : row.date
      const current = byBucket.get(bucket) ?? { aggregate: createAggregate(), models: new Map<string, number>(), sessions: new Set<string>() }
      addUsageToAggregate(current.aggregate, row)
      current.models.set(row.model, (current.models.get(row.model) ?? 0) + tokenTotal(row))
      current.sessions.add(row.session_id)
      byBucket.set(bucket, current)
    }

    return [...byBucket.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, value]) => ({
      bucket,
      tokens: value.aggregate.tokens,
      estimatedCost: value.aggregate.estimatedCost,
      requests: value.aggregate.requests,
      conversations: value.sessions.size,
      toolCalls: toolRows.filter((row) => (useHour ? localHourKey(row.timestamp_ms) : row.date) === bucket).length,
      dominantModel: [...value.models.entries()].sort((a, b) => compareDesc(a[1], b[1]))[0]?.[0] ?? "",
    }))
  }

  getModels(range: UsageRangeInput): UsageModelRow[] {
    const byModel = new Map<string, AggregateValue & { provider: string }>()
    for (const row of this.queryUsageRows(range)) {
      const key = `${row.provider}\n${row.model}`
      const current = byModel.get(key) ?? { ...createAggregate(), provider: row.provider }
      addUsageToAggregate(current, row)
      byModel.set(key, current)
    }
    return [...byModel.entries()]
      .map(([key, value]) => {
        const model = key.split("\n")[1] ?? "unknown"
        return {
          model,
          provider: value.provider,
          tokens: value.tokens,
          estimatedCost: value.estimatedCost,
          input: value.input,
          output: value.output,
          cacheRead: value.cacheRead,
          cacheWrite: value.cacheWrite,
          reasoning: value.reasoning,
          requests: value.requests,
          averageTokensPerRequest: value.requests > 0 ? value.tokens / value.requests : 0,
        }
      })
      .sort((a, b) => compareDesc(a.tokens, b.tokens))
  }

  getProjects(range: UsageRangeInput): UsageProjectRow[] {
    const sessions = this.querySessionRows()
    const sessionIdsByWorkspace = new Map<string, Set<string>>()
    for (const session of sessions) {
      const ids = sessionIdsByWorkspace.get(session.workspace_key) ?? new Set<string>()
      ids.add(session.session_id)
      sessionIdsByWorkspace.set(session.workspace_key, ids)
    }

    const toolRows = this.queryToolRows(range)
    const byWorkspace = new Map<string, AggregateValue & { label: string; lastUsedAt: string; toolCalls: number }>()
    for (const row of this.queryUsageRows(range)) {
      const current = byWorkspace.get(row.workspace_key) ?? { ...createAggregate(), label: row.workspace_label, lastUsedAt: "", toolCalls: 0 }
      addUsageToAggregate(current, row)
      const rowTime = isoFromTimestamp(row.timestamp_ms)
      if (!current.lastUsedAt || rowTime > current.lastUsedAt) current.lastUsedAt = rowTime
      byWorkspace.set(row.workspace_key, current)
    }
    for (const row of toolRows) {
      const current = byWorkspace.get(row.workspace_key)
      if (current) current.toolCalls += 1
    }

    return [...byWorkspace.entries()].map(([workspaceKey, value]) => ({
      workspaceKey,
      workspaceLabel: value.label || workspaceKey || "unknown",
      sessions: sessionIdsByWorkspace.get(workspaceKey)?.size ?? 0,
      requests: value.requests,
      tokens: value.tokens,
      estimatedCost: value.estimatedCost,
      toolCalls: value.toolCalls,
      lastUsedAt: value.lastUsedAt,
    })).sort((a, b) => compareDesc(a.tokens, b.tokens))
  }

  getTools(range: UsageRangeInput): UsageToolRow[] {
    const byTool = new Map<string, { toolName: string; category: string; calls: number; failures: number; durationTotal: number; durationCount: number }>()
    for (const row of this.queryToolRows(range)) {
      const key = `${row.category}\n${row.tool_name}`
      const current = byTool.get(key) ?? { toolName: row.tool_name, category: row.category, calls: 0, failures: 0, durationTotal: 0, durationCount: 0 }
      current.calls += 1
      if (row.status === "failed" || (row.exit_code !== null && row.exit_code !== 0)) current.failures += 1
      if (typeof row.duration_ms === "number") {
        current.durationTotal += row.duration_ms
        current.durationCount += 1
      }
      byTool.set(key, current)
    }
    return [...byTool.values()].map((row) => ({
      toolName: row.toolName,
      category: row.category,
      calls: row.calls,
      failures: row.failures,
      failureRate: row.calls > 0 ? row.failures / row.calls : 0,
      averageDurationMs: row.durationCount > 0 ? row.durationTotal / row.durationCount : 0,
    })).sort((a, b) => compareDesc(a.calls, b.calls))
  }

  getDetails(range: UsageRangeInput): UsageDetailRow[] {
    const toolCallsBySession = new Map<string, number>()
    for (const row of this.queryToolRows(range)) {
      toolCallsBySession.set(row.session_id, (toolCallsBySession.get(row.session_id) ?? 0) + 1)
    }
    return this.queryUsageRows(range).sort((a, b) => b.timestamp_ms - a.timestamp_ms).map((row) => ({
      id: row.id,
      timestamp: isoFromTimestamp(row.timestamp_ms),
      sessionId: row.session_id,
      workspaceLabel: row.workspace_label || row.workspace_key || "unknown",
      model: row.model,
      tokens: tokenTotal(row),
      estimatedCost: row.total_cost,
      tokenBreakdown: {
        input: row.input_tokens,
        output: row.output_tokens,
        cacheRead: row.cache_read_tokens,
        cacheWrite: row.cache_write_tokens,
        reasoning: row.reasoning_tokens,
      },
      toolCalls: toolCallsBySession.get(row.session_id) ?? 0,
    }))
  }

  protected queryUsageRows(range: UsageRangeInput): UsageEventRow[] {
    const filter = createUsageRangeFilter(range)
    const params: string[] = []
    const where: string[] = []
    if (filter.sinceDate) {
      where.push("date >= ?")
      params.push(filter.sinceDate)
    }
    if (filter.untilDate) {
      where.push("date <= ?")
      params.push(filter.untilDate)
    }
    const query = `SELECT * FROM ${this.prefix}_usage_events${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY timestamp_ms ASC`
    return this.db.prepare(query).all(...params) as UsageEventRow[]
  }

  protected queryToolRows(range: UsageRangeInput): ToolEventRow[] {
    const filter = createUsageRangeFilter(range)
    const params: string[] = []
    const where: string[] = []
    if (filter.sinceDate) {
      where.push("date >= ?")
      params.push(filter.sinceDate)
    }
    if (filter.untilDate) {
      where.push("date <= ?")
      params.push(filter.untilDate)
    }
    const query = `SELECT * FROM ${this.prefix}_tool_events${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY timestamp_ms ASC`
    return this.db.prepare(query).all(...params) as ToolEventRow[]
  }

  protected querySessionRows(): SessionRow[] {
    return this.db.prepare(`SELECT * FROM ${this.prefix}_sessions`).all() as SessionRow[]
  }

  private createTotals(usageRows: UsageEventRow[], toolRows: ToolEventRow[]): UsageOverviewReport["totals"] {
    const sessions = new Set<string>()
    const days = new Set<string>()
    let tokens = 0
    let estimatedCost = 0
    for (const row of usageRows) {
      sessions.add(row.session_id)
      days.add(row.date)
      tokens += tokenTotal(row)
      estimatedCost += row.total_cost
    }
    return {
      tokens,
      estimatedCost,
      requests: usageRows.length,
      conversations: sessions.size,
      toolCalls: toolRows.length,
      activeDays: days.size,
    }
  }

  private createTokenBreakdown(usageRows: UsageEventRow[]): UsageTokenBreakdown {
    return usageRows.reduce((totals, row) => ({
      input: totals.input + row.input_tokens,
      output: totals.output + row.output_tokens,
      cacheRead: totals.cacheRead + row.cache_read_tokens,
      cacheWrite: totals.cacheWrite + row.cache_write_tokens,
      reasoning: totals.reasoning + row.reasoning_tokens,
    }), emptyTokenBreakdown())
  }
}

async function refreshUsageNamespace(options: {
  readonly db: DatabaseSync
  readonly prefix: "cc" | "cx"
  readonly roots: string[]
  readonly parseFile: (filePath: string) => Promise<ParsedFileWithTasks>
}): Promise<UsageRefreshResult> {
  const startedAt = Date.now()
  const files = collectJsonlFiles(options.roots)
  let parsedFiles = 0
  let skippedFiles = 0
  let failedFiles = 0
  let usageEvents = 0
  let toolEvents = 0

  for (const file of files) {
    const fp = fingerprintFile(file)
    const existing = options.db.prepare(`SELECT size, mtime_ms, parse_status FROM ${options.prefix}_scan_files WHERE file_path = ?`).get(file) as ScanFileRow | undefined
    if (existing?.size === fp.size && existing.mtime_ms === fp.mtimeMs && existing.parse_status === "parsed") {
      skippedFiles += 1
      continue
    }

    try {
      const parsed = await options.parseFile(file)
      persistParsedFile(options.db, options.prefix, file, fp.size, fp.mtimeMs, parsed)
      parsedFiles += 1
      usageEvents += parsed.usageEvents.length
      toolEvents += parsed.toolEvents.length
    } catch (error) {
      failedFiles += 1
      const errorKind = error instanceof Error ? error.name : "ParseError"
      options.db.prepare(`
        INSERT INTO ${options.prefix}_scan_files (file_path, size, mtime_ms, parse_status, error_kind, last_scanned_at)
        VALUES (?, ?, ?, 'failed', ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          size = excluded.size,
          mtime_ms = excluded.mtime_ms,
          parse_status = excluded.parse_status,
          error_kind = excluded.error_kind,
          last_scanned_at = excluded.last_scanned_at
      `).run(file, fp.size, fp.mtimeMs, errorKind, new Date().toISOString())
    }
  }

  rebuildAggregates(options.db, options.prefix)

  return {
    scannedFiles: files.length,
    parsedFiles,
    skippedFiles,
    failedFiles,
    usageEvents,
    toolEvents,
    elapsedMs: Date.now() - startedAt,
  }
}

function persistParsedFile(db: DatabaseSync, prefix: "cc" | "cx", filePath: string, size: number, mtimeMs: number, parsed: ParsedFileWithTasks): void {
  db.exec("BEGIN IMMEDIATE")
  try {
    const oldSessions = db.prepare(`SELECT session_id FROM ${prefix}_sessions WHERE file_path = ?`).all(filePath) as { session_id: string }[]
    const sessionIds = new Set([...oldSessions.map((row) => row.session_id), ...parsed.sessions.map((session) => session.sessionId)])
    for (const sessionId of sessionIds) {
      db.prepare(`DELETE FROM ${prefix}_usage_events WHERE session_id = ?`).run(sessionId)
      db.prepare(`DELETE FROM ${prefix}_tool_events WHERE session_id = ?`).run(sessionId)
      db.prepare(`DELETE FROM ${prefix}_sessions WHERE session_id = ?`).run(sessionId)
      if (prefix === "cx") db.prepare("DELETE FROM cx_task_events WHERE session_id = ?").run(sessionId)
    }

    const insertSession = db.prepare(`
      INSERT INTO ${prefix}_sessions (
        session_id, file_path, workspace_key, workspace_label, provider, source, cli_version,
        started_at, ended_at, model_summary, request_count, conversation_count, tool_call_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const session of parsed.sessions) {
      insertSession.run(
        session.sessionId,
        session.filePath,
        session.workspaceKey,
        session.workspaceLabel,
        session.provider,
        session.source,
        session.cliVersion,
        session.startedAt,
        session.endedAt,
        session.modelSummary,
        session.requestCount,
        session.conversationCount,
        session.toolCallCount,
      )
    }

    const insertUsage = db.prepare(`
      INSERT INTO ${prefix}_usage_events (
        id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
        cost_input, cost_output, cost_cache_read, cost_cache_write, cost_reasoning, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const event of parsed.usageEvents) {
      insertUsage.run(
        event.id,
        event.sessionId,
        event.timestampMs,
        event.date,
        event.hour,
        event.workspaceKey,
        event.workspaceLabel,
        event.model,
        event.provider,
        event.inputTokens,
        event.outputTokens,
        event.cacheReadTokens,
        event.cacheWriteTokens,
        event.reasoningTokens,
        event.costInput,
        event.costOutput,
        event.costCacheRead,
        event.costCacheWrite,
        event.costReasoning,
        event.totalCost,
      )
    }

    const insertTool = db.prepare(`
      INSERT INTO ${prefix}_tool_events (
        id, session_id, timestamp_ms, date, workspace_key, tool_name, category, status, exit_code, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const event of parsed.toolEvents) {
      insertTool.run(
        event.id,
        event.sessionId,
        event.timestampMs,
        event.date,
        event.workspaceKey,
        event.toolName,
        event.category,
        event.status,
        event.exitCode ?? null,
        event.durationMs,
      )
    }

    if (prefix === "cx" && parsed.taskEvents) {
      const insertTask = db.prepare(`
        INSERT INTO cx_task_events (id, session_id, started_at, completed_at, duration_ms, time_to_first_token_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const event of parsed.taskEvents) {
        insertTask.run(event.id, event.sessionId, event.startedAt, event.completedAt, event.durationMs, event.timeToFirstTokenMs)
      }
    }

    db.prepare(`
      INSERT INTO ${prefix}_scan_files (file_path, size, mtime_ms, parse_status, error_kind, last_scanned_at)
      VALUES (?, ?, ?, 'parsed', NULL, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        size = excluded.size,
        mtime_ms = excluded.mtime_ms,
        parse_status = excluded.parse_status,
        error_kind = excluded.error_kind,
        last_scanned_at = excluded.last_scanned_at
    `).run(filePath, size, mtimeMs, new Date().toISOString())
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

function rebuildAggregates(db: DatabaseSync, prefix: "cc" | "cx"): void {
  db.exec("BEGIN IMMEDIATE")
  try {
    db.exec(`DELETE FROM ${prefix}_daily_usage`)
    db.exec(`DELETE FROM ${prefix}_hourly_usage`)
    db.exec(`
      INSERT INTO ${prefix}_daily_usage (
        date, model, provider, workspace_key, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, total_cost, requests, conversations, tool_calls
      )
      SELECT
        date,
        model,
        provider,
        workspace_key,
        SUM(input_tokens),
        SUM(output_tokens),
        SUM(cache_read_tokens),
        SUM(cache_write_tokens),
        SUM(reasoning_tokens),
        SUM(total_cost),
        COUNT(*),
        COUNT(DISTINCT session_id),
        0
      FROM ${prefix}_usage_events
      GROUP BY date, model, provider, workspace_key
    `)
    db.exec(`
      INSERT INTO ${prefix}_hourly_usage (
        hour, model, provider, workspace_key, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, total_cost, requests, conversations, tool_calls
      )
      SELECT
        hour,
        model,
        provider,
        workspace_key,
        SUM(input_tokens),
        SUM(output_tokens),
        SUM(cache_read_tokens),
        SUM(cache_write_tokens),
        SUM(reasoning_tokens),
        SUM(total_cost),
        COUNT(*),
        COUNT(DISTINCT session_id),
        0
      FROM ${prefix}_usage_events
      GROUP BY hour, model, provider, workspace_key
    `)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export { refreshUsageNamespace }
