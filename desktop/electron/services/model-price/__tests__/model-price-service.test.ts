import { describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { initModelPriceSchema, ModelPriceService } from "../service"

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  initModelPriceSchema(db)
  return db
}

describe("model price service", () => {
  it("initializes model price tables without inserting default rules", () => {
    const db = new DatabaseSync(":memory:")
    initModelPriceSchema(db)
    const service = new ModelPriceService(db)

    expect(service.listRules()).toEqual([])
    expect(db.prepare("SELECT value FROM model_price_meta WHERE key = ?").get("initialized_from_defaults_v1")).toBeTruthy()
    db.close()
  })

  it("does not delete existing model_price_rules when the init marker is missing", () => {
    const db = new DatabaseSync(":memory:")
    db.exec(`
      CREATE TABLE model_price_rules (
        id TEXT PRIMARY KEY,
        model_pattern TEXT NOT NULL,
        input_per_1m REAL NOT NULL DEFAULT 0,
        output_per_1m REAL NOT NULL DEFAULT 0,
        cache_read_per_1m REAL NOT NULL DEFAULT 0,
        cache_write_per_1m REAL NOT NULL DEFAULT 0,
        reasoning_per_1m REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CNY',
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'user',
        sort_index INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `)
    db.prepare(`
      INSERT INTO model_price_rules (
        id, model_pattern, input_per_1m, output_per_1m, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run("legacy-like-id", "qwen3.7-plus", 2, 12, "2026-06-09T00:00:00.000Z")

    initModelPriceSchema(db)
    const service = new ModelPriceService(db)

    expect(service.listRules()).toEqual([
      expect.objectContaining({ id: "legacy-like-id", modelPattern: "qwen3.7-plus", inputPer1M: 2, outputPer1M: 12 }),
    ])
    expect(db.prepare("SELECT value FROM model_price_meta WHERE key = ?").get("initialized_from_defaults_v1")).toBeTruthy()
    db.close()
  })

  it("does not read or migrate legacy usage_model_prices rows", () => {
    const db = new DatabaseSync(":memory:")
    db.exec(`
      CREATE TABLE usage_model_prices (
        id TEXT PRIMARY KEY,
        model_pattern TEXT NOT NULL,
        input_per_1m REAL NOT NULL DEFAULT 0,
        output_per_1m REAL NOT NULL DEFAULT 0,
        cache_read_per_1m REAL NOT NULL DEFAULT 0,
        cache_write_per_1m REAL NOT NULL DEFAULT 0,
        reasoning_per_1m REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'CNY',
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'user',
        sort_index INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT ''
      )
    `)
    db.prepare(`
      INSERT INTO usage_model_prices (
        id, model_pattern, input_per_1m, output_per_1m, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run("legacy-custom", "legacy-only-model", 999, 999, "2026-06-09T00:00:00.000Z")

    initModelPriceSchema(db)
    const service = new ModelPriceService(db)

    expect(service.listRules().some((rule) => rule.modelPattern === "legacy-only-model")).toBe(false)
    expect(service.findRuleForModel("legacy-only-model")).toBeNull()
    db.close()
  })

  it("matches wildcard and substring rules and estimates CNY cost", () => {
    const db = createDb()
    const service = new ModelPriceService(db)
    service.saveRules([
      { modelPattern: "local-*", inputPer1M: 10, outputPer1M: 20, cacheReadPer1M: 1, cacheWritePer1M: 2, reasoningPer1M: 30 },
      { modelPattern: "substring-model", inputPer1M: 4, outputPer1M: 8, reasoningPer1M: 8 },
    ])

    expect(service.findRuleForModel("local-alpha")).toMatchObject({ modelPattern: "local-*" })
    expect(service.findRuleForModel("vendor-substring-model-v2")).toMatchObject({ modelPattern: "substring-model" })
    expect(service.estimateUsageCost("local-alpha", {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 1_000_000,
      reasoning: 1_000_000,
    })).toMatchObject({
      input: 10,
      output: 20,
      cacheRead: 1,
      cacheWrite: 2,
      reasoning: 30,
      total: 63,
      priceKnown: true,
      currency: "CNY",
    })
    db.close()
  })

  it("generates hash-like internal ids for new rules", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    const created = service.createRule({ modelPattern: "qwen3.7-plus", inputPer1M: 2 })

    expect(created.id).toMatch(/^mpr_[a-f0-9]{12}$/)
    expect(created.id).not.toContain("qwen")
    expect(created.modelPattern).toBe("qwen3.7-plus")
    db.close()
  })

  it("preserves existing hash-like ids during manual saves", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    const saved = service.saveRules([{ id: "mpr_123456789abc", modelPattern: "local-model", inputPer1M: 1 }])

    expect(saved[0]?.id).toBe("mpr_123456789abc")
    db.close()
  })

  it("creates updates disables enables deletes and clears rules in model_price_rules", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    const created = service.createRule({ modelPattern: "local-model", inputPer1M: 14.4 })
    expect(created).toMatchObject({ modelPattern: "local-model", inputPer1M: 14.4, outputPer1M: 0, enabled: true })

    const updated = service.updateRule(created.id, { outputPer1M: 57.6 })
    expect(updated).toMatchObject({ id: created.id, inputPer1M: 14.4, outputPer1M: 57.6 })

    expect(service.setRuleEnabled(created.id, false)).toMatchObject({ id: created.id, enabled: false })
    expect(service.setRuleEnabled(created.id, true)).toMatchObject({ id: created.id, enabled: true })
    expect(service.deleteRule(created.id)).toEqual({ deleted: true, ruleId: created.id })
    expect(service.listRules().some((rule) => rule.id === created.id)).toBe(false)

    service.createRule({ modelPattern: "custom-only", inputPer1M: 1 })
    expect(service.clearRules()).toEqual([])
    expect(service.listRules()).toEqual([])
    db.close()
  })
})
