import { describe, expect, it, vi } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { initModelPriceSchema } from "../../services/model-price"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createModelPriceCapabilityDispatcher } from "../model-price-dispatcher"
import { mcpClientActorForSource } from "../../../synapse-capabilities/shared/types"
import { MODEL_PRICE_MCP_TOOL_ACTIONS, buildModelPriceTools } from "../../../synapse-capabilities/shared/model-price-domain"

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:")
  initModelPriceSchema(db)
  return db
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

    await dispatcher.dispatch("app.model_price.preset.list", {}, { source: "mcp-http" })
    await dispatcher.dispatch("app.model_price.rule.list", {}, { source: "mcp-http" })
    await dispatcher.dispatch("app.model_price.rule.get", { ruleId }, { source: "mcp-http" })

    expect(permissionGuard.check).toHaveBeenCalledTimes(3)
    expect(auditEvents.filter((event) => event.outcome === "allowed")).toHaveLength(3)
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
