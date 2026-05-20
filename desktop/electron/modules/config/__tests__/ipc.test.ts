import { beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
import { app } from "electron"
import { createInMemoryHarness, type IpcHandlerContext } from "../../../runtime/ipc"
import { configStore } from "../../../services/config-store"
import { configIpcModule } from "../ipc"
import type { SynapseConfig } from "../../../../src/types/config"

const mocks = vi.hoisted(() => ({
  fs: {
    readdir: vi.fn(),
    rm: vi.fn(),
    unlink: vi.fn(),
  },
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("node:fs/promises", () => mocks.fs)

vi.mock("electron", () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => "/tmp"),
    relaunch: vi.fn(),
  },
}))

vi.mock("../../../services/config-store", () => ({
  configStore: {
    load: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock("../../../services/config-backup-service", () => ({
  configBackupService: {
    exportBackup: vi.fn(),
    importBackup: vi.fn(),
  },
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
  logStore: {
    dispose: vi.fn(),
  },
}))

vi.mock("../../../services/repository-store", () => ({
  repositoryStore: {
    unwatchAll: vi.fn(),
  },
}))

vi.mock("../../../database", () => ({
  shutdownDatabase: vi.fn(),
}))

describe("configIpcModule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fs.readdir.mockResolvedValue([])
    mocks.fs.rm.mockResolvedValue(undefined)
    mocks.fs.unlink.mockResolvedValue(undefined)
  })

  it("preserves Agent config on get responses", async () => {
    vi.mocked(configStore.load).mockResolvedValue(configFixture({ defaultPermissionMode: "plan", defaultProviderModel: null }))
    const harness = createHarness()

    const result = await harness.invoke("synapse:config:get", undefined)

    expect(result).toEqual(configFixture({ defaultPermissionMode: "plan", defaultProviderModel: null }))
  })

  it("preserves Agent config on update responses", async () => {
    vi.mocked(configStore.update).mockResolvedValue(configFixture({ defaultPermissionMode: "default", defaultProviderModel: null }))
    const harness = createHarness()

    const result = await harness.invoke("synapse:config:update", {
      agent: { defaultPermissionMode: "default" },
    })

    expect(result).toEqual(configFixture({ defaultPermissionMode: "default", defaultProviderModel: null }))
  })

  it("preserves defaultProviderModel through IPC round-trip", async () => {
    const providerModel = { providerId: "p1", modelTier: "sonnet" as const }
    vi.mocked(configStore.update).mockResolvedValue(
      configFixture({ defaultPermissionMode: "default", defaultProviderModel: providerModel }),
    )
    const harness = createHarness()

    const result = await harness.invoke("synapse:config:update", {
      agent: { defaultProviderModel: providerModel },
    }) as SynapseConfig

    expect(result.agent.defaultProviderModel).toEqual(providerModel)
  })

  it("relaunches even when resetApp cannot delete every userData entry", async () => {
    mocks.fs.readdir.mockResolvedValue([
      { name: "stale-cache", isDirectory: () => true },
      { name: "config.json", isDirectory: () => false },
      { name: "synapse-database.db", isDirectory: () => false },
    ])
    mocks.fs.rm.mockRejectedValueOnce(new Error("locked"))
    const harness = createHarness()

    const result = await harness.invoke("synapse:config:reset-app", undefined)

    expect(result).toEqual({
      success: false,
      failedCount: 1,
      failedEntries: ["stale-cache"],
    })
    expect(app.relaunch).toHaveBeenCalledOnce()
    expect(app.exit).toHaveBeenCalledWith(0)
    expect(mocks.fs.unlink).toHaveBeenCalledTimes(1)
    expect(mocks.fs.unlink).toHaveBeenCalledWith(path.join("/tmp", "config.json"))
  })
})

function createHarness() {
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
    throw new Error(`Unexpected service id: ${serviceId}`)
  }

  harness.registry.register(configIpcModule, { moduleId: "config", resolve })

  return harness
}

function configFixture(agent: SynapseConfig["agent"]): SynapseConfig {
  return {
    activeRepoUuid: null,
    repositories: [],
    global: {
      themeMode: "light",
      projects: [],
      favorites: { rule: [], skill: [], prompt: [] },
      recentlyViewed: { rule: [], skill: [], prompt: [] },
      contentSortOrder: "modified-desc",
    },
    agent,
  }
}
