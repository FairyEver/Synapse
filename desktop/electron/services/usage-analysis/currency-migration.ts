import type { DatabaseSync } from "node:sqlite"
import { SYNAPSE_COST_CURRENCY, USD_TO_CNY_RATE } from "../../../action-packages/shared/cost-currency"

export const RMB_MIGRATION_META_KEY = "cost_currency_migrated_to_cny_v1"

const RMB_MIGRATION_VERSION = "fixed-usd-to-cny-7.2-v1"
const TOOL_CALLS_AGGREGATE_MODEL = "__synapse_tool_calls__"

type UsagePrefix = "cc" | "cx"

export interface UsageAnalysisMigrationLogger {
  info(message: string, details?: Record<string, unknown>): void
  error(message: string, details?: Record<string, unknown>): void
}

const noopUsageAnalysisMigrationLogger: UsageAnalysisMigrationLogger = {
  info: () => undefined,
  error: () => undefined,
}

interface CurrencyMigrationAffectedRows {
  usageEvents: Record<UsagePrefix, number>
  dailyUsage: Record<UsagePrefix, number>
  hourlyUsage: Record<UsagePrefix, number>
}

export function migrateUsageAnalysisCostsToCny(
  database: DatabaseSync,
  logger: UsageAnalysisMigrationLogger = noopUsageAnalysisMigrationLogger,
): void {
  const marker = database.prepare("SELECT value FROM model_price_meta WHERE key = ?").get(RMB_MIGRATION_META_KEY) as { value?: string } | undefined
  if (marker?.value) return

  const migratedAt = new Date().toISOString()
  const affectedRows = createAffectedRows()
  logger.info("Usage CNY cost migration started.", {
    rate: USD_TO_CNY_RATE,
  })
  let transactionStarted = false
  database.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    for (const prefix of ["cc", "cx"] as const) {
      const eventResult = database.prepare(`
        UPDATE ${prefix}_usage_events SET
          cost_input = cost_input * ?,
          cost_output = cost_output * ?,
          cost_cache_read = cost_cache_read * ?,
          cost_cache_write = cost_cache_write * ?,
          cost_reasoning = cost_reasoning * ?,
          total_cost = total_cost * ?,
          cost_currency = ?,
          pricing_rate = ?,
          priced_at = CASE WHEN priced_at = '' THEN ? ELSE priced_at END,
          pricing_version = CASE WHEN pricing_version = '' THEN ? ELSE pricing_version END
        WHERE cost_currency = '' OR UPPER(cost_currency) = 'USD'
      `).run(
        USD_TO_CNY_RATE,
        USD_TO_CNY_RATE,
        USD_TO_CNY_RATE,
        USD_TO_CNY_RATE,
        USD_TO_CNY_RATE,
        USD_TO_CNY_RATE,
        SYNAPSE_COST_CURRENCY,
        USD_TO_CNY_RATE,
        migratedAt,
        RMB_MIGRATION_VERSION,
      )
      affectedRows.usageEvents[prefix] = toChangeCount(eventResult.changes)
      const rebuiltAggregates = rebuildAggregateTables(database, prefix)
      affectedRows.dailyUsage[prefix] = rebuiltAggregates.dailyUsage
      affectedRows.hourlyUsage[prefix] = rebuiltAggregates.hourlyUsage
    }

    database.prepare(`
      INSERT OR REPLACE INTO model_price_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(RMB_MIGRATION_META_KEY, JSON.stringify({ currency: SYNAPSE_COST_CURRENCY, rate: USD_TO_CNY_RATE, migratedAt }), migratedAt)
    database.exec("COMMIT")
    transactionStarted = false
    logger.info("Usage CNY cost migration completed.", {
      rate: USD_TO_CNY_RATE,
      affectedRows,
    })
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK")
    logger.error("Usage CNY cost migration failed.", {
      rate: USD_TO_CNY_RATE,
      affectedRows,
      error,
    })
    throw error
  }
}

function rebuildAggregateTables(database: DatabaseSync, prefix: UsagePrefix): { dailyUsage: number; hourlyUsage: number } {
  database.exec(`DELETE FROM ${prefix}_daily_usage`)
  database.exec(`DELETE FROM ${prefix}_hourly_usage`)

  const dailyUsageEvents = database.prepare(`
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
  `).run()
  const dailyToolEvents = database.prepare(`
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
  `).run()

  const hourlyUsageEvents = database.prepare(`
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
  `).run()
  const hourlyToolEvents = database.prepare(`
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
  `).run()

  return {
    dailyUsage: toChangeCount(dailyUsageEvents.changes) + toChangeCount(dailyToolEvents.changes),
    hourlyUsage: toChangeCount(hourlyUsageEvents.changes) + toChangeCount(hourlyToolEvents.changes),
  }
}

function createAffectedRows(): CurrencyMigrationAffectedRows {
  return {
    usageEvents: { cc: 0, cx: 0 },
    dailyUsage: { cc: 0, cx: 0 },
    hourlyUsage: { cc: 0, cx: 0 },
  }
}

function toChangeCount(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value
}
