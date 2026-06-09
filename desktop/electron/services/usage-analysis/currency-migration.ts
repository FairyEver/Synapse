import type { DatabaseSync } from "node:sqlite"
import { SYNAPSE_COST_CURRENCY, USD_TO_CNY_RATE } from "../../../action-packages/shared/cost-currency"
import { createMainLogger } from "../log-store"

export const RMB_MIGRATION_META_KEY = "cost_currency_migrated_to_cny_v1"

const RMB_MIGRATION_VERSION = "fixed-usd-to-cny-7.2-v1"
const logger = createMainLogger("service.usage-analysis.currency-migration")

type UsagePrefix = "cc" | "cx"

interface CurrencyMigrationAffectedRows {
  usageEvents: Record<UsagePrefix, number>
  dailyUsage: Record<UsagePrefix, number>
  hourlyUsage: Record<UsagePrefix, number>
}

export function migrateUsageAnalysisCostsToCny(database: DatabaseSync): void {
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
      affectedRows.dailyUsage[prefix] = migrateAggregateTable(database, `${prefix}_daily_usage`)
      affectedRows.hourlyUsage[prefix] = migrateAggregateTable(database, `${prefix}_hourly_usage`)
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

function migrateAggregateTable(database: DatabaseSync, table: string): number {
  const result = database.prepare(`
    UPDATE ${table} SET
      cost_input = cost_input * ?,
      cost_output = cost_output * ?,
      cost_cache_read = cost_cache_read * ?,
      cost_cache_write = cost_cache_write * ?,
      cost_reasoning = cost_reasoning * ?,
      total_cost = total_cost * ?,
      cost_currency = ?
    WHERE cost_currency = '' OR UPPER(cost_currency) = 'USD'
  `).run(
    USD_TO_CNY_RATE,
    USD_TO_CNY_RATE,
    USD_TO_CNY_RATE,
    USD_TO_CNY_RATE,
    USD_TO_CNY_RATE,
    USD_TO_CNY_RATE,
    SYNAPSE_COST_CURRENCY,
  )
  return toChangeCount(result.changes)
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
