import { describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { initUsageAnalysisSchema } from "../../services/usage-analysis/db-schema"
import { createModelPriceCapabilityDispatcher } from "../model-price-dispatcher"

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  initUsageAnalysisSchema(db)
  return db
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
  const timestamp = input.timestamp ?? "2026-05-19T01:00:00.000Z"
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

describe("model price capability dispatcher", () => {
  it("creates partially updates disables enables and deletes price rules by ruleId", async () => {
    const db = createTestDb()
    const dispatcher = createModelPriceCapabilityDispatcher({ db })

    const created = await dispatcher.dispatch("model_price.rule.create", {
      modelPattern: "local-model",
      inputPer1M: 14.4,
    }, { source: "api" })
    expect(created.ok).toBe(true)
    expect(created.data).toMatchObject({
      modelPattern: "local-model",
      inputPer1M: 14.4,
      outputPer1M: 0,
      enabled: true,
      currency: "CNY",
    })
    const ruleId = (created.data as { id: string }).id

    const updated = await dispatcher.dispatch("model_price.rule.update", {
      ruleId,
      outputPer1M: 57.6,
    }, { source: "mcp-http" })
    expect(updated.data).toMatchObject({
      id: ruleId,
      inputPer1M: 14.4,
      outputPer1M: 57.6,
    })

    await expect(dispatcher.dispatch("model_price.rule.disable", { ruleId }, { source: "api" }))
      .resolves.toMatchObject({ data: { id: ruleId, enabled: false } })
    await expect(dispatcher.dispatch("model_price.rule.enable", { ruleId }, { source: "api" }))
      .resolves.toMatchObject({ data: { id: ruleId, enabled: true } })
    await expect(dispatcher.dispatch("model_price.rule.delete", { ruleId }, { source: "api" }))
      .resolves.toEqual({ ok: true, data: { deleted: true, ruleId } })

    const rules = await dispatcher.dispatch("model_price.rule.list", {}, { source: "api" })
    expect((rules.data as Array<{ id: string }>).some((rule) => rule.id === ruleId)).toBe(false)
    db.close()
  })

  it("rejects invalid model price params clearly", async () => {
    const db = createTestDb()
    const dispatcher = createModelPriceCapabilityDispatcher({ db })

    await expect(dispatcher.dispatch("model_price.rule.create", { modelPattern: "" }, { source: "api" }))
      .rejects.toThrow(/modelPattern/)
    await expect(dispatcher.dispatch("model_price.rule.create", { modelPattern: "x", inputPer1M: -1 }, { source: "api" }))
      .rejects.toThrow(/inputPer1M/)
    await expect(dispatcher.dispatch("model_price.rule.update", { ruleId: "missing", outputPer1M: 1 }, { source: "api" }))
      .rejects.toThrow(/Model price rule not found/)
    db.close()
  })

  it("lists used models merged across CC and Codex with current enabled rule matching", async () => {
    const db = createTestDb()
    insertUsageEvent(db, "cc", { id: "cc-1", model: "local-model", inputTokens: 100 })
    insertUsageEvent(db, "cx", { id: "cx-1", model: "local-model", inputTokens: 50 })
    insertUsageEvent(db, "cx", { id: "cx-2", model: "other-model", inputTokens: 25 })
    const dispatcher = createModelPriceCapabilityDispatcher({ db })
    const created = await dispatcher.dispatch("model_price.rule.create", {
      modelPattern: "local-model",
      inputPer1M: 1,
    }, { source: "api" })
    const ruleId = (created.data as { id: string }).id

    const all = await dispatcher.dispatch("model_price.used_model.list", {}, { source: "api" })
    expect(all.data).toEqual([
      expect.objectContaining({
        model: "local-model",
        sources: ["cc", "codex"],
        tokens: 150,
        requests: 2,
        priceKnown: true,
        matchedRuleId: ruleId,
        matchedRulePattern: "local-model",
      }),
      expect.objectContaining({
        model: "other-model",
        sources: ["codex"],
        tokens: 25,
        priceKnown: false,
      }),
    ])

    const ccOnly = await dispatcher.dispatch("model_price.used_model.list", { source: "cc" }, { source: "api" })
    expect(ccOnly.data).toEqual([
      expect.objectContaining({ model: "local-model", sources: ["cc"], tokens: 100 }),
    ])

    await dispatcher.dispatch("model_price.rule.disable", { ruleId }, { source: "api" })
    const afterDisable = await dispatcher.dispatch("model_price.used_model.list", { source: "cc" }, { source: "api" })
    expect(afterDisable.data).toEqual([
      expect.objectContaining({ model: "local-model", priceKnown: false }),
    ])
    db.close()
  })

  it("does not change historical usage event costs when rules change", async () => {
    const db = createTestDb()
    insertUsageEvent(db, "cc", {
      id: "cc-priced",
      model: "priced-model",
      inputTokens: 1_000_000,
      priceKnown: true,
      totalCost: 12,
    })
    const dispatcher = createModelPriceCapabilityDispatcher({ db })

    const created = await dispatcher.dispatch("model_price.rule.create", {
      modelPattern: "priced-model",
      inputPer1M: 99,
    }, { source: "api" })
    await dispatcher.dispatch("model_price.rule.update", {
      ruleId: (created.data as { id: string }).id,
      inputPer1M: 111,
    }, { source: "api" })

    expect(db.prepare("SELECT total_cost, price_known FROM cc_usage_events WHERE id = ?").get("cc-priced")).toEqual({
      total_cost: 12,
      price_known: 1,
    })
    db.close()
  })
})
