import { describe, expect, it } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { isModelPricePresetId, MODEL_PRICE_PRESETS } from "../index"
import { createModelPriceRuleId } from "../rule-id"
import { initModelPriceSchema, ModelPriceService } from "../service"

function createDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  initModelPriceSchema(db)
  return db
}

function presetRule(presetId: string, modelPattern: string) {
  const preset = MODEL_PRICE_PRESETS.find((candidate) => candidate.id === presetId)
  const rule = preset?.rules.find((candidate) => candidate.modelPattern === modelPattern)
  expect(rule).toBeTruthy()
  return rule!
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

  it("preserves existing rules and migrates legacy rule ids when the init marker is missing", () => {
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
        id, model_pattern, input_per_1m, output_per_1m, enabled, source, sort_index, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("legacy-like-id", "qwen3.7-plus", 2, 12, 0, "user", 7, "2026-06-09T00:00:00.000Z")

    initModelPriceSchema(db)
    const service = new ModelPriceService(db)
    const [rule] = service.listRules()

    expect(rule).toMatchObject({
      modelPattern: "qwen3.7-plus",
      inputPer1M: 2,
      outputPer1M: 12,
      enabled: false,
      source: "user",
      sortIndex: 7,
    })
    expect(rule?.id).toMatch(/^mpr_[a-f0-9]{12}$/)
    expect(rule?.id).not.toContain("qwen")
    expect(rule?.id).not.toBe("legacy-like-id")
    expect(db.prepare("SELECT value FROM model_price_meta WHERE key = ?").get("initialized_from_defaults_v1")).toBeTruthy()
    db.close()
  })

  it("preserves existing hash-like rule ids during schema initialization", () => {
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
    `).run("mpr_123456789abc", "qwen3.7-plus", 2, 12, "2026-06-09T00:00:00.000Z")

    initModelPriceSchema(db)
    const service = new ModelPriceService(db)

    expect(service.listRules()).toEqual([
      expect.objectContaining({ id: "mpr_123456789abc", modelPattern: "qwen3.7-plus" }),
    ])
    db.close()
  })

  it("migrates legacy rule ids even when the initialization marker already exists", () => {
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
      CREATE TABLE model_price_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    db.prepare("INSERT INTO model_price_meta (key, value, updated_at) VALUES (?, ?, ?)")
      .run("initialized_from_defaults_v1", "1", "2026-06-09T00:00:00.000Z")
    db.prepare(`
      INSERT INTO model_price_rules (
        id, model_pattern, input_per_1m, output_per_1m, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run("qwen3.7-plus", "qwen3.7-plus", 2, 12, "2026-06-09T00:00:00.000Z")

    initModelPriceSchema(db)
    const [rule] = new ModelPriceService(db).listRules()

    expect(rule).toMatchObject({ modelPattern: "qwen3.7-plus", inputPer1M: 2, outputPer1M: 12 })
    expect(rule?.id).toMatch(/^mpr_[a-f0-9]{12}$/)
    expect(rule?.id).not.toBe("qwen3.7-plus")
    db.close()
  })

  it("keeps all rows when a migrated legacy id would collide with an existing hash id", () => {
    const db = new DatabaseSync(":memory:")
    const collidingId = createModelPriceRuleId("legacy:legacy-like-id", "qwen3.7-plus")
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
    const insert = db.prepare(`
      INSERT INTO model_price_rules (
        id, model_pattern, input_per_1m, output_per_1m, sort_index, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    insert.run(collidingId, "existing-model", 1, 2, 0, "2026-06-09T00:00:00.000Z")
    insert.run("legacy-like-id", "qwen3.7-plus", 3, 4, 1, "2026-06-09T00:00:00.000Z")

    initModelPriceSchema(db)
    const rules = new ModelPriceService(db).listRules()
    const ids = new Set(rules.map((rule) => rule.id))

    expect(rules).toHaveLength(2)
    expect([...ids].every((id) => /^mpr_[a-f0-9]{12}$/.test(id))).toBe(true)
    expect(ids.has(collidingId)).toBe(true)
    expect(ids.has("legacy-like-id")).toBe(false)
    expect(rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelPattern: "existing-model", inputPer1M: 1 }),
      expect.objectContaining({ modelPattern: "qwen3.7-plus", inputPer1M: 3 }),
    ]))
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

  it("lists preset summaries including deepseek official and aliyun bailian", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    const presets = service.listPresets()

    expect(presets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "deepseek-official", label: "DeepSeek 官方", ruleCount: expect.any(Number) }),
      expect.objectContaining({ id: "aliyun-bailian", label: "阿里云百炼", ruleCount: expect.any(Number) }),
    ]))
    expect(presets.find((preset) => preset.id === "deepseek-official")?.ruleCount).toBeGreaterThan(0)
    expect(presets.find((preset) => preset.id === "aliyun-bailian")?.ruleCount).toBeGreaterThan(0)
    db.close()
  })

  it("recognizes valid model price preset ids", () => {
    expect(isModelPricePresetId("deepseek-official")).toBe(true)
    expect(isModelPricePresetId("aliyun-bailian")).toBe(true)
    expect(isModelPricePresetId("missing-preset")).toBe(false)
    expect(isModelPricePresetId(123)).toBe(false)
  })

  it("keeps openai codex preset prices aligned with official API pricing", () => {
    const openai = MODEL_PRICE_PRESETS.find((preset) => preset.id === "openai")

    expect(openai?.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modelPattern: "gpt-5.3-codex",
        inputPer1M: 12.6,
        outputPer1M: 100.8,
        cacheReadPer1M: 1.26,
        reasoningPer1M: 100.8,
      }),
    ]))
  })

  it("imports deepseek official preset using official prices", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    const imported = service.importPreset("deepseek-official")
    const rule = imported.find((item) => item.modelPattern === "deepseek-v4-pro")

    expect(rule).toMatchObject({
      modelPattern: "deepseek-v4-pro",
      inputPer1M: 3,
      outputPer1M: 6,
      cacheReadPer1M: 0.025,
      reasoningPer1M: 6,
      source: "builtin",
    })
    expect(rule?.id).toMatch(/^mpr_[a-f0-9]{12}$/)
    expect(rule?.id).not.toContain("deepseek")
    db.close()
  })

  it("keeps anthropic preset prices aligned with current official Claude pricing converted to CNY", () => {
    expect(presetRule("anthropic", "claude-fable-5")).toMatchObject({
      inputPer1M: 67.75,
      outputPer1M: 338.75,
      cacheReadPer1M: 6.775,
      cacheWritePer1M: 84.6875,
      reasoningPer1M: 338.75,
    })
    expect(presetRule("anthropic", "claude-opus-4.8")).toMatchObject({
      inputPer1M: 33.875,
      outputPer1M: 169.375,
      cacheReadPer1M: 3.3875,
      cacheWritePer1M: 42.34375,
      reasoningPer1M: 169.375,
    })
    expect(presetRule("anthropic", "claude-opus-4-8")).toMatchObject({
      inputPer1M: 33.875,
      outputPer1M: 169.375,
    })
    expect(presetRule("anthropic", "claude-opus-4.5")).toMatchObject({
      inputPer1M: 33.875,
      outputPer1M: 169.375,
    })
    expect(presetRule("anthropic", "claude-sonnet-4-6")).toMatchObject({
      inputPer1M: 20.325,
      outputPer1M: 101.625,
      cacheReadPer1M: 2.0325,
      cacheWritePer1M: 25.40625,
      reasoningPer1M: 101.625,
    })
    expect(presetRule("anthropic", "claude-sonnet-4.5")).toMatchObject({
      inputPer1M: 20.325,
      outputPer1M: 101.625,
    })
    expect(presetRule("anthropic", "claude-haiku-4-5-20251001")).toMatchObject({
      inputPer1M: 6.775,
      outputPer1M: 33.875,
      cacheReadPer1M: 0.6775,
      cacheWritePer1M: 8.46875,
      reasoningPer1M: 33.875,
    })
  })

  it("imports anthropic preset with specific new Claude aliases matching before broader rules", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    service.importPreset("anthropic")

    expect(service.findRuleForModel("claude-opus-4-8")).toMatchObject({
      modelPattern: "claude-opus-4-8",
      inputPer1M: 33.875,
      outputPer1M: 169.375,
    })
    expect(service.findRuleForModel("claude-sonnet-4-6")).toMatchObject({
      modelPattern: "claude-sonnet-4-6",
      inputPer1M: 20.325,
    })
    expect(service.findRuleForModel("claude-haiku-4-5-20251001")).toMatchObject({
      modelPattern: "claude-haiku-4-5-20251001",
      inputPer1M: 6.775,
    })
    db.close()
  })

  it("keeps aliyun bailian preset model ids and cache prices aligned with text model pricing", () => {
    const bailian = MODEL_PRICE_PRESETS.find((preset) => preset.id === "aliyun-bailian")

    expect(bailian?.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modelPattern: "qwen-plus",
        inputPer1M: 4.8,
        outputPer1M: 48,
        cacheReadPer1M: 0.48,
        cacheWritePer1M: 6,
        reasoningPer1M: 64,
      }),
      expect.objectContaining({
        modelPattern: "qwen-turbo",
        inputPer1M: 0.3,
        outputPer1M: 0.6,
        cacheReadPer1M: 0.06,
        reasoningPer1M: 3,
      }),
      expect.objectContaining({
        modelPattern: "qwen-long",
        inputPer1M: 0.5,
        outputPer1M: 2,
      }),
      expect.objectContaining({
        modelPattern: "qwen3.7-max",
        inputPer1M: 12,
        outputPer1M: 36,
        cacheReadPer1M: 1.2,
        cacheWritePer1M: 15,
      }),
      expect.objectContaining({
        modelPattern: "qwen3-coder-plus",
        inputPer1M: 20,
        outputPer1M: 200,
        cacheReadPer1M: 2,
        cacheWritePer1M: 25,
      }),
      expect.objectContaining({
        modelPattern: "deepseek-v4-pro",
        inputPer1M: 12,
        outputPer1M: 24,
        cacheReadPer1M: 1,
      }),
      expect.objectContaining({
        modelPattern: "MiniMax/MiniMax-M3",
        inputPer1M: 4.2,
        outputPer1M: 16.8,
        cacheReadPer1M: 0.84,
      }),
      expect.objectContaining({
        modelPattern: "MiniMax-M2.5",
        inputPer1M: 2.1,
        outputPer1M: 8.4,
        cacheReadPer1M: 0.42,
      }),
      expect.objectContaining({
        modelPattern: "kimi-k2.6",
        inputPer1M: 6.5,
        outputPer1M: 27,
        cacheReadPer1M: 0.65,
        cacheWritePer1M: 8.125,
      }),
      expect.objectContaining({
        modelPattern: "kimi-k2-thinking",
        inputPer1M: 4,
        outputPer1M: 16,
        cacheReadPer1M: 0.8,
      }),
      expect.objectContaining({
        modelPattern: "Moonshot-Kimi-K2-Instruct",
        inputPer1M: 4,
        outputPer1M: 16,
        cacheReadPer1M: 0.8,
      }),
      expect.objectContaining({
        modelPattern: "kimi/kimi-k2.6",
        inputPer1M: 6.5,
        outputPer1M: 27,
        cacheReadPer1M: 1.1,
      }),
      expect.objectContaining({
        modelPattern: "glm-5.1",
        inputPer1M: 8,
        outputPer1M: 28,
        cacheReadPer1M: 0.8,
        cacheWritePer1M: 10,
      }),
      expect.objectContaining({
        modelPattern: "glm-5",
        inputPer1M: 6,
        outputPer1M: 22,
        cacheReadPer1M: 1.2,
      }),
      expect.objectContaining({
        modelPattern: "ZHIPU/GLM-5",
        inputPer1M: 6,
        outputPer1M: 22,
        cacheReadPer1M: 1.5,
      }),
      expect.objectContaining({
        modelPattern: "xiaomi/mimo-v2.5-pro",
        inputPer1M: 14,
        outputPer1M: 42,
        cacheReadPer1M: 2.8,
      }),
      expect.objectContaining({
        modelPattern: "stepfun/step-3.7-flash",
        inputPer1M: 1.35,
        outputPer1M: 8.1,
        cacheReadPer1M: 0.27,
      }),
    ]))
  })

  it("overwrites existing user rule when importing deepseek official preset", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    service.createRule({
      modelPattern: "deepseek-v4-pro",
      inputPer1M: 99,
      outputPer1M: 199,
      cacheReadPer1M: 9,
      reasoningPer1M: 299,
    })

    const imported = service.importPreset("deepseek-official")
    const rule = imported.find((item) => item.modelPattern === "deepseek-v4-pro")

    expect(rule).toMatchObject({
      inputPer1M: 3,
      outputPer1M: 6,
      cacheReadPer1M: 0.025,
      reasoningPer1M: 6,
      source: "builtin",
    })
    db.close()
  })

  it("keeps non-overlapping user rules and appends preset rules after import", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    const localRule = service.createRule({ modelPattern: "local-model", inputPer1M: 7 })
    const imported = service.importPreset("deepseek-official")
    const localIndex = imported.findIndex((item) => item.modelPattern === "local-model")
    const deepseekIndex = imported.findIndex((item) => item.modelPattern === "deepseek-v4-pro")

    expect(imported).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: localRule.id, modelPattern: "local-model", inputPer1M: 7, sortIndex: 0 }),
      expect.objectContaining({ modelPattern: "deepseek-v4-pro", source: "builtin" }),
    ]))
    expect(localIndex).toBeGreaterThanOrEqual(0)
    expect(deepseekIndex).toBeGreaterThan(localIndex)
    expect(imported[localIndex]?.sortIndex).toBe(0)
    expect(imported[deepseekIndex]?.sortIndex).toBeGreaterThan(imported[localIndex]?.sortIndex ?? -1)
    db.close()
  })

  it("deduplicates matched patterns when importing a preset", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    service.saveRules([
      { modelPattern: "DeepSeek-V4-Pro", inputPer1M: 91, outputPer1M: 191 },
      { modelPattern: "deepseek-v4-pro", inputPer1M: 92, outputPer1M: 192 },
      { modelPattern: "keep-duplicate", inputPer1M: 7 },
      { modelPattern: "KEEP-DUPLICATE", inputPer1M: 8 },
    ])

    const imported = service.importPreset("deepseek-official")
    const deepseekRules = imported.filter((item) => item.modelPattern.toLowerCase() === "deepseek-v4-pro")
    const untouchedDuplicates = imported.filter((item) => item.modelPattern.toLowerCase() === "keep-duplicate")

    expect(deepseekRules).toHaveLength(1)
    expect(deepseekRules[0]).toMatchObject({
      modelPattern: "deepseek-v4-pro",
      inputPer1M: 3,
      outputPer1M: 6,
      cacheReadPer1M: 0.025,
      source: "builtin",
      sortIndex: 0,
    })
    expect(untouchedDuplicates).toHaveLength(2)
    db.close()
  })

  it("lets later preset imports win for overlapping model patterns", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    service.importPreset("deepseek-official")
    const imported = service.importPreset("aliyun-bailian")
    const rule = imported.find((item) => item.modelPattern === "deepseek-v4-pro")

    expect(rule).toMatchObject({
      inputPer1M: 12,
      outputPer1M: 24,
      cacheReadPer1M: 1,
      cacheWritePer1M: 0,
      reasoningPer1M: 24,
      source: "builtin",
    })
    db.close()
  })

  it("throws on unknown preset and does not change existing rules", () => {
    const db = createDb()
    const service = new ModelPriceService(db)

    const existing = service.createRule({ modelPattern: "keep-me", inputPer1M: 7 })

    expect(() => service.importPreset("missing-preset" as never)).toThrow("Unknown model price preset: missing-preset")
    expect(service.listRules()).toEqual([expect.objectContaining({ id: existing.id, modelPattern: "keep-me", inputPer1M: 7 })])
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
