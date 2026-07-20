import { describe, expect, it, vi } from "vitest"
import { SKILL_ENV_MAX_VARIABLES } from "../../../../config"
import { secretsIpcModule } from "../ipc"

function createHarness(allow = true) {
  const service = {
    events: { on: vi.fn() },
    list: vi.fn(async () => ({ secrets: [], total: 0 })),
    get: vi.fn(async () => ({ id: "id-1", name: "TOKEN", hasValue: true, value: "revealed-value" })),
    create: vi.fn(async () => ({ id: "id-1", name: "TOKEN", hasValue: true })),
    update: vi.fn(async () => ({ id: "id-1", name: "TOKEN", hasValue: true })),
    upsert: vi.fn(async () => ({ secret: { id: "id-1", name: "TOKEN", hasValue: true }, created: true })),
    delete: vi.fn(async () => ({ id: "id-1", name: "TOKEN", hasValue: true })),
    scanSkillEnvBindings: vi.fn(async () => ({ scanSessionId: "scan-1", items: [] })),
    scanSkillEnvBindingsBatch: vi.fn(async ({ names }: { names: string[] }) => ({
      groups: names.map((name) => ({ name, scanResult: { scanSessionId: `scan-${name}`, items: [] } })),
    })),
    queueSkillEnvBindings: vi.fn(async () => ({ items: [] })),
  }
  const broadcast = vi.fn()
  const permissionGuard = {
    check: vi.fn(async () => allow
      ? { allowed: true as const }
      : { allowed: false as const, reason: "denied", policyId: "test-deny" }),
  }
  const auditSink = { record: vi.fn() }
  const ctx = {
    resolve: vi.fn((id: string) => {
      if (id === "core.secrets") return service
      if (id === "core.window-manager") return { broadcast }
      if (id === "core.permission-guard") return permissionGuard
      if (id === "core.audit-sink") return auditSink
      throw new Error(id)
    }),
  }
  return { auditSink, broadcast, ctx, permissionGuard, service }
}

describe("secretsIpcModule", () => {
  it("registers secrets channels", () => {
    expect(secretsIpcModule.id).toBe("secrets")
    expect(secretsIpcModule.methods.list.operationId).toBe("app.secrets.item.list")
    expect(secretsIpcModule.methods.get.operationId).toBe("app.secrets.item.get")
    expect(secretsIpcModule.methods.create.operationId).toBe("app.secrets.item.create")
    expect(secretsIpcModule.methods.update.operationId).toBe("app.secrets.item.update")
    expect(secretsIpcModule.methods.upsert.operationId).toBe("app.secrets.item.upsert")
    expect(secretsIpcModule.methods.delete.operationId).toBe("app.secrets.item.delete")
    expect(secretsIpcModule.methods.scanSkillEnvBindings.operationId).toBe("app.secrets.operation.scan_skill_env_bindings")
    expect(secretsIpcModule.methods.scanSkillEnvBindingsBatch.operationId).toBe("app.secrets.operation.scan_skill_env_bindings_batch")
    expect(secretsIpcModule.methods.queueSkillEnvBindings.operationId).toBe("app.secrets.operation.queue_skill_env_bindings")
    expect(secretsIpcModule.events.changed.operationId).toBe("app.secrets.item.changed")
  })

  it("rejects secret values from Skill env scan and apply requests", () => {
    expect(() => secretsIpcModule.methods.scanSkillEnvBindings.request.parse({
      name: "TOKEN",
      value: "must-not-cross-ipc",
    })).toThrow()
    expect(() => secretsIpcModule.methods.queueSkillEnvBindings.request.parse({
      name: "TOKEN",
      scanSessionId: "scan-1",
      itemIds: ["item-1"],
      value: "must-not-cross-ipc",
    })).toThrow()
    expect(() => secretsIpcModule.methods.scanSkillEnvBindingsBatch.request.parse({
      names: ["TOKEN"],
      values: ["must-not-cross-ipc"],
    })).toThrow()
  })

  it("rejects oversized Skill env batch scans before authorization", () => {
    expect(() => secretsIpcModule.methods.scanSkillEnvBindingsBatch.request.parse({
      names: Array.from({ length: SKILL_ENV_MAX_VARIABLES + 1 }, (_, index) => `TOKEN_${index}`),
    })).toThrow(`一次最多扫描 ${SKILL_ENV_MAX_VARIABLES} 个 Skill 环境变量。`)
  })

  it("preserves requested secret values when validating get responses", () => {
    expect(secretsIpcModule.methods.get.response.parse({
      id: "id-1",
      name: "TOKEN",
      hasValue: true,
      value: "secret",
    })).toEqual({
      id: "id-1",
      name: "TOKEN",
      hasValue: true,
      value: "secret",
    })
  })

  it("rejects empty secret updates at the IPC boundary", () => {
    expect(() => secretsIpcModule.methods.update.request.parse({
      name: "TOKEN",
    })).toThrow("必须提供 value 或 description")
  })

  it("dispatches methods through the core service", async () => {
    const { auditSink, ctx, permissionGuard, service } = createHarness()

    await expect(secretsIpcModule.methods.list.handler(ctx as never, undefined)).resolves.toEqual({ secrets: [], total: 0 })
    await expect(secretsIpcModule.methods.get.handler(ctx as never, {
      name: "TOKEN",
      includeValue: true,
    })).resolves.toMatchObject({ value: "revealed-value" })
    await secretsIpcModule.methods.create.handler(ctx as never, { name: "TOKEN", value: "created-value" })
    await secretsIpcModule.methods.update.handler(ctx as never, { name: "TOKEN", description: "api" })
    await secretsIpcModule.methods.upsert.handler(ctx as never, { name: "TOKEN", value: "upserted-value" })
    await secretsIpcModule.methods.delete.handler(ctx as never, { name: "TOKEN" })
    await secretsIpcModule.methods.scanSkillEnvBindings.handler(ctx as never, { name: "TOKEN" })
    await secretsIpcModule.methods.queueSkillEnvBindings.handler(ctx as never, {
      name: "TOKEN",
      scanSessionId: "scan-1",
      itemIds: ["item-1"],
    })

    expect(service.list).toHaveBeenCalled()
    expect(service.get).toHaveBeenCalledWith({ name: "TOKEN", includeValue: true })
    expect(service.create).toHaveBeenCalledWith({ name: "TOKEN", value: "created-value" })
    expect(service.update).toHaveBeenCalledWith({ name: "TOKEN", description: "api" })
    expect(service.upsert).toHaveBeenCalledWith({ name: "TOKEN", value: "upserted-value" })
    expect(service.delete).toHaveBeenCalledWith({ name: "TOKEN" })
    expect(permissionGuard.check.mock.calls.map(([request]) => request.action)).toEqual([
      "secret.read",
      "secret.read",
      "secret.write",
      "secret.write",
      "secret.write",
      "secret.write",
      "secret.read",
      "secret.write",
    ])
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      actor: { kind: "user", id: "secrets-app", display: "Secrets App" },
      context: expect.objectContaining({ includeValue: true }),
    }))
    expect(auditSink.record.mock.calls.every(([event]) => event.outcome === "allowed")).toBe(true)
    const auditJson = JSON.stringify(auditSink.record.mock.calls)
    expect(auditJson).not.toContain("revealed-value")
    expect(auditJson).not.toContain("created-value")
    expect(auditJson).not.toContain("upserted-value")
    expect(service.scanSkillEnvBindings).toHaveBeenCalledWith(
      { name: "TOKEN" },
      {
        actor: { kind: "user", id: "secrets-app", display: "Secrets App" },
        permissionGuard,
        auditSink,
      },
    )
    expect(service.queueSkillEnvBindings).toHaveBeenCalledWith(
      { name: "TOKEN", scanSessionId: "scan-1", itemIds: ["item-1"] },
      {
        actor: { kind: "user", id: "secrets-app", display: "Secrets App" },
        permissionGuard,
        auditSink,
      },
    )
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.read",
      resource: "secret:user:token",
      context: {
        source: "api",
        secretAction: "secrets.skill-env.scan",
        includeValue: true,
      },
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      resource: "secret:user:token",
      context: {
        source: "api",
        secretAction: "secrets.skill-env.queue",
        includeValue: true,
      },
    }))
    expect(service.events.on).toHaveBeenCalledWith("changed", expect.any(Function))
  })

  it("stops value reads before the service when permission is denied", async () => {
    const { auditSink, ctx, service } = createHarness(false)

    await expect(secretsIpcModule.methods.get.handler(ctx as never, {
      name: "TOKEN",
      includeValue: true,
    })).rejects.toThrow("denied")

    expect(service.get).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.read",
      outcome: "denied",
      resource: "secret:user:token",
    }))
  })

  it("stops Skill env scans before reading the secret when permission is denied", async () => {
    const { auditSink, ctx, service } = createHarness(false)

    await expect(secretsIpcModule.methods.scanSkillEnvBindings.handler(ctx as never, {
      name: "TOKEN",
    })).rejects.toThrow("denied")

    expect(service.scanSkillEnvBindings).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.read",
      outcome: "denied",
      resource: "secret:user:token",
      metadata: expect.objectContaining({
        secretAction: "secrets.skill-env.scan",
        includeValue: true,
      }),
    }))
  })

  it("authorizes every name before running one batch Skill env scan", async () => {
    const { auditSink, ctx, permissionGuard, service } = createHarness()

    await expect(secretsIpcModule.methods.scanSkillEnvBindingsBatch.handler(ctx as never, {
      names: ["TOKEN", "REGION"],
    })).resolves.toEqual({
      groups: [
        { name: "TOKEN", scanResult: { scanSessionId: "scan-TOKEN", items: [] } },
        { name: "REGION", scanResult: { scanSessionId: "scan-REGION", items: [] } },
      ],
    })

    expect(service.scanSkillEnvBindingsBatch).toHaveBeenCalledTimes(1)
    expect(permissionGuard.check).toHaveBeenCalledTimes(2)
    expect(auditSink.record).toHaveBeenCalledTimes(2)
    expect(permissionGuard.check.mock.calls.map(([request]) => request.resource)).toEqual([
      "secret:user:token",
      "secret:user:region",
    ])
  })

  it("stops Skill env queues before reading the secret when permission is denied", async () => {
    const { auditSink, ctx, service } = createHarness(false)

    await expect(secretsIpcModule.methods.queueSkillEnvBindings.handler(ctx as never, {
      name: "TOKEN",
      scanSessionId: "scan-1",
      itemIds: ["item-1"],
    })).rejects.toThrow("denied")

    expect(service.queueSkillEnvBindings).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      outcome: "denied",
      resource: "secret:user:token",
      metadata: expect.objectContaining({
        secretAction: "secrets.skill-env.queue",
        includeValue: true,
      }),
    }))
  })
})
