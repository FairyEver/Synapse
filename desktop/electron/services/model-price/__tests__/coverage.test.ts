import { describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { initUsageAnalysisSchema } from "../../usage-analysis/db-schema"
import { ModelPriceService } from "../service"

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  initUsageAnalysisSchema(db)
  return db
}

function isoTimestampForDay(dayOffset: number, hour = 1): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hour, 0, 0, 0)
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
  const date = timestamp.slice(0, 10)
  const hour = `${date} ${timestamp.slice(11, 13)}`
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
})
