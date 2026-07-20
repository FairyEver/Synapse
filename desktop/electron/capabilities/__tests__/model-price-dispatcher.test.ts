import { describe, expect, it, vi } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { initUsageAnalysisSchema } from "../../services/usage-analysis/db-schema"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createModelPriceCapabilityDispatcher } from "../model-price-dispatcher"
import { mcpClientActorForSource } from "../../../synapse-capabilities/shared/types"
import { MODEL_PRICE_MCP_TOOL_ACTIONS, buildModelPriceTools } from "../../../synapse-capabilities/shared/model-price-domain"

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
  it("exposes preset import and clear tools through model price MCP actions", () => {
    const toolNames = buildModelPriceTools().map((tool) => tool.name)

    expect(toolNames).toEqual(expect.arrayContaining([
      "app_model_price_preset_list",
      "app_model_price_preset_import",
      "app_model_price_rule_clear",
    ]))
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.app_model_price_preset_list).toBe("app.model_price.preset.list")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.app_model_price_preset_import).toBe("app.model_price.preset.import")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS.app_model_price_rule_clear).toBe("app.model_price.rule.clear")
    expect(MODEL_PRICE_MCP_TOOL_ACTIONS).not.toHaveProperty("model_price_preset_list")
  })

  it("checks permission and audits model price read actions", async () => {
    const db = createTestDb()
    const { auditEvents, auditSink, permissionGuard } = createSecurityHarness()
    insertUsageEvent(db, "cc", { id: "cc-1", model: "local-model", inputTokens: 100 })
    const dispatcher = createModelPriceCapabilityDispatcher({
      db,
      permissionGuard,
      auditSink,
    })
    const created = await dispatcher.dispatch("app.model_price.rule.create", {
      modelPattern: "local-model",
      inputPer1M: 1,
    }, { source: "api" })
    vi.mocked(permissionGuard.check).mockClear()
    auditEvents.length = 0
    const ruleId = (created.data as { id: string }).id

    await dispatcher.dispatch("app.model_price.used_model.list", {}, { source: "mcp-http", actor: mcpClientActorForSource("mcp-http") })
    await dispatcher.dispatch("app.model_price.preset.list", {}, { source: "mcp-http" })
    await dispatcher.dispatch("app.model_price.rule.list", {}, { source: "mcp-http" })
    await dispatcher.dispatch("app.model_price.rule.get", { ruleId }, { source: "mcp-http" })

    expect(permissionGuard.check).toHaveBeenCalledTimes(4)
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.read",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "model-price:used-models",
      context: expect.objectContaining({
        source: "mcp-http",
        modelPriceAction: "app.model_price.used_model.list",
      }),
    }))
    expect(auditEvents.filter((event) => event.outcome === "allowed")).toHaveLength(4)
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "database.read",
      outcome: "allowed",
      resource: "model-price:used-models",
    }))
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "database.read",
      outcome: "allowed",
      resource: "model-price-presets",
    }))
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "database.read",
      outcome: "allowed",
      resource: "model-price-rules",
    }))
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "database.read",
      outcome: "allowed",
      resource: `model-price-rule:${ruleId}`,
      metadata: expect.objectContaining({ ruleId }),
    }))
    db.close()
  })

  it("checks permission and audits mutating price rule actions", async () => {
    const db = createTestDb()
    const { auditEvents, auditSink, permissionGuard } = createSecurityHarness()
    const dispatcher = createModelPriceCapabilityDispatcher({
      db,
      permissionGuard,
      auditSink,
    })

    const created = await dispatcher.dispatch("app.model_price.rule.create", {
      modelPattern: "secure-model",
      inputPer1M: 1,
    }, { source: "mcp-http", actor: mcpClientActorForSource("mcp-http") })
    const ruleId = (created.data as { id: string }).id

    await dispatcher.dispatch("app.model_price.rule.update", { ruleId, outputPer1M: 2 }, { source: "mcp-http" })
    await dispatcher.dispatch("app.model_price.rule.disable", { ruleId }, { source: "mcp-http" })
    await dispatcher.dispatch("app.model_price.rule.enable", { ruleId }, { source: "mcp-http" })
    await dispatcher.dispatch("app.model_price.rule.delete", { ruleId }, { source: "mcp-http" })

    expect(permissionGuard.check).toHaveBeenCalledTimes(5)
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.mutate",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "model-price-rule:app.model_price.rule.create",
      context: expect.objectContaining({
        source: "mcp-http",
        modelPriceAction: "app.model_price.rule.create",
      }),
    }))
    expect(auditEvents.filter((event) => event.outcome === "allowed")).toHaveLength(5)
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "database.mutate",
      outcome: "allowed",
      resource: "model-price-rule:app.model_price.rule.create",
    }))
    db.close()
  })

  it("checks permission and audits preset import and full clear mutations", async () => {
    const db = createTestDb()
    const { auditEvents, auditSink, permissionGuard } = createSecurityHarness()
    const dispatcher = createModelPriceCapabilityDispatcher({
      db,
      permissionGuard,
      auditSink,
    })

    const presets = await dispatcher.dispatch("app.model_price.preset.list", {}, { source: "api" })
    expect(presets.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "deepseek-official", ruleCount: expect.any(Number) }),
    ]))

    const imported = await dispatcher.dispatch("app.model_price.preset.import", {
      presetId: "deepseek-official",
    }, { source: "mcp-http", actor: mcpClientActorForSource("mcp-http") })
    expect(imported.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelPattern: "deepseek-v4-pro", source: "builtin" }),
    ]))

    const cleared = await dispatcher.dispatch("app.model_price.rule.clear", {}, { source: "mcp-http" })
    expect(cleared).toEqual({ ok: true, data: [] })
    await expect(dispatcher.dispatch("app.model_price.rule.list", {}, { source: "api" }))
      .resolves.toEqual({ ok: true, data: [] })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.mutate",
      resource: "model-price-preset:deepseek-official",
      context: expect.objectContaining({
        modelPriceAction: "app.model_price.preset.import",
        presetId: "deepseek-official",
      }),
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.mutate",
      resource: "model-price-rules",
      context: expect.objectContaining({
        modelPriceAction: "app.model_price.rule.clear",
      }),
    }))
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "database.mutate",
      outcome: "allowed",
      resource: "model-price-preset:deepseek-official",
    }))
    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "database.mutate",
      outcome: "allowed",
      resource: "model-price-rules",
    }))
    db.close()
  })

  it("blocks price rule mutations when permission is denied", async () => {
    const db = createTestDb()
    const { auditEvents, auditSink, permissionGuard } = createSecurityHarness()
    vi.mocked(permissionGuard.check).mockResolvedValueOnce({
      allowed: false,
      reason: "denied by policy",
      policyId: "test-policy",
    })
    const dispatcher = createModelPriceCapabilityDispatcher({
      db,
      permissionGuard,
      auditSink,
    })

    await expect(dispatcher.dispatch("app.model_price.rule.create", {
      modelPattern: "blocked-model",
    }, { source: "api" })).rejects.toThrow("denied by policy")

    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "database.mutate",
      outcome: "denied",
      resource: "model-price-rule:app.model_price.rule.create",
      metadata: expect.objectContaining({
        reason: "denied by policy",
        policyId: "test-policy",
      }),
    }))
    const rules = await dispatcher.dispatch("app.model_price.rule.list", {}, { source: "api" })
    expect((rules.data as Array<{ modelPattern: string }>).some((rule) => rule.modelPattern === "blocked-model"))
      .toBe(false)
    db.close()
  })

  it("sanitizes ruleId before permission checks and denied audits", async () => {
    const db = createTestDb()
    const { auditEvents, auditSink, permissionGuard } = createSecurityHarness()
    vi.mocked(permissionGuard.check).mockResolvedValueOnce({
      allowed: false,
      reason: "denied by policy",
      policyId: "test-policy",
    })
    const dispatcher = createModelPriceCapabilityDispatcher({
      db,
      permissionGuard,
      auditSink,
    })

    await expect(dispatcher.dispatch("app.model_price.rule.update", {
      ruleId: "missing-token=secret-value",
      outputPer1M: 2,
    }, { source: "mcp-http" })).rejects.toThrow("denied by policy")

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      resource: "model-price-rule:missing-token=[redacted]",
      context: expect.objectContaining({
        ruleId: "missing-token=[redacted]",
      }),
    }))
    expect(JSON.stringify(auditEvents)).not.toContain("secret-value")
    expect(auditEvents).toContainEqual(expect.objectContaining({
      outcome: "denied",
      resource: "model-price-rule:missing-token=[redacted]",
      metadata: expect.objectContaining({
        ruleId: "missing-token=[redacted]",
      }),
    }))
    db.close()
  })

  it("audits failed model price permission checks without raw error text", async () => {
    const db = createTestDb()
    const { auditEvents, auditSink, permissionGuard } = createSecurityHarness()
    vi.mocked(permissionGuard.check).mockRejectedValueOnce(
      new Error("policy backend failed token=secret at /Users/example/config.json"),
    )
    const dispatcher = createModelPriceCapabilityDispatcher({
      db,
      permissionGuard,
      auditSink,
    })

    await expect(dispatcher.dispatch("app.model_price.rule.create", {
      modelPattern: "secure-model",
      inputPer1M: 1,
    }, { source: "api" })).rejects.toThrow("policy backend failed")

    expect(auditEvents).toContainEqual(expect.objectContaining({
      action: "database.mutate",
      outcome: "failed",
      resource: "model-price-rule:app.model_price.rule.create",
      metadata: expect.objectContaining({
        modelPriceAction: "app.model_price.rule.create",
        reason: "permission-check-error",
        errorName: "Error",
      }),
    }))
    expect(JSON.stringify(auditEvents)).not.toContain("token=secret")
    expect(JSON.stringify(auditEvents)).not.toContain("/Users/example")
    db.close()
  })

  it("sanitizes ruleId in failed mutation audits", async () => {
    const db = createTestDb()
    const { auditEvents, auditSink, permissionGuard } = createSecurityHarness()
    const dispatcher = createModelPriceCapabilityDispatcher({
      db,
      permissionGuard,
      auditSink,
    })

    await expect(dispatcher.dispatch("app.model_price.rule.update", {
      ruleId: "missing-token=secret-value",
      outputPer1M: 2,
    }, { source: "mcp-http" })).rejects.toThrow(/Model price rule not found/)

    expect(JSON.stringify(auditEvents)).not.toContain("secret-value")
    expect(auditEvents).toContainEqual(expect.objectContaining({
      outcome: "failed",
      resource: "model-price-rule:missing-token=[redacted]",
      metadata: expect.objectContaining({
        ruleId: "missing-token=[redacted]",
      }),
    }))
    db.close()
  })

  it("logs model price dispatch success and failures with sanitized error details", async () => {
    const db = createTestDb()
    const logger = createLoggerHarness()
    const dispatcher = createModelPriceCapabilityDispatcher({ db, logger })

    await dispatcher.dispatch("app.model_price.rule.create", {
      modelPattern: "logged-model",
      inputPer1M: 1,
    }, { source: "mcp-http" })

    expect(logger.info).toHaveBeenCalledWith("model price mcp dispatch", expect.objectContaining({
      action: "app.model_price.rule.create",
      source: "mcp-http",
      hasModelPattern: true,
    }))
    expect(logger.info).toHaveBeenCalledWith("model price mcp dispatch succeeded", expect.objectContaining({
      action: "app.model_price.rule.create",
      source: "mcp-http",
      hasModelPattern: true,
    }))

    await expect(dispatcher.dispatch("app.model_price.rule.update", {
      ruleId: "missing-token=secret-value",
      outputPer1M: 2,
    }, { source: "mcp-http" })).rejects.toThrow(/Model price rule not found/)

    expect(logger.warn).toHaveBeenCalledWith("model price mcp dispatch failed", expect.objectContaining({
      action: "app.model_price.rule.update",
      source: "mcp-http",
      ruleId: "missing-token=[redacted]",
      errorName: "Error",
      errorMessage: "Model price rule not found: missing-token=[redacted]",
    }))
    db.close()
  })

  it("creates partially updates disables enables and deletes price rules by ruleId", async () => {
    const db = createTestDb()
    const dispatcher = createModelPriceCapabilityDispatcher({ db })

    const created = await dispatcher.dispatch("app.model_price.rule.create", {
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

    const updated = await dispatcher.dispatch("app.model_price.rule.update", {
      ruleId,
      outputPer1M: 57.6,
    }, { source: "mcp-http" })
    expect(updated.data).toMatchObject({
      id: ruleId,
      inputPer1M: 14.4,
      outputPer1M: 57.6,
    })

    await expect(dispatcher.dispatch("app.model_price.rule.disable", { ruleId }, { source: "api" }))
      .resolves.toMatchObject({ data: { id: ruleId, enabled: false } })
    await expect(dispatcher.dispatch("app.model_price.rule.enable", { ruleId }, { source: "api" }))
      .resolves.toMatchObject({ data: { id: ruleId, enabled: true } })
    await expect(dispatcher.dispatch("app.model_price.rule.delete", { ruleId }, { source: "api" }))
      .resolves.toEqual({ ok: true, data: { deleted: true, ruleId } })

    const rules = await dispatcher.dispatch("app.model_price.rule.list", {}, { source: "api" })
    expect((rules.data as Array<{ id: string }>).some((rule) => rule.id === ruleId)).toBe(false)
    db.close()
  })

  it("rejects invalid model price params clearly", async () => {
    const db = createTestDb()
    const dispatcher = createModelPriceCapabilityDispatcher({ db })

    await expect(dispatcher.dispatch("app.model_price.rule.create", { modelPattern: "" }, { source: "api" }))
      .rejects.toThrow(/modelPattern/)
    await expect(dispatcher.dispatch("app.model_price.rule.create", { modelPattern: "x", inputPer1M: -1 }, { source: "api" }))
      .rejects.toThrow(/inputPer1M/)
    await expect(dispatcher.dispatch("app.model_price.rule.update", { ruleId: "missing", outputPer1M: 1 }, { source: "api" }))
      .rejects.toThrow(/Model price rule not found/)
    db.close()
  })

  it("lists used models merged across CC and Codex with current enabled rule matching", async () => {
    const db = createTestDb()
    insertUsageEvent(db, "cc", { id: "cc-1", model: "local-model", inputTokens: 100 })
    insertUsageEvent(db, "cx", { id: "cx-1", model: "local-model", inputTokens: 50 })
    insertUsageEvent(db, "cx", { id: "cx-2", model: "other-model", inputTokens: 25 })
    const dispatcher = createModelPriceCapabilityDispatcher({ db })
    const created = await dispatcher.dispatch("app.model_price.rule.create", {
      modelPattern: "local-model",
      inputPer1M: 1,
    }, { source: "api" })
    const ruleId = (created.data as { id: string }).id

    const all = await dispatcher.dispatch("app.model_price.used_model.list", {}, { source: "api" })
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

    const ccOnly = await dispatcher.dispatch("app.model_price.used_model.list", { source: "cc" }, { source: "api" })
    expect(ccOnly.data).toEqual([
      expect.objectContaining({ model: "local-model", sources: ["cc"], tokens: 100 }),
    ])

    await dispatcher.dispatch("app.model_price.rule.disable", { ruleId }, { source: "api" })
    const afterDisable = await dispatcher.dispatch("app.model_price.used_model.list", { source: "cc" }, { source: "api" })
    expect(afterDisable.data).toEqual([
      expect.objectContaining({ model: "local-model", priceKnown: false }),
    ])
    db.close()
  })

  it("caps oversized used-model list limits before dispatching coverage", async () => {
    const db = createTestDb()
    for (let index = 0; index < 505; index += 1) {
      insertUsageEvent(db, "cc", {
        id: `cc-${index}`,
        model: `model-${String(index).padStart(3, "0")}`,
        inputTokens: index + 1,
      })
    }
    const dispatcher = createModelPriceCapabilityDispatcher({ db })

    const result = await dispatcher.dispatch("app.model_price.used_model.list", {
      source: "cc",
      range: "all",
      limit: 10_000,
    }, { source: "api" })

    expect(result.ok).toBe(true)
    expect(result.data).toHaveLength(500)
    expect(result.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "model-504", tokens: 505 }),
    ]))
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

    const created = await dispatcher.dispatch("app.model_price.rule.create", {
      modelPattern: "priced-model",
      inputPer1M: 99,
    }, { source: "api" })
    await dispatcher.dispatch("app.model_price.rule.update", {
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

function createSecurityHarness() {
  const auditEvents: Parameters<AuditSink["record"]>[0][] = []
  const permissionGuard: PermissionGuard = {
    registerPolicy: vi.fn(),
    check: vi.fn(async () => ({ allowed: true as const })),
  }
  const auditSink: AuditSink = {
    record: (event) => {
      auditEvents.push(event)
    },
    list: () => [],
    clearForTests: () => undefined,
  }

  return { auditEvents, auditSink, permissionGuard }
}

function createLoggerHarness() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}
