import { describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { initUsageAnalysisSchema } from "../../usage-analysis/db-schema"
import { localDateKey, localHourKey } from "../../usage-analysis/range"
import { ModelPriceService } from "../service"
import { MODEL_PRICE_COVERAGE_MAX_LIMIT } from "../types"

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  initUsageAnalysisSchema(db)
  return db
}

function isoTimestampForDay(dayOffset: number, hour = 1): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + dayOffset)
  if (dayOffset === 0) {
    const now = new Date()
    date.setHours(Math.min(hour, now.getHours()), 0, 0, 0)
  } else {
    date.setHours(hour, 0, 0, 0)
  }
  return date.toISOString()
}

function insertUsageEvent(db: DatabaseSync, prefix: "cc" | "cx", input: {
  id: string
  model: string
  inputTokens: number
  outputTokens?: number
  priceKnown?: boolean
  totalCost?: number
  timestamp?: string
}): void {
  const timestamp = input.timestamp ?? "2026-06-09T01:00:00.000Z"
  const timestampMs = new Date(timestamp).getTime()
  const date = localDateKey(timestampMs)
  const hour = localHourKey(timestampMs)
  const outputTokens = input.outputTokens ?? 0
  const tokens = input.inputTokens + outputTokens
  db.prepare(`
    INSERT INTO ${prefix}_usage_events (
      id, session_id, timestamp_ms, date, hour, model, input_tokens, output_tokens,
      priced_tokens, unpriced_tokens, total_cost, price_known, cost_currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    `${prefix}-session-${input.id}`,
    timestampMs,
    date,
    hour,
    input.model,
    input.inputTokens,
    outputTokens,
    input.priceKnown === true ? tokens : 0,
    input.priceKnown === true ? 0 : tokens,
    input.totalCost ?? 0,
    input.priceKnown === true ? 1 : 0,
    "CNY",
  )
}

describe("model price coverage", () => {
  it("merges used CC and Codex models and reports current rule matches", () => {
    const db = createDb()
    const service = new ModelPriceService(db)
    const [savedRule] = service.saveRules([{ id: "local", modelPattern: "local-model", inputPer1M: 1 }])
    insertUsageEvent(db, "cc", { id: "cc-1", model: "local-model", inputTokens: 100, priceKnown: true, totalCost: 0.001 })
    insertUsageEvent(db, "cx", { id: "cx-1", model: "local-model", inputTokens: 50, priceKnown: false })
    insertUsageEvent(db, "cx", { id: "cx-2", model: "other-model", inputTokens: 25, priceKnown: false })

    expect(service.listCoverage({ source: "all", range: "all" })).toEqual([
      expect.objectContaining({
        model: "local-model",
        sources: ["cc", "codex"],
        tokens: 150,
        requests: 2,
        pricedTokens: 100,
        unpricedTokens: 50,
        priceKnown: true,
        matchedRuleId: savedRule?.id,
        matchedRulePattern: "local-model",
      }),
      expect.objectContaining({
        model: "other-model",
        sources: ["codex"],
        tokens: 25,
        requests: 1,
        priceKnown: false,
      }),
    ])
    db.close()
  })

  it("filters coverage by source and range without refreshing usage logs", () => {
    const db = createDb()
    const service = new ModelPriceService(db)
    insertUsageEvent(db, "cc", { id: "old", model: "old-model", inputTokens: 1, timestamp: isoTimestampForDay(-30, 0) })
    insertUsageEvent(db, "cx", { id: "today", model: "today-model", inputTokens: 2, timestamp: isoTimestampForDay(0, 1) })

    expect(service.listCoverage({ source: "codex", range: "today" })).toEqual([
      expect.objectContaining({ model: "today-model", sources: ["codex"], tokens: 2 }),
    ])
    db.close()
  })

  it("caps oversized limits and aggregates all sources before limiting", () => {
    const db = createDb()
    const service = new ModelPriceService(db)
    insertUsageEvent(db, "cc", { id: "cc-combined", model: "combined-model", inputTokens: 80 })
    insertUsageEvent(db, "cx", { id: "cx-combined", model: "combined-model", inputTokens: 80 })
    insertUsageEvent(db, "cc", { id: "cc-only", model: "cc-only-model", inputTokens: 120 })
    insertUsageEvent(db, "cx", { id: "cx-only", model: "codex-only-model", inputTokens: 110 })

    expect(service.listCoverage({ source: "all", range: "all", limit: 2 })).toEqual([
      expect.objectContaining({ model: "combined-model", sources: ["cc", "codex"], tokens: 160 }),
      expect.objectContaining({ model: "cc-only-model", sources: ["cc"], tokens: 120 }),
    ])

    for (let index = 0; index < MODEL_PRICE_COVERAGE_MAX_LIMIT + 5; index += 1) {
      insertUsageEvent(db, "cc", {
        id: `bulk-${index}`,
        model: `bulk-model-${String(index).padStart(3, "0")}`,
        inputTokens: index + 1,
      })
    }

    const capped = service.listCoverage({ source: "cc", range: "all", limit: 10_000 })
    expect(capped).toHaveLength(MODEL_PRICE_COVERAGE_MAX_LIMIT)
    expect(capped[0]).toEqual(expect.objectContaining({
      model: `bulk-model-${String(MODEL_PRICE_COVERAGE_MAX_LIMIT + 4).padStart(3, "0")}`,
      tokens: MODEL_PRICE_COVERAGE_MAX_LIMIT + 5,
    }))
    expect(capped.at(-1)?.tokens).toBeGreaterThan(0)
    db.close()
  })
})
