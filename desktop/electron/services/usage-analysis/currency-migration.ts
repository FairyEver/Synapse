import type { DatabaseSync } from "node:sqlite"
import { SYNAPSE_COST_CURRENCY, USD_TO_CNY_RATE } from "../../../action-packages/shared/cost-currency"
import { seedDefaultUsagePriceRules } from "./pricing"

export const RMB_MIGRATION_META_KEY = "cost_currency_migrated_to_cny_v1"

const RMB_MIGRATION_VERSION = "fixed-usd-to-cny-7.2-v1"

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
  usageModelPrices: number
  usageEvents: Record<UsagePrefix, number>
  dailyUsage: Record<UsagePrefix, number>
  hourlyUsage: Record<UsagePrefix, number>
}

export function migrateUsageAnalysisCostsToCny(
  database: DatabaseSync,
  logger: UsageAnalysisMigrationLogger = noopUsageAnalysisMigrationLogger,
): void {
  const marker = database.prepare("SELECT value FROM usage_pricing_meta WHERE key = ?").get(RMB_MIGRATION_META_KEY) as { value?: string } | undefined
  if (marker?.value) return

  const migratedAt = new Date().toISOString()
  const affectedRows = createAffectedRows()
  const modelPriceRows = countRows(database, "usage_model_prices")
  const seededDefaultPriceRules = modelPriceRows === 0
  logger.info("Usage CNY cost migration started.", {
    rate: USD_TO_CNY_RATE,
    modelPriceRows,
    seededDefaultPriceRules,
  })
  let transactionStarted = false
  database.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    if (seededDefaultPriceRules) {
      seedDefaultUsagePriceRules(database)
      affectedRows.usageModelPrices = countRows(database, "usage_model_prices")
    } else {
      const result = database.prepare(`
        UPDATE usage_model_prices SET
          input_per_1m = input_per_1m * ?,
          output_per_1m = output_per_1m * ?,
          cache_read_per_1m = cache_read_per_1m * ?,
          cache_write_per_1m = cache_write_per_1m * ?,
          reasoning_per_1m = reasoning_per_1m * ?,
          currency = ?
        WHERE currency = '' OR UPPER(currency) = 'USD'
      `).run(USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, SYNAPSE_COST_CURRENCY)
      affectedRows.usageModelPrices = toChangeCount(result.changes)
    }

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
      INSERT OR REPLACE INTO usage_pricing_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(RMB_MIGRATION_META_KEY, JSON.stringify({ currency: SYNAPSE_COST_CURRENCY, rate: USD_TO_CNY_RATE, migratedAt }), migratedAt)
    database.exec("COMMIT")
    transactionStarted = false
    logger.info("Usage CNY cost migration completed.", {
      rate: USD_TO_CNY_RATE,
      seededDefaultPriceRules,
      affectedRows,
    })
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK")
    logger.error("Usage CNY cost migration failed.", {
      rate: USD_TO_CNY_RATE,
      seededDefaultPriceRules,
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

function countRows(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count_value FROM ${table}`).get() as { count_value?: number } | undefined
  return Number(row?.count_value ?? 0)
}

function createAffectedRows(): CurrencyMigrationAffectedRows {
  return {
    usageModelPrices: 0,
    usageEvents: { cc: 0, cx: 0 },
    dailyUsage: { cc: 0, cx: 0 },
    hourlyUsage: { cc: 0, cx: 0 },
  }
}

function toChangeCount(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value
}
