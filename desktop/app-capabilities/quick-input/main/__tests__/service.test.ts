import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type {
  QuickInputItemEntryV1,
  QuickInputSettingsEntryV1,
} from "../../../../electron/runtime/data-repo/schemas/quick-input"
import { DEFAULT_AGENT_GLOBAL_CONFIG, DEFAULT_GLOBAL_CONFIG } from "../../../../src/constants/defaults"
import type { SynapseConfig, SynapseConfigPatch } from "../../../../src/types/config"
import { createQuickInputService } from "../service"

describe("QuickInputService", () => {
  it("creates, updates, pins, deletes, and lists items by sortOrder", async () => {
    const harness = createHarness()
    const service = createQuickInputService(harness.deps)

    const second = await service.create({ content: "第二条" })
    const first = await service.create({ content: "第一条" })
    await service.pinToTop({ id: first.id })
    await service.update({ id: second.id, content: "第二条更新" })

    expect((await service.list()).map((item) => item.content)).toEqual(["第一条", "第二条更新"])
    await service.delete({ id: first.id })
    expect((await service.list()).map((item) => item.content)).toEqual(["第二条更新"])
  })

  it("rejects blank content", async () => {
    const service = createQuickInputService(createHarness().deps)

    await expect(service.create({ content: "   " })).rejects.toThrow("内容不能为空")
  })

  it("migrates legacy config quick inputs once and clears the legacy list", async () => {
    const harness = createHarness({
      quickInputs: [
        { id: "legacy-1", content: "旧片段一", directSend: false },
        { id: "legacy-2", content: "旧片段二", directSend: true },
      ],
    })
    const service = createQuickInputService(harness.deps)

    await service.initialize()

    expect((await service.list()).map((item) => ({
      id: item.id,
      content: item.content,
      sortOrder: item.sortOrder,
    }))).toEqual([
      { id: "legacy-1", content: "旧片段一", sortOrder: 10 },
      { id: "legacy-2", content: "旧片段二", sortOrder: 20 },
    ])
    expect(harness.config.global.quickInputs).toEqual([])
    expect((await harness.settings.getSingleton())?.legacyConfigMigratedAt)
      .toBe("2026-06-25T00:00:00.000Z")
  })

  it("does not clear legacy config when item migration fails", async () => {
    const harness = createHarness({
      quickInputs: [{ id: "legacy-1", content: "旧片段", directSend: false }],
      failItemUpsert: true,
    })
    const service = createQuickInputService(harness.deps)

    await expect(service.initialize()).rejects.toThrow("upsert failed")

    expect(harness.config.global.quickInputs).toHaveLength(1)
    expect(await harness.settings.getSingleton()).toEqual({
      schemaVersion: 1,
      legacyConfigMigratedAt: null,
      defaultSeededVersion: null,
    })
  })

  it("seeds defaults for an empty migrated store only once", async () => {
    const harness = createHarness({ appVersion: "1.2.3" })
    const service = createQuickInputService(harness.deps)

    await service.initialize()
    const seeded = await service.list()
    await service.delete({ id: seeded[0]!.id })
    await service.initialize()

    expect((await service.list()).length).toBe(seeded.length - 1)
    expect((await harness.settings.getSingleton())?.defaultSeededVersion).toBe("1.2.3")
  })
})

type HarnessOptions = {
  readonly quickInputs?: SynapseConfig["global"]["quickInputs"]
  readonly failItemUpsert?: boolean
  readonly appVersion?: string
}

function createHarness(options: HarnessOptions = {}) {
  const items = createMemoryNamespace<QuickInputItemEntryV1>({ failUpsert: options.failItemUpsert })
  const settings = createMemoryNamespace<QuickInputSettingsEntryV1>({
    singleton: { schemaVersion: 1, legacyConfigMigratedAt: null, defaultSeededVersion: null },
  })
  const config: SynapseConfig = {
    activeRepoUuid: null,
    repositories: [],
    global: {
      ...DEFAULT_GLOBAL_CONFIG,
      quickInputs: options.quickInputs ?? [],
      defaultQuickInputsSeededVersion: "legacy-version",
    },
    agent: DEFAULT_AGENT_GLOBAL_CONFIG,
  }

  return {
    items,
    settings,
    config,
    deps: {
      items,
      settings,
      loadConfig: async () => config,
      updateConfig: async (patch: SynapseConfigPatch) => {
        if (patch.global?.quickInputs) config.global.quickInputs = patch.global.quickInputs
        return config
      },
      appVersion: options.appVersion ?? "0.0.0-test",
      now: () => new Date("2026-06-25T00:00:00.000Z"),
      createId: () => `id-${items.records.size + 1}`,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    },
  }
}

function createMemoryNamespace<T extends { id?: string }>(options: {
  readonly singleton?: T
  readonly failUpsert?: boolean
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
    async upsert(item) {
      if (options.failUpsert) throw new Error("upsert failed")
      records.set(item.id, item)
    },
    async remove(id) { records.delete(id) },
    onChange(listener) {
      events.on("change", listener)
      return () => events.off("change", listener)
    },
  }
  return namespace
}
