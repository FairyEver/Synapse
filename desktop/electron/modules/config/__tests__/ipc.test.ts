import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInMemoryHarness, type IpcHandlerContext } from "../../../runtime/ipc"
import { configStore } from "../../../services/config-store"
import { configIpcModule } from "../ipc"
import type { SynapseConfig } from "../../../../src/types/config"

const mocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

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
  })

  it("preserves Agent config on get responses", async () => {
    vi.mocked(configStore.load).mockResolvedValue(configFixture({ defaultPermissionMode: "plan" }))
    const harness = createHarness()

    const result = await harness.invoke("synapse:config:get", undefined)

    expect(result).toEqual(configFixture({ defaultPermissionMode: "plan" }))
  })

  it("preserves Agent config on update responses", async () => {
    vi.mocked(configStore.update).mockResolvedValue(configFixture({ defaultPermissionMode: "default" }))
    const harness = createHarness()

    const result = await harness.invoke("synapse:config:update", {
      agent: { defaultPermissionMode: "default" },
    })

    expect(result).toEqual(configFixture({ defaultPermissionMode: "default" }))
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
