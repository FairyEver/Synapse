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
  logStore: {
    dispose: vi.fn(),
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
    readImport: vi.fn(),
    selectExportTarget: vi.fn(),
    selectImportSource: vi.fn(),
    writeExport: vi.fn(),
  },
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: () => mocks.logger,
  logStore: mocks.logStore,
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

  it("preserves conversation rollover prompt thresholds through IPC round-trip", async () => {
    const conversationRolloverPrompt = {
      costThresholdCny: 18,
      tokenThreshold: 6_000_000,
    }
    vi.mocked(configStore.update).mockResolvedValue(
      configFixture({
        defaultPermissionMode: "default",
        defaultProviderModel: null,
        conversationRolloverPrompt,
      }),
    )
    const harness = createHarness()

    const result = await harness.invoke("synapse:config:update", {
      agent: { conversationRolloverPrompt },
    }) as SynapseConfig

    expect(result.agent.conversationRolloverPrompt).toEqual(conversationRolloverPrompt)
  })

  it("returns filePath for config backup export", async () => {
    const { configBackupService } = await import("../../../services/config-backup-service")
    vi.mocked(configBackupService.selectExportTarget).mockResolvedValue("/tmp/synapse-backup.json")
    vi.mocked(configBackupService.writeExport).mockResolvedValue(undefined)
    const harness = createHarness()

    const result = await harness.invoke("synapse:config:export-backup", undefined)

    expect(result).toEqual({ filePath: "/tmp/synapse-backup.json" })
  })

  it("returns filePath for config backup import", async () => {
    const { configBackupService } = await import("../../../services/config-backup-service")
    vi.mocked(configBackupService.selectImportSource).mockResolvedValue("/tmp/synapse-backup.json")
    vi.mocked(configBackupService.readImport).mockResolvedValue({ filePath: "/tmp/synapse-backup.json" })
    const harness = createHarness()

    const result = await harness.invoke("synapse:config:import-backup", undefined)

    expect(result).toEqual({ filePath: "/tmp/synapse-backup.json" })
  })

  it("relaunches even when resetApp cannot delete every userData entry", async () => {
    mocks.fs.readdir.mockResolvedValue([
      { name: "stale-cache", isDirectory: () => true },
      { name: "config.json", isDirectory: () => false },
      { name: "synapse-database.db", isDirectory: () => false },
    ])
    mocks.fs.rm.mockRejectedValueOnce(new Error("locked"))
    const harness = createHarness()
    const stderrWrite = vi.spyOn(process.stderr, "write")
    stderrWrite.mockImplementation((() => true) as unknown as typeof process.stderr.write)

    let result: unknown
    try {
      result = await harness.invoke("synapse:config:reset-app", undefined)
    } finally {
      stderrWrite.mockRestore()
    }

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

  it("records resetApp audit and system log before disposing local logs", async () => {
    mocks.fs.readdir.mockResolvedValue([
      { name: "logs", isDirectory: () => true },
      { name: "config.json", isDirectory: () => false },
      { name: "synapse-data.db", isDirectory: () => false },
    ])
    const auditSink = {
      clearForTests: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      list: vi.fn(() => []),
      record: vi.fn(),
    }
    const stderrWrite = vi.spyOn(process.stderr, "write")
    stderrWrite.mockImplementation((() => true) as unknown as typeof process.stderr.write)
    const harness = createHarness({ auditSink })

    try {
      await harness.invoke("synapse:config:reset-app", undefined)

      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.write",
        actor: { kind: "user" },
        resource: "app:userData",
        outcome: "allowed",
        metadata: expect.objectContaining({
          operation: "app.reset",
          source: "config.resetApp",
          stage: "started",
        }),
      }))
      expect(auditSink.flush).toHaveBeenCalled()
      expect(auditSink.record.mock.invocationCallOrder[0]).toBeLessThan(mocks.logStore.dispose.mock.invocationCallOrder[0])
      expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining("[synapse-reset] config.resetApp started"))
    } finally {
      stderrWrite.mockRestore()
    }
  })
})

function createHarness(options: {
  readonly auditSink?: {
    readonly clearForTests: ReturnType<typeof vi.fn>
    readonly flush?: ReturnType<typeof vi.fn>
    readonly list: ReturnType<typeof vi.fn>
    readonly record: ReturnType<typeof vi.fn>
  }
} = {}) {
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
    if (serviceId === "core.permission-guard") {
      return {
        check: vi.fn().mockResolvedValue({ allowed: true }),
        registerPolicy: vi.fn(),
      } as T
    }
    if (serviceId === "core.audit-sink") {
      return (options.auditSink ?? {
        clearForTests: vi.fn(),
        list: vi.fn(() => []),
        record: vi.fn(),
      }) as T
    }
    throw new Error(`Unexpected service id: ${serviceId}`)
  }

  harness.registry.register(configIpcModule, { moduleId: "config", resolve })

  return harness
}

function configFixture(agent: Partial<SynapseConfig["agent"]>): SynapseConfig {
  return {
    activeRepoUuid: null,
    repositories: [],
    global: {
      themeMode: "light",
      projects: [],
      quickInputs: [],
      defaultQuickInputsSeededVersion: null,
      favorites: { rule: [], skill: [], prompt: [] },
      recentlyViewed: { rule: [], skill: [], prompt: [] },
      contentSortOrder: "modified-desc",
      variables: [],
    },
    agent: {
      defaultPermissionMode: "default",
      defaultProviderModel: null,
      conversationRolloverPrompt: {
        costThresholdCny: 10,
        tokenThreshold: 5_000_000,
      },
      ...agent,
    },
  }
}
