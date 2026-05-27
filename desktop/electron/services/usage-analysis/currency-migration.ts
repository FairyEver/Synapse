import type { DatabaseSync } from "node:sqlite"
import { SYNAPSE_COST_CURRENCY, USD_TO_CNY_RATE } from "../../../action-packages/shared/cost-currency"
import { seedDefaultUsagePriceRules } from "./pricing"

export const RMB_MIGRATION_META_KEY = "cost_currency_migrated_to_cny_v1"

const RMB_MIGRATION_VERSION = "fixed-usd-to-cny-7.2-v1"

export function migrateUsageAnalysisCostsToCny(database: DatabaseSync): void {
  const marker = database.prepare("SELECT value FROM usage_pricing_meta WHERE key = ?").get(RMB_MIGRATION_META_KEY) as { value?: string } | undefined
  if (marker?.value) return

  const migratedAt = new Date().toISOString()
  let transactionStarted = false
  database.exec("BEGIN IMMEDIATE")
  transactionStarted = true
  try {
    if (countRows(database, "usage_model_prices") === 0) {
      seedDefaultUsagePriceRules(database)
    } else {
      database.prepare(`
        UPDATE usage_model_prices SET
          input_per_1m = input_per_1m * ?,
          output_per_1m = output_per_1m * ?,
          cache_read_per_1m = cache_read_per_1m * ?,
          cache_write_per_1m = cache_write_per_1m * ?,
          reasoning_per_1m = reasoning_per_1m * ?,
          currency = ?
        WHERE currency = '' OR UPPER(currency) = 'USD'
      `).run(USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, USD_TO_CNY_RATE, SYNAPSE_COST_CURRENCY)
    }

    for (const prefix of ["cc", "cx"] as const) {
      database.prepare(`
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
      migrateAggregateTable(database, `${prefix}_daily_usage`)
      migrateAggregateTable(database, `${prefix}_hourly_usage`)
    }

    database.prepare(`
      INSERT OR REPLACE INTO usage_pricing_meta (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(RMB_MIGRATION_META_KEY, JSON.stringify({ currency: SYNAPSE_COST_CURRENCY, rate: USD_TO_CNY_RATE, migratedAt }), migratedAt)
    database.exec("COMMIT")
    transactionStarted = false
  } catch (error) {
    if (transactionStarted) database.exec("ROLLBACK")
    throw error
  }
}

function migrateAggregateTable(database: DatabaseSync, table: string): void {
  database.prepare(`
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
}

function countRows(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count_value FROM ${table}`).get() as { count_value?: number } | undefined
  return Number(row?.count_value ?? 0)
}
