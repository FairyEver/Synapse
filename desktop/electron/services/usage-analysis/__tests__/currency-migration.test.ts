import { afterEach, describe, expect, it, vi } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { USD_TO_CNY_RATE } from "../../../../action-packages/shared/cost-currency"
import { initUsageAnalysisSchema } from "../db-schema"
import {
  migrateUsageAnalysisCostsToCny,
  RMB_MIGRATION_META_KEY,
} from "../currency-migration"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock("../../log-store", () => ({
  createMainLogger: () => logger,
}))

afterEach(() => {
  logger.info.mockClear()
  logger.warn.mockClear()
  logger.error.mockClear()
})

describe("migrateUsageAnalysisCostsToCny", () => {
  it("logs migration start and completed row counts", () => {
    const db = createLegacyUsageDatabase()

    migrateUsageAnalysisCostsToCny(db)

    expect(logger.info).toHaveBeenCalledWith("Usage CNY cost migration started.", {
      rate: USD_TO_CNY_RATE,
    })
    expect(logger.info).toHaveBeenCalledWith("Usage CNY cost migration completed.", {
      rate: USD_TO_CNY_RATE,
      affectedRows: {
        usageEvents: { cc: 1, cx: 1 },
        dailyUsage: { cc: 1, cx: 0 },
        hourlyUsage: { cc: 1, cx: 0 },
      },
    })
    db.close()
  })

  it("logs migration failures before rethrowing", () => {
    const db = createLegacyUsageDatabase()
    db.exec("DROP TABLE cx_usage_events")

    expect(() => migrateUsageAnalysisCostsToCny(db)).toThrow()

    expect(logger.error).toHaveBeenCalledWith("Usage CNY cost migration failed.", expect.objectContaining({
      rate: USD_TO_CNY_RATE,
      error: expect.any(Error),
      affectedRows: expect.objectContaining({
        usageEvents: expect.objectContaining({ cc: 1 }),
      }),
    }))
    db.close()
  })
})

function createLegacyUsageDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  initUsageAnalysisSchema(db)
  logger.info.mockClear()
  logger.error.mockClear()
  db.exec(`
    DELETE FROM model_price_meta WHERE key = '${RMB_MIGRATION_META_KEY}';
    INSERT INTO cc_usage_events (
      id, session_id, timestamp_ms, date, hour, model, input_tokens, output_tokens,
      cost_input, cost_output, total_cost, price_known, cost_currency
    ) VALUES ('cc-event-1', 'session-1', 1770000000000, '2026-05-01', '2026-05-01 10', 'legacy-model', 100, 50, 1, 2, 3, 1, 'USD');
    INSERT INTO cx_usage_events (
      id, session_id, timestamp_ms, date, hour, model, input_tokens, output_tokens,
      cost_input, cost_output, total_cost, price_known, cost_currency
    ) VALUES ('cx-event-1', 'session-2', 1770000000000, '2026-05-01', '2026-05-01 10', 'legacy-model', 100, 50, 1, 2, 3, 1, 'USD');
    INSERT INTO cc_daily_usage (
      date, model, workspace_key, input_tokens, output_tokens, cost_input, cost_output,
      total_cost, price_known, cost_currency, requests, conversations
    ) VALUES ('2026-05-01', 'legacy-model', '', 100, 50, 1, 2, 3, 1, 'USD', 1, 1);
    INSERT INTO cc_hourly_usage (
      hour, model, workspace_key, input_tokens, output_tokens, cost_input, cost_output,
      total_cost, price_known, cost_currency, requests, conversations
    ) VALUES ('2026-05-01 10', 'legacy-model', '', 100, 50, 1, 2, 3, 1, 'USD', 1, 1);
  `)
  return db
}
