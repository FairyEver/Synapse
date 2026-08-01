import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type { AgentPersonaRemoteCacheEntryV1 } from "../../../../electron/runtime/data-repo/schemas/agent-persona-remote-cache"
import type { SynapseAccountState } from "../../../../src/types/account"
import type { AgentPersona } from "../../shared/schema"
import { AgentPersonaCache } from "../cache"
import { createAgentPersonaService } from "../service"

describe("AgentPersonaService", () => {
  it("returns unauthenticated without reading old local items", async () => {
    const harness = createCloudHarness({ accountState: { status: "unauthenticated" } })
    const service = createAgentPersonaService(harness.deps)

    await expect(service.list()).resolves.toEqual({ status: "unauthenticated", items: [] })
    expect(harness.remote.list).not.toHaveBeenCalled()
  })

  it("loads remote personas online and writes read-only cache", async () => {
    const harness = createCloudHarness({
      accountState: authenticatedOnline("user-1"),
      remoteItems: [remoteBuiltin(), remoteUser()],
    })
    const service = createAgentPersonaService(harness.deps)

    await expect(service.list()).resolves.toMatchObject({
      status: "online",
      syncedAt: "2026-07-01T00:00:00.000Z",
      items: [
        expect.objectContaining({ id: "builtin-1" }),
        expect.objectContaining({ id: "persona-1" }),
      ],
    })
    expect(harness.cacheNamespace.singleton?.users["user-1"]?.items.map((item) => item.id)).toEqual(["builtin-1", "persona-1"])
  })

  it("emits changed when a later remote list returns updated personas", async () => {
    const remoteItems = [remoteBuiltin()]
    const harness = createCloudHarness({
      accountState: authenticatedOnline("user-1"),
      remoteItems,
    })
    const service = createAgentPersonaService(harness.deps)
    const changed = vi.fn()
    service.events.on("changed", changed)

    await service.list()
    expect(changed).not.toHaveBeenCalled()

    remoteItems[0] = remoteBuiltin({
      systemPrompt: "你是中英翻译智能体。只输出翻译结果。",
      version: 2,
    })

    await expect(service.list()).resolves.toMatchObject({
      status: "online",
      items: [expect.objectContaining({ version: 2 })],
    })
    await service.list()

    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({
      status: "online",
      items: [expect.objectContaining({
        systemPrompt: "你是中英翻译智能体。只输出翻译结果。",
        version: 2,
      })],
    }))
  })

  it("falls back to current user cache when remote list fails", async () => {
    const harness = createCloudHarness({
      accountState: authenticatedOffline("user-1"),
      remoteError: new Error("network down"),
      cacheUsers: {
        "user-1": { syncedAt: "2026-07-01T00:00:00.000Z", items: [remoteUser()] },
        "user-2": { syncedAt: "2026-07-01T00:00:00.000Z", items: [remoteBuiltin({ id: "other-user-cache" })] },
      },
    })
    const service = createAgentPersonaService(harness.deps)

    await expect(service.list()).resolves.toEqual({
      status: "offline-cache",
      syncedAt: "2026-07-01T00:00:00.000Z",
      items: [remoteUser()],
    })
  })

  it("reads the current user's synchronized local snapshot without requesting the remote list", async () => {
    const harness = createCloudHarness({
      accountState: authenticatedOnline("user-1"),
      cacheUsers: {
        "user-1": { syncedAt: "2026-07-01T00:00:00.000Z", items: [remoteUser()] },
        "user-2": { syncedAt: "2026-07-01T00:00:00.000Z", items: [remoteBuiltin({ id: "other-user-cache" })] },
      },
    })
    const service = createAgentPersonaService(harness.deps)

    await expect(service.listCached()).resolves.toEqual([remoteUser()])
    expect(harness.remote.list).not.toHaveBeenCalled()
  })

  it("reports a contextual error when the synchronized local snapshot cannot be read", async () => {
    const harness = createCloudHarness({ accountState: authenticatedOnline("user-1") })
    const cacheError = new Error("cache unavailable")
    vi.spyOn(harness.deps.cache, "read").mockRejectedValue(cacheError)
    const service = createAgentPersonaService(harness.deps)

    await expect(service.listCached()).rejects.toThrow("智能体本地快照读取失败")
    expect(harness.deps.logger.error).toHaveBeenCalledWith(
      "Agent persona local snapshot read failed.",
      expect.objectContaining({ boundary: "agent-personas.cache.list-current", error: cacheError }),
    )
  })

  it("does not write cache on failed mutations", async () => {
    const harness = createCloudHarness({
      accountState: authenticatedOffline("user-1"),
      remoteError: new Error("network down"),
    })
    const service = createAgentPersonaService(harness.deps)

    await expect(service.create({
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
      toolPolicy: null,
    })).rejects.toThrow("当前离线，无法保存智能体")
    expect(harness.cacheNamespace.singleton).toBeNull()
  })

  it("refreshes cache and emits changed after writes", async () => {
    const harness = createCloudHarness({
      accountState: authenticatedOnline("user-1"),
      remoteItems: [remoteBuiltin(), remoteUser()],
    })
    const service = createAgentPersonaService(harness.deps)
    const changed = vi.fn()
    service.events.on("changed", changed)

    await expect(service.updateBuiltinModel({
      id: "builtin-1",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "disabled" },
    })).resolves.toMatchObject({
      id: "builtin-1",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    })

    expect(harness.remote.updateBuiltinModel).toHaveBeenCalledWith({
      id: "builtin-1",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "disabled" },
    })
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({
      status: "online",
      items: expect.arrayContaining([expect.objectContaining({ id: "persona-1" })]),
    }))
    expect(changed).toHaveBeenCalledTimes(1)
  })
})

function createCloudHarness(input: {
  readonly accountState: SynapseAccountState
  readonly remoteItems?: AgentPersona[]
  readonly remoteError?: Error
  readonly cacheUsers?: AgentPersonaRemoteCacheEntryV1["users"]
}) {
  const cacheNamespace = createMemorySingletonNamespace<AgentPersonaRemoteCacheEntryV1>()
  if (input.cacheUsers) {
    cacheNamespace.singleton = { schemaVersion: 1, users: input.cacheUsers }
  }
  const remoteItems = input.remoteItems ?? []
  const remote = {
    list: vi.fn(async () => {
      if (input.remoteError) throw input.remoteError
      return remoteItems
    }),
    create: vi.fn(async (item: Parameters<ReturnType<typeof createAgentPersonaService>["create"]>[0]) => remoteUser({
      id: "created-1",
      name: item.name.trim(),
      description: item.description.trim(),
      systemPrompt: item.systemPrompt.trim(),
      providerModel: item.providerModel ?? null,
      toolPolicy: item.toolPolicy ?? null,
    })),
    update: vi.fn(async (item: Parameters<ReturnType<typeof createAgentPersonaService>["update"]>[0]) => remoteUser({
      id: item.id,
      name: item.name.trim(),
      description: item.description.trim(),
      systemPrompt: item.systemPrompt.trim(),
      providerModel: item.providerModel ?? null,
      toolPolicy: item.toolPolicy ?? null,
    })),
    updateBuiltinModel: vi.fn(async (item: Parameters<ReturnType<typeof createAgentPersonaService>["updateBuiltinModel"]>[0]) =>
      remoteBuiltin({
        id: item.id,
        providerModel: item.providerModel,
        toolPolicy: item.toolPolicy ?? null,
      })),
    delete: vi.fn(async () => undefined),
  }
  return {
    remote,
    cacheNamespace,
    deps: {
      remote,
      cache: new AgentPersonaCache(cacheNamespace),
      account: { getState: () => input.accountState },
      now: () => new Date("2026-07-01T00:00:00.000Z"),
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    },
  }
}

function authenticatedOnline(userId: string): SynapseAccountState {
  return {
    status: "authenticated",
    connectivity: "online",
    profile: {
      user: { id: userId, email: `${userId}@example.test`, displayName: null, status: "active" },
      syncedAt: "2026-07-01T00:00:00.000Z",
    },
  }
}

function authenticatedOffline(userId: string): SynapseAccountState {
  return {
    ...authenticatedOnline(userId),
    connectivity: "offline",
    offlineReason: "network",
  }
}

function remoteBuiltin(overrides: Partial<AgentPersona> = {}): AgentPersona {
  return {
    id: "builtin-1",
    schemaVersion: 1,
    name: "中英翻译",
    description: "在中文和英文之间互译。",
    systemPrompt: "你是中英翻译智能体。",
    providerModel: null,
    toolPolicy: { mode: "disabled" },
    source: "builtin",
    readonly: true,
    version: 1,
    ...overrides,
  }
}

function remoteUser(overrides: Partial<AgentPersona> = {}): AgentPersona {
  return {
    id: "persona-1",
    schemaVersion: 1,
    name: "产品顾问",
    description: "整理产品判断。",
    systemPrompt: "你是产品顾问。",
    providerModel: null,
    toolPolicy: null,
    source: "user",
    readonly: false,
    version: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }
}

function createMemorySingletonNamespace<T>(): DataNamespace<T> & { singleton: T | null } {
  const events = new EventEmitter()
  const namespace = {
    name: "memory",
    schemaVersion: 1,
    backend: "json",
    singleton: null as T | null,
    async getSingleton() { return namespace.singleton },
    async setSingleton(value: T) { namespace.singleton = value },
    async clearSingleton() { namespace.singleton = null },
    async list() { return [] },
    async count() { return 0 },
    async get() { return null },
    async upsert() {},
    async remove() {},
    onChange(listener: (change: never) => void) {
      events.on("change", listener)
      return () => events.off("change", listener)
    },
  } satisfies DataNamespace<T> & { singleton: T | null }
  return namespace
}
