import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type {
  SecretItemEntryV1,
  SecretSettingsEntryV1,
} from "../../../../electron/runtime/data-repo/schemas/secrets"
import { createDefaultConfig } from "../../../../src/lib/config"
import type { SynapseConfig, SynapseConfigPatch } from "../../../../src/types/config"
import { secretUpdateInputSchema } from "../../shared/schema"
import { createSecretsService } from "../service"

describe("SecretsService", () => {
  it("keeps Skill env values inside the service during scan and queue update", async () => {
    const harness = createHarness()
    const service = createSecretsService(harness.deps)
    await service.create({ name: "TOKEN", value: "private-value" })
    const security = { actor: { kind: "user" as const }, permissionGuard: {} as never, auditSink: {} as never }

    await service.scanSkillEnvBindings({ name: "TOKEN" }, security)
    await service.scanSkillEnvBindingsBatch({ names: ["TOKEN"] }, security)
    await service.queueSkillEnvBindings({
      name: "TOKEN",
      scanSessionId: "scan-1",
      itemIds: ["item-1"],
    }, security)

    expect(harness.skillEnvBindings.scan).toHaveBeenCalledWith("TOKEN", "private-value", security)
    expect(harness.skillEnvBindings.scanMany).toHaveBeenCalledWith([
      { name: "TOKEN", value: "private-value" },
    ], security)
    expect(harness.skillEnvBindings.enqueue).toHaveBeenCalledWith({
      name: "TOKEN",
      scanSessionId: "scan-1",
      itemIds: ["item-1"],
    }, expect.any(Function), security)
    const resolveValue = harness.skillEnvBindings.enqueue.mock.calls[0]?.[1]
    await expect(resolveValue?.()).resolves.toBe("private-value")

    await expect(service.scanSkillEnvBindings({ name: "token" }, security))
      .rejects.toThrow("大小写完全一致：token")
    await expect(service.queueSkillEnvBindings({
      name: "token",
      scanSessionId: "scan-1",
      itemIds: ["item-1"],
    }, security)).rejects.toThrow("大小写完全一致：token")
  })

  it("resolves the latest secret value when a queued update starts", async () => {
    const harness = createHarness()
    let releaseQueue: (() => void) | undefined
    const queueBlocked = new Promise<void>((resolve) => {
      releaseQueue = resolve
    })
    let resolvedValue = ""
    harness.skillEnvBindings.enqueue.mockImplementationOnce(async (_input, resolveValue) => {
      await queueBlocked
      resolvedValue = await resolveValue()
      return { items: [] }
    })
    const service = createSecretsService(harness.deps)
    await service.create({ name: "TOKEN", value: "old-value" })

    const queued = service.queueSkillEnvBindings({
      name: "TOKEN",
      scanSessionId: "scan-1",
      itemIds: ["item-1"],
    }, { actor: { kind: "user" }, permissionGuard: {} as never, auditSink: {} as never })
    await service.update({ name: "TOKEN", value: "latest-value" })
    releaseQueue?.()

    await expect(queued).resolves.toEqual({ items: [] })
    expect(resolvedValue).toBe("latest-value")
  })

  it("fails a queued update if the secret is deleted and recreated before execution", async () => {
    const harness = createHarness()
    let releaseQueue: (() => void) | undefined
    const queueBlocked = new Promise<void>((resolve) => {
      releaseQueue = resolve
    })
    harness.skillEnvBindings.enqueue.mockImplementationOnce(async (_input, resolveValue) => {
      await queueBlocked
      await resolveValue()
      return { items: [] }
    })
    const service = createSecretsService(harness.deps)
    await service.create({ name: "TOKEN", value: "old-value" })

    const queued = service.queueSkillEnvBindings({
      name: "TOKEN",
      scanSessionId: "scan-1",
      itemIds: ["item-1"],
    }, { actor: { kind: "user" }, permissionGuard: {} as never, auditSink: {} as never })
    await service.delete({ name: "TOKEN" })
    await service.create({ name: "TOKEN", value: "replacement-value" })
    releaseQueue?.()

    await expect(queued).rejects.toThrow("密钥不存在：TOKEN")
  })

  it("creates and lists safe secret views without values", async () => {
    const service = createSecretsService(createHarness().deps)

    await service.create({ name: "TOKEN", value: "raw-value-123", description: "api token" })
    await service.create({ name: "EMPTY", value: "" })

    await expect(service.list()).resolves.toEqual({
      secrets: [
        { id: "id-1", name: "TOKEN", description: "api token", hasValue: true },
        { id: "id-2", name: "EMPTY", hasValue: true },
      ],
      total: 2,
    })
    expect(JSON.stringify(await service.list())).not.toContain("raw-value-123")
  })

  it("gets a value only when includeValue is true", async () => {
    const service = createSecretsService(createHarness().deps)
    await service.create({ name: "TOKEN", value: "secret", description: "api token" })

    await expect(service.get({ name: "token" })).resolves.toEqual({
      id: "id-1",
      name: "TOKEN",
      description: "api token",
      hasValue: true,
    })
    await expect(service.get({ name: "TOKEN", includeValue: true })).resolves.toEqual({
      id: "id-1",
      name: "TOKEN",
      description: "api token",
      hasValue: true,
      value: "secret",
    })
  })

  it("rejects duplicate names case-insensitively", async () => {
    const service = createSecretsService(createHarness().deps)
    await service.create({ name: "TOKEN", value: "secret" })

    await expect(service.create({ name: "token", value: "next" }))
      .rejects.toThrow("密钥已存在")
  })

  it("serializes concurrent creates by normalized name", async () => {
    const harness = createHarness()
    const service = createSecretsService(harness.deps)

    const results = await Promise.allSettled([
      service.create({ name: "TOKEN", value: "first" }),
      service.create({ name: "token", value: "second" }),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect(harness.items.records.size).toBe(1)
  })

  it("serializes concurrent upserts into one physical record", async () => {
    const harness = createHarness()
    const service = createSecretsService(harness.deps)

    const results = await Promise.all([
      service.upsert({ name: "TOKEN", value: "first" }),
      service.upsert({ name: "token", value: "second" }),
    ])

    expect(results.map((result) => result.created)).toEqual([true, false])
    expect(harness.items.records.size).toBe(1)
    await expect(service.get({ name: "TOKEN", includeValue: true }))
      .resolves.toMatchObject({ value: "second" })
  })

  it("rejects attempts to rename an existing secret", () => {
    expect(secretUpdateInputSchema.safeParse({
      name: "TOKEN",
      newName: "RENAMED_TOKEN",
      description: "new description",
    }).success).toBe(false)
  })

  it("rejects empty updates without writing or broadcasting a change", async () => {
    const harness = createHarness()
    const service = createSecretsService(harness.deps)
    const changed = vi.fn()
    service.events.on("changed", changed)
    await service.create({ name: "TOKEN", value: "secret", description: "api" })
    changed.mockClear()

    await expect(service.update({ name: "TOKEN" }))
      .rejects.toThrow("必须提供 value 或 description")

    expect(changed).not.toHaveBeenCalled()
    await expect(service.get({ name: "TOKEN", includeValue: true })).resolves.toMatchObject({
      value: "secret",
      description: "api",
    })
  })

  it("updates value and description while preserving the original name", async () => {
    const service = createSecretsService(createHarness().deps)
    await service.create({ name: "TOKEN", value: "old", description: "old description" })

    await expect(service.update({
      name: "token",
      value: "new",
      description: "new description",
    })).resolves.toEqual({
      id: "id-1",
      name: "TOKEN",
      description: "new description",
      hasValue: true,
    })
    await expect(service.get({ name: "TOKEN", includeValue: true }))
      .resolves.toMatchObject({ value: "new" })
  })

  it("upserts existing and new secrets", async () => {
    const service = createSecretsService(createHarness().deps)

    await expect(service.upsert({ name: "TOKEN", value: "created" })).resolves.toEqual({
      secret: { id: "id-1", name: "TOKEN", hasValue: true },
      created: true,
    })
    await expect(service.upsert({ name: "token", description: "api" })).resolves.toEqual({
      secret: { id: "id-1", name: "TOKEN", description: "api", hasValue: true },
      created: false,
    })
    await expect(service.get({ name: "TOKEN", includeValue: true })).resolves.toMatchObject({
      value: "created",
    })
  })

  it("deletes by case-insensitive name", async () => {
    const service = createSecretsService(createHarness().deps)
    await service.create({ name: "TOKEN", value: "secret" })

    await expect(service.delete({ name: "token" })).resolves.toEqual({
      id: "id-1",
      name: "TOKEN",
      hasValue: true,
    })
    await expect(service.list()).resolves.toEqual({ secrets: [], total: 0 })
  })

  it("fails closed on stored duplicate names and deletes every duplicate", async () => {
    const harness = createHarness()
    await harness.items.upsert({
      id: "duplicate-1",
      schemaVersion: 1,
      name: "TOKEN",
      value: "first-secret",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    })
    await harness.items.upsert({
      id: "duplicate-2",
      schemaVersion: 1,
      name: "token",
      value: "second-secret",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    })
    const service = createSecretsService(harness.deps)

    await expect(service.get({ name: "TOKEN", includeValue: true }))
      .rejects.toThrow("检测到重复密钥名称")
    expect(harness.deps.logger.warn).toHaveBeenCalledWith(
      "Duplicate secret records were detected.",
      { duplicateCount: 2 },
    )

    await expect(service.delete({ name: "token" })).resolves.toMatchObject({ name: "TOKEN" })
    await expect(service.list()).resolves.toEqual({ secrets: [], total: 0 })
    expect(harness.deps.logger.warn).toHaveBeenCalledWith(
      "Duplicate secret records were removed by logical name.",
      { duplicateCount: 2 },
    )
    const warningLogs = JSON.stringify(vi.mocked(harness.deps.logger.warn).mock.calls)
    expect(warningLogs).not.toContain("TOKEN")
    expect(warningLogs).not.toContain("token")
    expect(warningLogs).not.toContain("first-secret")
    expect(warningLogs).not.toContain("second-secret")
  })

  it("emits changed events after mutations", async () => {
    const service = createSecretsService(createHarness().deps)
    const changed = vi.fn()
    service.events.on("changed", changed)

    await service.create({ name: "TOKEN", value: "secret" })

    expect(changed).toHaveBeenCalledWith({
      secrets: [{ id: "id-1", name: "TOKEN", hasValue: true }],
    })
  })

  it("migrates legacy config variables and clears config on success", async () => {
    const legacyConfig = createDefaultConfig()
    legacyConfig.global.variables = [
      { name: "TOKEN", value: "secret", description: "api" },
    ]
    const harness = createHarness({ config: legacyConfig })
    const service = createSecretsService(harness.deps)

    await service.initialize()

    expect(await service.list()).toEqual({
      secrets: [{ id: "id-1", name: "TOKEN", description: "api", hasValue: true }],
      total: 1,
    })
    expect(harness.updateConfig).toHaveBeenCalledWith({ global: { variables: [] } })
    expect(harness.config.global.variables).toEqual([])
    expect((await harness.settings.getSingleton())?.legacyConfigMigratedAt)
      .toBe("2026-07-09T00:00:00.000Z")
  })

  it("keeps existing repository secrets when legacy names conflict", async () => {
    const legacyConfig = createDefaultConfig()
    legacyConfig.global.variables = [
      { name: "TOKEN", value: "legacy", description: "legacy" },
      { name: "OTHER", value: "other" },
    ]
    const harness = createHarness({ config: legacyConfig })
    await harness.items.upsert({
      id: "existing",
      schemaVersion: 1,
      name: "token",
      value: "current",
      description: "current",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    })
    const service = createSecretsService(harness.deps)

    await service.initialize()

    await expect(service.get({ name: "TOKEN", includeValue: true })).resolves.toMatchObject({
      name: "token",
      value: "current",
    })
    await expect(service.get({ name: "OTHER", includeValue: true })).resolves.toMatchObject({
      name: "OTHER",
      value: "other",
    })
  })

  it("migrates compatible legacy variables while preserving invalid names for retry", async () => {
    const legacyConfig = createDefaultConfig()
    legacyConfig.global.variables = [
      { name: "TOKEN", value: "valid-secret" },
      { name: "invalid-name", value: "preserved-secret" },
    ]
    const harness = createHarness({ config: legacyConfig })
    const service = createSecretsService(harness.deps)

    await expect(service.initialize()).resolves.toBeUndefined()

    await expect(service.get({ name: "TOKEN", includeValue: true })).resolves.toMatchObject({
      value: "valid-secret",
    })
    expect(harness.config.global.variables).toEqual([
      { name: "invalid-name", value: "preserved-secret" },
    ])
    expect(await harness.settings.getSingleton()).toEqual({
      schemaVersion: 1,
      legacyConfigMigratedAt: null,
    })
    expect(harness.deps.logger.warn).toHaveBeenCalledWith(
      "Some legacy variables were not migrated because their names are incompatible.",
      { incompatibleCount: 1, migratedCount: 1 },
    )
    expect(JSON.stringify(vi.mocked(harness.deps.logger.warn).mock.calls))
      .not.toContain("preserved-secret")

    harness.config.global.variables = [{ name: "REPAIRED_NAME", value: "preserved-secret" }]
    await expect(service.initialize()).resolves.toBeUndefined()

    await expect(service.get({ name: "REPAIRED_NAME", includeValue: true })).resolves.toMatchObject({
      value: "preserved-secret",
    })
    expect(harness.config.global.variables).toEqual([])
    expect((await harness.settings.getSingleton())?.legacyConfigMigratedAt)
      .toBe("2026-07-09T00:00:00.000Z")
  })

  it("does not clear legacy config when migration persistence fails", async () => {
    const legacyConfig = createDefaultConfig()
    legacyConfig.global.variables = [{ name: "TOKEN", value: "secret" }]
    const harness = createHarness({ config: legacyConfig, failConfigUpdate: true })
    const service = createSecretsService(harness.deps)

    await expect(service.initialize()).rejects.toThrow("config update failed")

    expect(harness.config.global.variables).toEqual([{ name: "TOKEN", value: "secret" }])
    expect(await harness.settings.getSingleton()).toEqual({
      schemaVersion: 1,
      legacyConfigMigratedAt: null,
    })
  })

  it("skips migration when legacyConfigMigratedAt is set", async () => {
    const legacyConfig = createDefaultConfig()
    legacyConfig.global.variables = [{ name: "TOKEN", value: "secret" }]
    const harness = createHarness({
      config: legacyConfig,
      settings: { schemaVersion: 1, legacyConfigMigratedAt: "2026-07-08T00:00:00.000Z" },
    })
    const service = createSecretsService(harness.deps)

    await service.initialize()

    expect(await service.list()).toEqual({ secrets: [], total: 0 })
    expect(harness.updateConfig).not.toHaveBeenCalled()
  })
})

type HarnessOptions = {
  readonly config?: SynapseConfig
  readonly settings?: SecretSettingsEntryV1
  readonly failConfigUpdate?: boolean
}

function createHarness(options: HarnessOptions = {}) {
  const items = createMemoryNamespace<SecretItemEntryV1>()
  const settings = createMemoryNamespace<SecretSettingsEntryV1>({
    singleton: options.settings ?? { schemaVersion: 1, legacyConfigMigratedAt: null },
  })
  const config = options.config ?? createDefaultConfig()
  const updateConfig = vi.fn(async (patch: SynapseConfigPatch) => {
    if (options.failConfigUpdate) throw new Error("config update failed")
    if (patch.global?.variables) config.global.variables = patch.global.variables
    return config
  })
  const skillEnvBindings = {
    scan: vi.fn(async () => ({ scanSessionId: "scan-1", items: [] })),
    scanMany: vi.fn(async (requests: readonly { name: string }[]) => requests.map(({ name }) => ({
      name,
      scanResult: { scanSessionId: `scan-${name}`, items: [] },
    }))),
    enqueue: vi.fn(async () => ({ items: [] })),
  }
  let nextId = 1

  return {
    items,
    settings,
    config,
    updateConfig,
    skillEnvBindings,
    deps: {
      items,
      settings,
      loadConfig: async () => config,
      updateConfig,
      skillEnvBindings,
      now: () => new Date("2026-07-09T00:00:00.000Z"),
      createId: () => `id-${nextId++}`,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    },
  }
}

function createMemoryNamespace<T extends { id?: string }>(options: {
  readonly singleton?: T
} = {}) {
  const events = new EventEmitter()
  let singleton = options.singleton ?? null
  const records = new Map<string, T>()
  const namespace: DataNamespace<T> & { records: Map<string, T> } = {
    name: "memory",
    schemaVersion: 1,
    backend: "json",
    records,
    async getSingleton() { return singleton },
    async setSingleton(value) { singleton = value },
    async clearSingleton() { singleton = null },
    async list() { return Array.from(records.values()) },
    async count() { return records.size },
    async get(id) { return records.get(id) ?? null },
    async upsert(item) { records.set(item.id, item) },
    async remove(id) { records.delete(id) },
    onChange(listener) {
      events.on("change", listener)
      return () => events.off("change", listener)
    },
  }
  return namespace
}
