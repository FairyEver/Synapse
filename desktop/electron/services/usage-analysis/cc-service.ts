import type { DatabaseSync } from "node:sqlite"
import {
  parseClaudeUsageFile,
  type ParsedUsageFile,
} from "./cc-parser"
import { SYNAPSE_COST_CURRENCY, USD_TO_CNY_RATE } from "../../../action-packages/shared/cost-currency"
import { listUsagePriceRules, saveUsagePriceRules, type UsageModelPriceRule, type UsageModelPriceRuleInput } from "./pricing"
import { createUsageRangeFilter } from "./range"
import { collectJsonlFiles, fingerprintFile } from "./scan"
import type {
  UsageDetailRow,
  UsageDetailInput,
  UsageModelRow,
  UsageOverviewReport,
  UsageProjectRow,
  UsageRangeInput,
  UsageRefreshResult,
  UsageTimeBucket,
  UsageToolRow,
} from "./types"

interface UsageAnalysisServiceOptions {
  readonly db: DatabaseSync
  readonly roots: string[]
}

interface ScanFileRow {
  readonly size: number
  readonly mtime_ms: number
  readonly line_count: number
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
  readonly price_known: number
  readonly cost_currency: string
  readonly pricing_rate: number
  readonly priced_at: string
  readonly pricing_version: string
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
  pricedTokens: number
  unpricedTokens: number
  estimatedCost: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  requests: number
}

const TOOL_CALLS_AGGREGATE_MODEL = "__synapse_tool_calls__"
const DATABASE_LOCK_RETRY_DELAY_MS = 250
const DATABASE_LOCK_RETRY_MAX_ELAPSED_MS = 60_000

function tokenTotal(row: UsageEventRow): number {
  return row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens + row.reasoning_tokens
}

function compareDesc(a: number, b: number): number {
  return b - a
}

function isoFromTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

function toNumber(value: unknown): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
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
    this.ensureAggregatesReady()
    const totalsRow = this.queryUsageTotals(range)
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        tokens: totalsRow.tokens,
        pricedTokens: totalsRow.pricedTokens,
        unpricedTokens: totalsRow.unpricedTokens,
        estimatedCost: totalsRow.estimatedCost,
        requests: totalsRow.requests,
        conversations: totalsRow.conversations,
        toolCalls: this.queryToolCallTotal(range),
        activeDays: totalsRow.activeDays,
      },
      tokenBreakdown: {
        input: totalsRow.input,
        output: totalsRow.output,
        cacheRead: totalsRow.cacheRead,
        cacheWrite: totalsRow.cacheWrite,
        reasoning: totalsRow.reasoning,
      },
      costBreakdown: {
        input: totalsRow.costInput,
        output: totalsRow.costOutput,
        cacheRead: totalsRow.costCacheRead,
        cacheWrite: totalsRow.costCacheWrite,
        reasoning: totalsRow.costReasoning,
      },
      topModels: this.getModels(range).slice(0, 5),
      topProjects: this.getProjects(range).slice(0, 5),
      topTools: this.queryTools(range, 5),
      trend: this.getTime(range),
    }
  }

  getPricingRules(): UsageModelPriceRule[] {
    return listUsagePriceRules(this.db)
  }

  savePricingRules(rules: readonly UsageModelPriceRuleInput[]): UsageModelPriceRule[] {
    return saveUsagePriceRules(this.db, rules)
  }

  getTime(range: UsageRangeInput): UsageTimeBucket[] {
    this.ensureAggregatesReady()
    if (range.preset === "today") {
      return this.queryTodayTime(range)
    }
    const usesHourlyBuckets = range.bucket === "hour"
    const bucketColumn = usesHourlyBuckets ? "hour" : "date"
    const tableName = usesHourlyBuckets ? `${this.prefix}_hourly_usage` : `${this.prefix}_daily_usage`
    const usageFilter = this.createAggregateRangeWhere(range, bucketColumn, [`model != ?`], [TOOL_CALLS_AGGREGATE_MODEL])
    const toolFilter = this.createAggregateRangeWhere(range, bucketColumn, [`model = ?`], [TOOL_CALLS_AGGREGATE_MODEL])
    const usageRows = this.db.prepare(`
      SELECT
        ${bucketColumn} AS bucket,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,
        SUM(priced_tokens) AS priced_tokens,
        SUM(unpriced_tokens) AS unpriced_tokens,
        SUM(total_cost) AS estimated_cost,
        SUM(requests) AS requests,
        SUM(conversations) AS conversations
      FROM ${tableName}
      ${usageFilter.whereSql}
      GROUP BY ${bucketColumn}
      ORDER BY ${bucketColumn} ASC
    `).all(...usageFilter.params) as Record<string, unknown>[]
    const modelRows = this.db.prepare(`
      SELECT
        ${bucketColumn} AS bucket,
        model,
        SUM(input_tokens) AS input,
        SUM(output_tokens) AS output,
        SUM(cache_read_tokens) AS cache_read,
        SUM(cache_write_tokens) AS cache_write,
        SUM(reasoning_tokens) AS reasoning,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens
      FROM ${tableName}
      ${usageFilter.whereSql}
      GROUP BY ${bucketColumn}, model
    `).all(...usageFilter.params) as Record<string, unknown>[]
    const toolRows = this.db.prepare(`
      SELECT ${bucketColumn} AS bucket, SUM(tool_calls) AS tool_calls
      FROM ${tableName}
      ${toolFilter.whereSql}
      GROUP BY ${bucketColumn}
    `).all(...toolFilter.params) as Record<string, unknown>[]
    const toolCallsByBucket = new Map(toolRows.map((row) => [String(row.bucket ?? ""), toNumber(row.tool_calls)]))
    const modelsByBucket = new Map<string, {
      model: string
      tokens: number
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
      reasoning: number
    }[]>()
    for (const row of modelRows) {
      const bucket = String(row.bucket ?? "")
      const models = modelsByBucket.get(bucket) ?? []
      models.push({
        model: String(row.model ?? "unknown"),
        tokens: toNumber(row.tokens),
        input: toNumber(row.input),
        output: toNumber(row.output),
        cacheRead: toNumber(row.cache_read),
        cacheWrite: toNumber(row.cache_write),
        reasoning: toNumber(row.reasoning),
      })
      modelsByBucket.set(bucket, models)
    }

    const byBucket = new Map<string, { tokens: number; pricedTokens: number; unpricedTokens: number; estimatedCost: number; requests: number; conversations: number }>()
    for (const row of usageRows) {
      const bucket = String(row.bucket ?? "")
      byBucket.set(bucket, {
        tokens: toNumber(row.tokens),
        pricedTokens: toNumber(row.priced_tokens),
        unpricedTokens: toNumber(row.unpriced_tokens),
        estimatedCost: toNumber(row.estimated_cost),
        requests: toNumber(row.requests),
        conversations: toNumber(row.conversations),
      })
    }

    const conversationsByBucket = this.queryConversationsByBucket(range, bucketColumn)
    return [...byBucket.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, value]) => ({
      bucket,
      tokens: value.tokens,
      pricedTokens: value.pricedTokens,
      unpricedTokens: value.unpricedTokens,
      estimatedCost: value.estimatedCost,
      requests: value.requests,
      conversations: conversationsByBucket.get(bucket) ?? value.conversations,
      toolCalls: toolCallsByBucket.get(bucket) ?? 0,
      dominantModel: (modelsByBucket.get(bucket) ?? []).sort((a, b) => compareDesc(a.tokens, b.tokens))[0]?.model ?? "",
      modelBreakdown: (modelsByBucket.get(bucket) ?? []).sort((a, b) => compareDesc(a.tokens, b.tokens)),
    }))
  }

  getModels(range: UsageRangeInput): UsageModelRow[] {
    this.ensureAggregatesReady()
    if (range.preset === "today") {
      return this.queryModelsFromEvents(range)
    }
    const filter = this.createAggregateRangeWhere(range, "date", [`model != ?`], [TOOL_CALLS_AGGREGATE_MODEL])
    const rows = this.db.prepare(`
      SELECT
        model,
        provider,
        SUM(input_tokens) AS input,
        SUM(output_tokens) AS output,
        SUM(cache_read_tokens) AS cache_read,
        SUM(cache_write_tokens) AS cache_write,
        SUM(reasoning_tokens) AS reasoning,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,
        SUM(priced_tokens) AS priced_tokens,
        SUM(unpriced_tokens) AS unpriced_tokens,
        SUM(total_cost) AS estimated_cost,
        SUM(requests) AS requests
      FROM ${this.prefix}_daily_usage
      ${filter.whereSql}
      GROUP BY provider, model
      ORDER BY tokens DESC
    `).all(...filter.params) as Record<string, unknown>[]
    return rows.map((row) => ({
      model: String(row.model ?? "unknown"),
      provider: String(row.provider ?? ""),
      tokens: toNumber(row.tokens),
      pricedTokens: toNumber(row.priced_tokens),
      unpricedTokens: toNumber(row.unpriced_tokens),
      estimatedCost: toNumber(row.estimated_cost),
      input: toNumber(row.input),
      output: toNumber(row.output),
      cacheRead: toNumber(row.cache_read),
      cacheWrite: toNumber(row.cache_write),
      reasoning: toNumber(row.reasoning),
      requests: toNumber(row.requests),
      averageTokensPerRequest: toNumber(row.requests) > 0 ? toNumber(row.tokens) / toNumber(row.requests) : 0,
    }))
  }

  private queryTodayTime(range: UsageRangeInput): UsageTimeBucket[] {
    const usageFilter = this.createEventRangeWhere(range)
    const toolFilter = this.createEventRangeWhere(range)
    const usageRows = this.db.prepare(`
      SELECT
        hour AS bucket,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,
        SUM(CASE WHEN price_known = 1 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END) AS priced_tokens,
        SUM(CASE WHEN price_known = 0 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END) AS unpriced_tokens,
        SUM(total_cost) AS estimated_cost,
        COUNT(*) AS requests,
        COUNT(DISTINCT session_id) AS conversations
      FROM ${this.prefix}_usage_events
      ${usageFilter.whereSql}
      GROUP BY hour
      ORDER BY hour ASC
    `).all(...usageFilter.params) as Record<string, unknown>[]
    const modelRows = this.db.prepare(`
      SELECT
        hour AS bucket,
        model,
        SUM(input_tokens) AS input,
        SUM(output_tokens) AS output,
        SUM(cache_read_tokens) AS cache_read,
        SUM(cache_write_tokens) AS cache_write,
        SUM(reasoning_tokens) AS reasoning,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens
      FROM ${this.prefix}_usage_events
      ${usageFilter.whereSql}
      GROUP BY hour, model
    `).all(...usageFilter.params) as Record<string, unknown>[]
    const toolRows = this.db.prepare(`
      SELECT hour AS bucket, COUNT(*) AS tool_calls
      FROM ${this.prefix}_tool_events
      ${toolFilter.whereSql}
      GROUP BY hour
    `).all(...toolFilter.params) as Record<string, unknown>[]
    const toolCallsByBucket = new Map(toolRows.map((row) => [String(row.bucket ?? ""), toNumber(row.tool_calls)]))
    const modelsByBucket = new Map<string, {
      model: string
      tokens: number
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
      reasoning: number
    }[]>()
    for (const row of modelRows) {
      const bucket = String(row.bucket ?? "")
      const models = modelsByBucket.get(bucket) ?? []
      models.push({
        model: String(row.model ?? "unknown"),
        tokens: toNumber(row.tokens),
        input: toNumber(row.input),
        output: toNumber(row.output),
        cacheRead: toNumber(row.cache_read),
        cacheWrite: toNumber(row.cache_write),
        reasoning: toNumber(row.reasoning),
      })
      modelsByBucket.set(bucket, models)
    }

    return usageRows.map((row) => {
      const bucket = String(row.bucket ?? "")
      const modelBreakdown = (modelsByBucket.get(bucket) ?? []).sort((a, b) => compareDesc(a.tokens, b.tokens))
      return {
        bucket,
        tokens: toNumber(row.tokens),
        pricedTokens: toNumber(row.priced_tokens),
        unpricedTokens: toNumber(row.unpriced_tokens),
        estimatedCost: toNumber(row.estimated_cost),
        requests: toNumber(row.requests),
        conversations: toNumber(row.conversations),
        toolCalls: toolCallsByBucket.get(bucket) ?? 0,
        dominantModel: modelBreakdown[0]?.model ?? "",
        modelBreakdown,
      }
    })
  }

  private queryModelsFromEvents(range: UsageRangeInput): UsageModelRow[] {
    const filter = this.createEventRangeWhere(range)
    const rows = this.db.prepare(`
      SELECT
        model,
        provider,
        SUM(input_tokens) AS input,
        SUM(output_tokens) AS output,
        SUM(cache_read_tokens) AS cache_read,
        SUM(cache_write_tokens) AS cache_write,
        SUM(reasoning_tokens) AS reasoning,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,
        SUM(CASE WHEN price_known = 1 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END) AS priced_tokens,
        SUM(CASE WHEN price_known = 0 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END) AS unpriced_tokens,
        SUM(total_cost) AS estimated_cost,
        COUNT(*) AS requests
      FROM ${this.prefix}_usage_events
      ${filter.whereSql}
      GROUP BY provider, model
      ORDER BY tokens DESC
    `).all(...filter.params) as Record<string, unknown>[]
    return rows.map((row) => ({
      model: String(row.model ?? "unknown"),
      provider: String(row.provider ?? ""),
      tokens: toNumber(row.tokens),
      pricedTokens: toNumber(row.priced_tokens),
      unpricedTokens: toNumber(row.unpriced_tokens),
      estimatedCost: toNumber(row.estimated_cost),
      input: toNumber(row.input),
      output: toNumber(row.output),
      cacheRead: toNumber(row.cache_read),
      cacheWrite: toNumber(row.cache_write),
      reasoning: toNumber(row.reasoning),
      requests: toNumber(row.requests),
      averageTokensPerRequest: toNumber(row.requests) > 0 ? toNumber(row.tokens) / toNumber(row.requests) : 0,
    }))
  }

  getProjects(range: UsageRangeInput): UsageProjectRow[] {
    this.ensureAggregatesReady()
    if (range.preset === "today") {
      return this.queryProjectsFromEvents(range)
    }
    const filter = this.createAggregateRangeWhere(range, "date", [`model != ?`], [TOOL_CALLS_AGGREGATE_MODEL])
    const rows = this.db.prepare(`
      SELECT
        workspace_key,
        SUM(conversations) AS sessions,
        SUM(requests) AS requests,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,
        SUM(priced_tokens) AS priced_tokens,
        SUM(unpriced_tokens) AS unpriced_tokens,
        SUM(total_cost) AS estimated_cost
      FROM ${this.prefix}_daily_usage
      ${filter.whereSql}
      GROUP BY workspace_key
      ORDER BY tokens DESC
    `).all(...filter.params) as Record<string, unknown>[]
    const toolFilter = this.createAggregateRangeWhere(range, "date", [`model = ?`], [TOOL_CALLS_AGGREGATE_MODEL])
    const toolRows = this.db.prepare(`
      SELECT workspace_key, SUM(tool_calls) AS tool_calls
      FROM ${this.prefix}_daily_usage
      ${toolFilter.whereSql}
      GROUP BY workspace_key
    `).all(...toolFilter.params) as Record<string, unknown>[]
    const toolCallsByWorkspace = new Map(toolRows.map((row) => [String(row.workspace_key ?? ""), toNumber(row.tool_calls)]))
    const metadataByWorkspace = this.queryWorkspaceMetadata(range, rows.map((row) => String(row.workspace_key ?? "")))
    return rows.map((row) => {
      const workspaceKey = String(row.workspace_key ?? "")
      const metadata = metadataByWorkspace.get(workspaceKey)
      const lastTimestamp = toNumber(metadata?.lastTimestampMs)
      return {
        workspaceKey,
        workspaceLabel: metadata?.workspaceLabel || workspaceKey || "unknown",
        sessions: metadata?.sessions ?? toNumber(row.sessions),
        requests: toNumber(row.requests),
        tokens: toNumber(row.tokens),
        pricedTokens: toNumber(row.priced_tokens),
        unpricedTokens: toNumber(row.unpriced_tokens),
        estimatedCost: toNumber(row.estimated_cost),
        toolCalls: toolCallsByWorkspace.get(workspaceKey) ?? 0,
        lastUsedAt: lastTimestamp > 0 ? isoFromTimestamp(lastTimestamp) : "",
      }
    })
  }

  private queryProjectsFromEvents(range: UsageRangeInput): UsageProjectRow[] {
    const filter = this.createEventRangeWhere(range)
    const rows = this.db.prepare(`
      SELECT
        workspace_key,
        MAX(workspace_label) AS workspace_label,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(*) AS requests,
        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens) AS tokens,
        SUM(CASE WHEN price_known = 1 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END) AS priced_tokens,
        SUM(CASE WHEN price_known = 0 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END) AS unpriced_tokens,
        SUM(total_cost) AS estimated_cost,
        MAX(timestamp_ms) AS last_timestamp_ms
      FROM ${this.prefix}_usage_events
      ${filter.whereSql}
      GROUP BY workspace_key
      ORDER BY tokens DESC
    `).all(...filter.params) as Record<string, unknown>[]
    const toolRows = this.db.prepare(`
      SELECT workspace_key, COUNT(*) AS tool_calls
      FROM ${this.prefix}_tool_events
      ${filter.whereSql}
      GROUP BY workspace_key
    `).all(...filter.params) as Record<string, unknown>[]
    const toolCallsByWorkspace = new Map(toolRows.map((row) => [String(row.workspace_key ?? ""), toNumber(row.tool_calls)]))
    return rows.map((row) => {
      const workspaceKey = String(row.workspace_key ?? "")
      const lastTimestamp = toNumber(row.last_timestamp_ms)
      return {
        workspaceKey,
        workspaceLabel: String(row.workspace_label ?? "") || workspaceKey || "unknown",
        sessions: toNumber(row.sessions),
        requests: toNumber(row.requests),
        tokens: toNumber(row.tokens),
        pricedTokens: toNumber(row.priced_tokens),
        unpricedTokens: toNumber(row.unpriced_tokens),
        estimatedCost: toNumber(row.estimated_cost),
        toolCalls: toolCallsByWorkspace.get(workspaceKey) ?? 0,
        lastUsedAt: lastTimestamp > 0 ? isoFromTimestamp(lastTimestamp) : "",
      }
    })
  }

  getTools(range: UsageRangeInput): UsageToolRow[] {
    this.ensureAggregatesReady()
    return this.queryTools(range)
  }

  private queryTools(range: UsageRangeInput, limit?: number): UsageToolRow[] {
    const filter = this.createEventRangeWhere(range)
    const rows = this.db.prepare(`
      SELECT
        tool_name,
        category,
        COUNT(*) AS calls,
        SUM(CASE WHEN status = 'failed' OR (exit_code IS NOT NULL AND exit_code != 0) THEN 1 ELSE 0 END) AS failures,
        AVG(duration_ms) AS average_duration_ms
      FROM ${this.prefix}_tool_events
      ${filter.whereSql}
      GROUP BY category, tool_name
      ORDER BY calls DESC
      ${typeof limit === "number" ? "LIMIT ?" : ""}
    `).all(...filter.params, ...(typeof limit === "number" ? [limit] : [])) as Record<string, unknown>[]
    return rows.map((row) => {
      const calls = toNumber(row.calls)
      const failures = toNumber(row.failures)
      return {
        toolName: String(row.tool_name ?? "unknown"),
        category: String(row.category ?? ""),
        calls,
        failures,
        failureRate: calls > 0 ? failures / calls : 0,
        averageDurationMs: toNumber(row.average_duration_ms),
      }
    })
  }

  getDetails(range: UsageDetailInput): UsageDetailRow[] {
    this.ensureAggregatesReady()
    const limit = Math.min(Math.max(Math.trunc(range.limit ?? 200), 1), 1000)
    const offset = Math.max(Math.trunc(range.offset ?? 0), 0)
    const usageFilter = this.createEventRangeWhere(range, "u.date", "u.timestamp_ms")
    const toolFilter = this.createEventRangeWhere(range)
    const rows = this.db.prepare(`
      SELECT u.*, COALESCE(t.tool_calls, 0) AS tool_calls
      FROM ${this.prefix}_usage_events u
      LEFT JOIN (
        SELECT session_id, COUNT(*) AS tool_calls
        FROM ${this.prefix}_tool_events
        ${toolFilter.whereSql}
        GROUP BY session_id
      ) t ON t.session_id = u.session_id
      ${usageFilter.whereSql}
      ORDER BY u.timestamp_ms DESC
      LIMIT ? OFFSET ?
    `).all(...toolFilter.params, ...usageFilter.params, limit, offset) as unknown as (UsageEventRow & { tool_calls: number })[]
    return rows.map((row) => ({
      id: row.id,
      timestamp: isoFromTimestamp(row.timestamp_ms),
      sessionId: row.session_id,
      workspaceLabel: row.workspace_label || row.workspace_key || "unknown",
      model: row.model,
      tokens: tokenTotal(row),
      pricedTokens: row.price_known === 1 ? tokenTotal(row) : 0,
      unpricedTokens: row.price_known === 1 ? 0 : tokenTotal(row),
      estimatedCost: row.total_cost,
      tokenBreakdown: {
        input: row.input_tokens,
        output: row.output_tokens,
        cacheRead: row.cache_read_tokens,
        cacheWrite: row.cache_write_tokens,
        reasoning: row.reasoning_tokens,
      },
      toolCalls: toNumber(row.tool_calls),
    }))
  }

  private ensureAggregatesReady(): void {
    const usageRow = this.db.prepare(`SELECT EXISTS(SELECT 1 FROM ${this.prefix}_usage_events LIMIT 1) AS exists_value`).get() as { exists_value?: number } | undefined
    if (toNumber(usageRow?.exists_value) === 0) return
    if (this.hasMissingUsageAggregates() || this.hasStaleToolAggregates() || this.hasStaleCostAggregates() || this.hasStalePricingTokenAggregates()) {
      rebuildAggregates(this.db, this.prefix)
    }
  }

  private hasMissingUsageAggregates(): boolean {
    const row = this.db.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM ${this.prefix}_daily_usage LIMIT 1) AS has_daily,
        EXISTS(SELECT 1 FROM ${this.prefix}_hourly_usage LIMIT 1) AS has_hourly
    `).get() as { has_daily?: number; has_hourly?: number } | undefined
    return toNumber(row?.has_daily) === 0 || toNumber(row?.has_hourly) === 0
  }

  private hasStaleToolAggregates(): boolean {
    const toolRow = this.db.prepare(`SELECT EXISTS(SELECT 1 FROM ${this.prefix}_tool_events LIMIT 1) AS exists_value`).get() as { exists_value?: number } | undefined
    if (toNumber(toolRow?.exists_value) === 0) return false
    return this.sumToolAggregateCalls("daily") === 0 || this.sumToolAggregateCalls("hourly") === 0
  }

  private sumToolAggregateCalls(bucket: "daily" | "hourly"): number {
    const aggregateRow = this.db.prepare(`
      SELECT COALESCE(SUM(tool_calls), 0) AS tool_calls
      FROM ${this.prefix}_${bucket}_usage
      WHERE model = ?
    `).get(TOOL_CALLS_AGGREGATE_MODEL) as { tool_calls?: number } | undefined
    return toNumber(aggregateRow?.tool_calls)
  }

  private hasStaleCostAggregates(): boolean {
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(total_cost), 0) AS total_cost,
        COALESCE(SUM(cost_input + cost_output + cost_cache_read + cost_cache_write + cost_reasoning), 0) AS component_cost
      FROM ${this.prefix}_daily_usage
      WHERE model != ?
    `).get(TOOL_CALLS_AGGREGATE_MODEL) as { total_cost?: number; component_cost?: number } | undefined
    return toNumber(row?.total_cost) > 0 && toNumber(row?.component_cost) === 0
  }

  private hasStalePricingTokenAggregates(): boolean {
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens), 0) AS tokens,
        COALESCE(SUM(priced_tokens + unpriced_tokens), 0) AS classified_tokens
      FROM ${this.prefix}_daily_usage
      WHERE model != ?
    `).get(TOOL_CALLS_AGGREGATE_MODEL) as { tokens?: number; classified_tokens?: number } | undefined
    return toNumber(row?.tokens) > 0 && toNumber(row?.classified_tokens) === 0
  }

  private createAggregateRangeWhere(
    range: UsageRangeInput,
    column = "date",
    extraWhere: readonly string[] = [],
    extraParams: readonly (string | number | null)[] = [],
  ): { whereSql: string; params: (string | number | null)[] } {
    const filter = createUsageRangeFilter(range)
    const params: (string | number | null)[] = [...extraParams]
    const where: string[] = [...extraWhere]
    if (filter.sinceDate) {
      where.push(`${column} >= ?`)
      params.push(column === "hour" ? filter.sinceHour ?? `${filter.sinceDate} 00` : filter.sinceDate)
    }
    if (filter.untilDate) {
      where.push(`${column} <= ?`)
      params.push(column === "hour" ? filter.untilHour ?? `${filter.untilDate} 23` : filter.untilDate)
    }
    return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params }
  }

  private createEventRangeWhere(range: UsageRangeInput, dateColumn = "date", timestampColumn = "timestamp_ms"): { whereSql: string; params: (string | number)[] } {
    const filter = createUsageRangeFilter(range)
    const params: (string | number)[] = []
    const where: string[] = []
    if (filter.sinceTimestampMs !== undefined) {
      where.push(`${timestampColumn} >= ?`)
      params.push(filter.sinceTimestampMs)
    } else if (filter.sinceDate) {
      where.push(`${dateColumn} >= ?`)
      params.push(filter.sinceDate)
    }
    if (filter.untilTimestampMs !== undefined) {
      where.push(`${timestampColumn} <= ?`)
      params.push(filter.untilTimestampMs)
    } else if (filter.untilDate) {
      where.push(`${dateColumn} <= ?`)
      params.push(filter.untilDate)
    }
    return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params }
  }

  private queryUsageTotals(range: UsageRangeInput): AggregateValue & {
    costInput: number
    costOutput: number
    costCacheRead: number
    costCacheWrite: number
    costReasoning: number
    conversations: number
    activeDays: number
  } {
    if (range.preset === "today") {
      return this.queryUsageTotalsFromEvents(range)
    }
    const filter = this.createAggregateRangeWhere(range, "date", [`model != ?`], [TOOL_CALLS_AGGREGATE_MODEL])
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) AS input,
        COALESCE(SUM(output_tokens), 0) AS output,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
        COALESCE(SUM(cache_write_tokens), 0) AS cache_write,
        COALESCE(SUM(reasoning_tokens), 0) AS reasoning,
        COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens), 0) AS tokens,
        COALESCE(SUM(priced_tokens), 0) AS priced_tokens,
        COALESCE(SUM(unpriced_tokens), 0) AS unpriced_tokens,
        COALESCE(SUM(total_cost), 0) AS estimated_cost,
        COALESCE(SUM(cost_input), 0) AS cost_input,
        COALESCE(SUM(cost_output), 0) AS cost_output,
        COALESCE(SUM(cost_cache_read), 0) AS cost_cache_read,
        COALESCE(SUM(cost_cache_write), 0) AS cost_cache_write,
        COALESCE(SUM(cost_reasoning), 0) AS cost_reasoning,
        COALESCE(SUM(requests), 0) AS requests,
        COALESCE(SUM(conversations), 0) AS conversations,
        COUNT(DISTINCT date) AS active_days
      FROM ${this.prefix}_daily_usage
      ${filter.whereSql}
    `).get(...filter.params) as Record<string, unknown> | undefined
    return {
      input: toNumber(row?.input),
      output: toNumber(row?.output),
      cacheRead: toNumber(row?.cache_read),
      cacheWrite: toNumber(row?.cache_write),
      reasoning: toNumber(row?.reasoning),
      tokens: toNumber(row?.tokens),
      pricedTokens: toNumber(row?.priced_tokens),
      unpricedTokens: toNumber(row?.unpriced_tokens),
      estimatedCost: toNumber(row?.estimated_cost),
      requests: toNumber(row?.requests),
      costInput: toNumber(row?.cost_input),
      costOutput: toNumber(row?.cost_output),
      costCacheRead: toNumber(row?.cost_cache_read),
      costCacheWrite: toNumber(row?.cost_cache_write),
      costReasoning: toNumber(row?.cost_reasoning),
      conversations: this.queryConversationTotal(range) ?? toNumber(row?.conversations),
      activeDays: toNumber(row?.active_days),
    }
  }

  private queryUsageTotalsFromEvents(range: UsageRangeInput): AggregateValue & {
    costInput: number
    costOutput: number
    costCacheRead: number
    costCacheWrite: number
    costReasoning: number
    conversations: number
    activeDays: number
  } {
    const filter = this.createEventRangeWhere(range)
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) AS input,
        COALESCE(SUM(output_tokens), 0) AS output,
        COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
        COALESCE(SUM(cache_write_tokens), 0) AS cache_write,
        COALESCE(SUM(reasoning_tokens), 0) AS reasoning,
        COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens), 0) AS tokens,
        COALESCE(SUM(CASE WHEN price_known = 1 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END), 0) AS priced_tokens,
        COALESCE(SUM(CASE WHEN price_known = 0 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END), 0) AS unpriced_tokens,
        COALESCE(SUM(total_cost), 0) AS estimated_cost,
        COALESCE(SUM(cost_input), 0) AS cost_input,
        COALESCE(SUM(cost_output), 0) AS cost_output,
        COALESCE(SUM(cost_cache_read), 0) AS cost_cache_read,
        COALESCE(SUM(cost_cache_write), 0) AS cost_cache_write,
        COALESCE(SUM(cost_reasoning), 0) AS cost_reasoning,
        COUNT(*) AS requests,
        COUNT(DISTINCT session_id) AS conversations,
        COUNT(DISTINCT date) AS active_days
      FROM ${this.prefix}_usage_events
      ${filter.whereSql}
    `).get(...filter.params) as Record<string, unknown> | undefined
    return {
      input: toNumber(row?.input),
      output: toNumber(row?.output),
      cacheRead: toNumber(row?.cache_read),
      cacheWrite: toNumber(row?.cache_write),
      reasoning: toNumber(row?.reasoning),
      tokens: toNumber(row?.tokens),
      pricedTokens: toNumber(row?.priced_tokens),
      unpricedTokens: toNumber(row?.unpriced_tokens),
      estimatedCost: toNumber(row?.estimated_cost),
      requests: toNumber(row?.requests),
      costInput: toNumber(row?.cost_input),
      costOutput: toNumber(row?.cost_output),
      costCacheRead: toNumber(row?.cost_cache_read),
      costCacheWrite: toNumber(row?.cost_cache_write),
      costReasoning: toNumber(row?.cost_reasoning),
      conversations: toNumber(row?.conversations),
      activeDays: toNumber(row?.active_days),
    }
  }

  private queryToolCallTotal(range: UsageRangeInput): number {
    if (range.preset === "today") {
      const filter = this.createEventRangeWhere(range)
      const row = this.db.prepare(`
        SELECT COUNT(*) AS calls
        FROM ${this.prefix}_tool_events
        ${filter.whereSql}
      `).get(...filter.params) as { calls?: number } | undefined
      return toNumber(row?.calls)
    }
    const filter = this.createAggregateRangeWhere(range, "date", [`model = ?`], [TOOL_CALLS_AGGREGATE_MODEL])
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(tool_calls), 0) AS calls
      FROM ${this.prefix}_daily_usage
      ${filter.whereSql}
    `).get(...filter.params) as { calls?: number } | undefined
    return toNumber(row?.calls)
  }

  private queryConversationTotal(range: UsageRangeInput): number | null {
    const filter = this.createEventRangeWhere(range)
    const row = this.db.prepare(`
      SELECT COUNT(*) AS rows_count, COUNT(DISTINCT session_id) AS conversations
      FROM ${this.prefix}_usage_events
      ${filter.whereSql}
    `).get(...filter.params) as { rows_count?: number; conversations?: number } | undefined
    return toNumber(row?.rows_count) > 0 ? toNumber(row?.conversations) : null
  }

  private queryConversationsByBucket(range: UsageRangeInput, bucketColumn: "date" | "hour"): Map<string, number> {
    const filter = this.createEventRangeWhere(range)
    const rows = this.db.prepare(`
      SELECT ${bucketColumn} AS bucket, COUNT(DISTINCT session_id) AS conversations
      FROM ${this.prefix}_usage_events
      ${filter.whereSql}
      GROUP BY ${bucketColumn}
    `).all(...filter.params) as Record<string, unknown>[]
    return new Map(rows.map((row) => [String(row.bucket ?? ""), toNumber(row.conversations)]))
  }

  private queryWorkspaceMetadata(
    range: UsageRangeInput,
    workspaceKeys: readonly string[],
  ): Map<string, { workspaceLabel: string; sessions: number; lastTimestampMs: number }> {
    const keys = [...new Set(workspaceKeys.filter(Boolean))]
    if (keys.length === 0) return new Map()
    const filter = this.createEventRangeWhere(range)
    const placeholders = keys.map(() => "?").join(", ")
    const rows = this.db.prepare(`
      SELECT
        workspace_key,
        MAX(workspace_label) AS workspace_label,
        COUNT(DISTINCT session_id) AS sessions,
        MAX(timestamp_ms) AS last_timestamp_ms
      FROM ${this.prefix}_usage_events
      ${filter.whereSql ? `${filter.whereSql} AND` : "WHERE"} workspace_key IN (${placeholders})
      GROUP BY workspace_key
    `).all(...filter.params, ...keys) as Record<string, unknown>[]
    return new Map(rows.map((row) => [String(row.workspace_key ?? ""), {
      workspaceLabel: String(row.workspace_label ?? ""),
      sessions: toNumber(row.sessions),
      lastTimestampMs: toNumber(row.last_timestamp_ms),
    }]))
  }
}

async function refreshUsageNamespace(options: {
  readonly db: DatabaseSync
  readonly prefix: "cc" | "cx"
  readonly roots: string[]
  readonly parseFile: (filePath: string, parseOptions?: { readonly startLine?: number; readonly priceRules?: readonly UsageModelPriceRule[] }) => Promise<ParsedFileWithTasks>
}): Promise<UsageRefreshResult> {
  const startedAt = Date.now()
  const files = collectJsonlFiles(options.roots)
  const priceRules = listUsagePriceRules(options.db)
  const pricedAt = new Date().toISOString()
  let parsedFiles = 0
  let skippedFiles = 0
  let failedFiles = 0
  let usageEvents = 0
  let toolEvents = 0

  for (const file of files) {
    let fp: ReturnType<typeof fingerprintFile> | null = null
    try {
      fp = fingerprintFile(file)
      const existing = options.db.prepare(`SELECT size, mtime_ms, line_count, parse_status FROM ${options.prefix}_scan_files WHERE file_path = ?`).get(file) as ScanFileRow | undefined
      if (existing?.size === fp.size && existing.mtime_ms === fp.mtimeMs && existing.parse_status === "parsed") {
        skippedFiles += 1
        continue
      }

      const canAppend = options.prefix === "cc" && existing?.parse_status === "parsed" && fp.size >= existing.size && existing.line_count > 0
      const parsed = await options.parseFile(file, canAppend ? { startLine: existing.line_count, priceRules } : { priceRules })
      if (canAppend && parsed.lineCount <= existing.line_count) {
        markScanFile(options.db, options.prefix, file, fp.size, fp.mtimeMs, parsed.lineCount)
        skippedFiles += 1
        continue
      }
      const fingerprint = fp
      await runWithUsageDatabaseLockRetry(() => {
        persistParsedFile(options.db, options.prefix, file, fingerprint.size, fingerprint.mtimeMs, parsed, canAppend ? "append" : "replace", pricedAt)
      })
      parsedFiles += 1
      usageEvents += parsed.usageEvents.length
      toolEvents += parsed.toolEvents.length
    } catch (error) {
      failedFiles += 1
      const errorKind = error instanceof Error ? error.name : "ParseError"
      await runWithUsageDatabaseLockRetry(() => {
        markFailedScanFile(options.db, options.prefix, file, fp?.size ?? 0, fp?.mtimeMs ?? 0, errorKind)
      })
    }
  }

  await runWithUsageDatabaseLockRetry(() => {
    rebuildAggregates(options.db, options.prefix)
  })

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

function persistParsedFile(
  db: DatabaseSync,
  prefix: "cc" | "cx",
  filePath: string,
  size: number,
  mtimeMs: number,
  parsed: ParsedFileWithTasks,
  mode: "append" | "replace",
  pricedAt: string,
): void {
  let transactionStarted = false
  db.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    const oldSessions = db.prepare(`SELECT session_id FROM ${prefix}_sessions WHERE file_path = ?`).all(filePath) as { session_id: string }[]
    const sessionIds = new Set([...oldSessions.map((row) => row.session_id), ...parsed.sessions.map((session) => session.sessionId)])
    if (mode === "replace") {
      for (const sessionId of sessionIds) {
        db.prepare(`DELETE FROM ${prefix}_usage_events WHERE session_id = ?`).run(sessionId)
        db.prepare(`DELETE FROM ${prefix}_tool_events WHERE session_id = ?`).run(sessionId)
        db.prepare(`DELETE FROM ${prefix}_sessions WHERE session_id = ?`).run(sessionId)
        if (prefix === "cx") db.prepare("DELETE FROM cx_task_events WHERE session_id = ?").run(sessionId)
      }
    }

    const insertSession = db.prepare(`
      INSERT INTO ${prefix}_sessions (
        session_id, file_path, workspace_key, workspace_label, provider, source, cli_version,
        started_at, ended_at, model_summary, request_count, conversation_count, tool_call_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        file_path = excluded.file_path,
        workspace_key = COALESCE(NULLIF(excluded.workspace_key, ''), ${prefix}_sessions.workspace_key),
        workspace_label = COALESCE(NULLIF(excluded.workspace_label, ''), ${prefix}_sessions.workspace_label),
        provider = COALESCE(NULLIF(excluded.provider, ''), ${prefix}_sessions.provider),
        source = COALESCE(NULLIF(excluded.source, ''), ${prefix}_sessions.source),
        cli_version = COALESCE(NULLIF(excluded.cli_version, ''), ${prefix}_sessions.cli_version),
        started_at = CASE
          WHEN ${prefix}_sessions.started_at = '' THEN excluded.started_at
          WHEN excluded.started_at = '' THEN ${prefix}_sessions.started_at
          WHEN excluded.started_at < ${prefix}_sessions.started_at THEN excluded.started_at
          ELSE ${prefix}_sessions.started_at
        END,
        ended_at = CASE
          WHEN excluded.ended_at > ${prefix}_sessions.ended_at THEN excluded.ended_at
          ELSE ${prefix}_sessions.ended_at
        END,
        model_summary = COALESCE(NULLIF(excluded.model_summary, ''), ${prefix}_sessions.model_summary),
        conversation_count = ${mode === "append" ? `${prefix}_sessions.conversation_count + excluded.conversation_count` : "excluded.conversation_count"}
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
      INSERT OR REPLACE INTO ${prefix}_usage_events (
        id, session_id, timestamp_ms, date, hour, workspace_key, workspace_label, model, provider,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
        cost_input, cost_output, cost_cache_read, cost_cache_write, cost_reasoning, total_cost, price_known,
        cost_currency, pricing_rate, priced_at, pricing_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        event.priceKnown ? 1 : 0,
        SYNAPSE_COST_CURRENCY,
        USD_TO_CNY_RATE,
        pricedAt,
        "",
      )
    }

    const insertTool = db.prepare(`
      INSERT OR REPLACE INTO ${prefix}_tool_events (
        id, session_id, timestamp_ms, date, hour, workspace_key, tool_name, category, status, exit_code, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const event of parsed.toolEvents) {
      insertTool.run(
        event.id,
        event.sessionId,
        event.timestampMs,
        event.date,
        event.hour,
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
        INSERT OR REPLACE INTO cx_task_events (id, session_id, started_at, completed_at, duration_ms, time_to_first_token_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const event of parsed.taskEvents) {
        insertTask.run(event.id, event.sessionId, event.startedAt, event.completedAt, event.durationMs, event.timeToFirstTokenMs)
      }
    }

    refreshSessionSummaries(db, prefix, [...sessionIds])
    markScanFile(db, prefix, filePath, size, mtimeMs, parsed.lineCount)
    db.exec("COMMIT")
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) db.exec("ROLLBACK")
    throw error
  }
}

function markScanFile(db: DatabaseSync, prefix: "cc" | "cx", filePath: string, size: number, mtimeMs: number, lineCount: number): void {
  db.prepare(`
    INSERT INTO ${prefix}_scan_files (file_path, size, mtime_ms, line_count, parse_status, error_kind, last_scanned_at)
    VALUES (?, ?, ?, ?, 'parsed', NULL, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      line_count = excluded.line_count,
      parse_status = excluded.parse_status,
      error_kind = excluded.error_kind,
      last_scanned_at = excluded.last_scanned_at
  `).run(filePath, size, mtimeMs, lineCount, new Date().toISOString())
}

function markFailedScanFile(db: DatabaseSync, prefix: "cc" | "cx", filePath: string, size: number, mtimeMs: number, errorKind: string): void {
  db.prepare(`
    INSERT INTO ${prefix}_scan_files (file_path, size, mtime_ms, line_count, parse_status, error_kind, last_scanned_at)
    VALUES (?, ?, ?, 0, 'failed', ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      size = excluded.size,
      mtime_ms = excluded.mtime_ms,
      line_count = excluded.line_count,
      parse_status = excluded.parse_status,
      error_kind = excluded.error_kind,
      last_scanned_at = excluded.last_scanned_at
  `).run(filePath, size, mtimeMs, errorKind, new Date().toISOString())
}

function refreshSessionSummaries(db: DatabaseSync, prefix: "cc" | "cx", sessionIds: readonly string[]): void {
  const update = db.prepare(`
    UPDATE ${prefix}_sessions SET
      request_count = (SELECT COUNT(*) FROM ${prefix}_usage_events WHERE session_id = ?),
      tool_call_count = (SELECT COUNT(*) FROM ${prefix}_tool_events WHERE session_id = ?),
      model_summary = COALESCE((
        SELECT GROUP_CONCAT(model, ', ')
        FROM (SELECT DISTINCT model FROM ${prefix}_usage_events WHERE session_id = ? AND model != '')
      ), model_summary)
    WHERE session_id = ?
  `)
  for (const sessionId of sessionIds) {
    update.run(sessionId, sessionId, sessionId, sessionId)
  }
}

function rebuildAggregates(db: DatabaseSync, prefix: "cc" | "cx"): void {
  let transactionStarted = false
  db.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    db.exec(`DELETE FROM ${prefix}_daily_usage`)
    db.exec(`DELETE FROM ${prefix}_hourly_usage`)
    db.exec(`
      INSERT INTO ${prefix}_daily_usage (
        date, model, provider, workspace_key, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, priced_tokens, unpriced_tokens, cost_input, cost_output, cost_cache_read, cost_cache_write,
        cost_reasoning, total_cost, price_known, cost_currency, requests, conversations, tool_calls
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
        SUM(CASE WHEN price_known = 1 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END),
        SUM(CASE WHEN price_known = 0 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END),
        SUM(cost_input),
        SUM(cost_output),
        SUM(cost_cache_read),
        SUM(cost_cache_write),
        SUM(cost_reasoning),
        SUM(total_cost),
        MAX(price_known),
        '${SYNAPSE_COST_CURRENCY}',
        COUNT(*),
        COUNT(DISTINCT session_id),
        0
      FROM ${prefix}_usage_events
      GROUP BY date, model, provider, workspace_key
    `)
    db.exec(`
      INSERT INTO ${prefix}_daily_usage (
        date, model, provider, workspace_key, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, priced_tokens, unpriced_tokens, cost_input, cost_output, cost_cache_read, cost_cache_write,
        cost_reasoning, total_cost, price_known, cost_currency, requests, conversations, tool_calls
      )
      SELECT
        date,
        '${TOOL_CALLS_AGGREGATE_MODEL}',
        '',
        workspace_key,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        '${SYNAPSE_COST_CURRENCY}',
        0,
        0,
        COUNT(*)
      FROM ${prefix}_tool_events
      GROUP BY date, workspace_key
    `)
    db.exec(`
      INSERT INTO ${prefix}_hourly_usage (
        hour, model, provider, workspace_key, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, priced_tokens, unpriced_tokens, cost_input, cost_output, cost_cache_read, cost_cache_write,
        cost_reasoning, total_cost, price_known, cost_currency, requests, conversations, tool_calls
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
        SUM(CASE WHEN price_known = 1 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END),
        SUM(CASE WHEN price_known = 0 THEN input_tokens + output_tokens + cache_read_tokens + cache_write_tokens + reasoning_tokens ELSE 0 END),
        SUM(cost_input),
        SUM(cost_output),
        SUM(cost_cache_read),
        SUM(cost_cache_write),
        SUM(cost_reasoning),
        SUM(total_cost),
        MAX(price_known),
        '${SYNAPSE_COST_CURRENCY}',
        COUNT(*),
        COUNT(DISTINCT session_id),
        0
      FROM ${prefix}_usage_events
      GROUP BY hour, model, provider, workspace_key
    `)
    db.exec(`
      INSERT INTO ${prefix}_hourly_usage (
        hour, model, provider, workspace_key, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, priced_tokens, unpriced_tokens, cost_input, cost_output, cost_cache_read, cost_cache_write,
        cost_reasoning, total_cost, price_known, cost_currency, requests, conversations, tool_calls
      )
      SELECT
        hour,
        '${TOOL_CALLS_AGGREGATE_MODEL}',
        '',
        workspace_key,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        '${SYNAPSE_COST_CURRENCY}',
        0,
        0,
        COUNT(*)
      FROM ${prefix}_tool_events
      GROUP BY hour, workspace_key
    `)
    db.exec("COMMIT")
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) db.exec("ROLLBACK")
    throw error
  }
}

export { refreshUsageNamespace, rebuildAggregates }

export async function runWithUsageDatabaseLockRetry<T>(operation: () => T): Promise<T> {
  const startedAt = Date.now()
  while (true) {
    try {
      return operation()
    } catch (error) {
      if (!isUsageDatabaseLockError(error) || Date.now() - startedAt >= DATABASE_LOCK_RETRY_MAX_ELAPSED_MS) {
        throw error
      }
      await delay(DATABASE_LOCK_RETRY_DELAY_MS)
    }
  }
}

function isUsageDatabaseLockError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
