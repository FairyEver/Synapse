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
  repositoryStore: {
    reconcileRepositories: vi.fn(),
    unwatchAll: vi.fn(),
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
  repositoryStore: mocks.repositoryStore,
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

  it("reconciles repository watchers after repository list updates", async () => {
    const nextConfig = configFixture({ defaultPermissionMode: "default", defaultProviderModel: null })
    nextConfig.repositories = [repositoryFixture({ uuid: "repo-1", localPath: "/new-repo" })]
    vi.mocked(configStore.update).mockResolvedValue(nextConfig)
    const harness = createHarness()

    await harness.invoke("synapse:config:update", {
      repositories: nextConfig.repositories,
    })

    expect(mocks.repositoryStore.reconcileRepositories).toHaveBeenCalledWith(nextConfig.repositories)
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

  it("summarizes quick input content before logging update requests", async () => {
    vi.mocked(configStore.update).mockResolvedValue(configFixture({ defaultPermissionMode: "default", defaultProviderModel: null }))
    const harness = createHarness()

    await harness.invoke("synapse:config:update", {
      global: {
        quickInputs: [{ id: "quick-1", content: "token=secret-value\n内部资料", directSend: true }],
      },
    })

    const updateLog = mocks.logger.info.mock.calls.find(([message]) =>
      String(message).startsWith("Handling config.update request."),
    )
    expect(updateLog).toBeDefined()

    const loggedMessage = String(updateLog?.[0])
    expect(loggedMessage).toContain("quick-1")
    expect(loggedMessage).toContain("contentLength")
    expect(loggedMessage).not.toContain("token=secret-value")
    expect(loggedMessage).not.toContain("内部资料")
  })

  it("checks and audits secret writes for variable patches", async () => {
    const previousConfig = configFixture({ defaultPermissionMode: "default", defaultProviderModel: null })
    previousConfig.global.variables = [{ name: "TOKEN", value: "old-secret" }]
    const nextConfig = configFixture({ defaultPermissionMode: "default", defaultProviderModel: null })
    nextConfig.global.variables = [
      { name: "TOKEN", value: "new-secret" },
      { name: "BARK_ID", value: "phone-secret", description: "phone push" },
    ]
    vi.mocked(configStore.load).mockResolvedValue(previousConfig)
    vi.mocked(configStore.update).mockResolvedValue(nextConfig)
    const permissionGuard = {
      check: vi.fn().mockResolvedValue({ allowed: true }),
      registerPolicy: vi.fn(),
    }
    const auditSink = {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    }
    const harness = createHarness({ auditSink, permissionGuard })

    await harness.invoke("synapse:config:update", {
      global: { variables: nextConfig.global.variables },
    })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      resource: "variable:user:TOKEN",
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      resource: "variable:user:BARK_ID",
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      outcome: "allowed",
      resource: "variable:user:TOKEN",
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      outcome: "allowed",
      resource: "variable:user:BARK_ID",
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("new-secret")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("phone-secret")
  })

  it("records failed secret write audits when variable patch persistence fails", async () => {
    const previousConfig = configFixture({ defaultPermissionMode: "default", defaultProviderModel: null })
    previousConfig.global.variables = [{ name: "TOKEN", value: "old-secret" }]
    vi.mocked(configStore.load).mockResolvedValue(previousConfig)
    vi.mocked(configStore.update).mockRejectedValue(new Error("disk full: new-secret"))
    const permissionGuard = {
      check: vi.fn().mockResolvedValue({ allowed: true }),
      registerPolicy: vi.fn(),
    }
    const auditSink = {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    }
    const harness = createHarness({ auditSink, permissionGuard })

    await expect(harness.invoke("synapse:config:update", {
      global: { variables: [{ name: "TOKEN", value: "new-secret" }] },
    })).rejects.toThrow("disk full")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret.write",
      outcome: "failed",
      resource: "variable:user:TOKEN",
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("new-secret")
  })

  it("ignores legacy conversation rollover prompt patches through IPC", async () => {
    vi.mocked(configStore.update).mockResolvedValue(
      configFixture({
        defaultPermissionMode: "default",
        defaultProviderModel: null,
      }),
    )
    const harness = createHarness()

    const result = await harness.invoke("synapse:config:update", {
      agent: {
        conversationRolloverPrompt: {
          costThresholdCny: 18,
          tokenThreshold: 6_000_000,
        },
      },
    }) as SynapseConfig

    expect(result.agent).not.toHaveProperty("conversationRolloverPrompt")
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

  it("does not record successful config writes when backup import is rejected", async () => {
    const { configBackupService } = await import("../../../services/config-backup-service")
    vi.mocked(configBackupService.selectImportSource).mockResolvedValue("/tmp/large-synapse-backup.json")
    vi.mocked(configBackupService.readImport).mockRejectedValue(new Error("备份文件超过 2097152 字节上限。"))
    const auditSink = {
      clearForTests: vi.fn(),
      list: vi.fn(() => []),
      record: vi.fn(),
    }
    const harness = createHarness({ auditSink })

    await expect(harness.invoke("synapse:config:import-backup", undefined)).rejects.toThrow("备份文件超过")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
      resource: "/tmp/large-synapse-backup.json",
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "failed",
      resource: "config+identity",
    }))
    expect(auditSink.record).not.toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "config+identity",
    }))
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
  readonly permissionGuard?: {
    readonly check: ReturnType<typeof vi.fn>
    readonly registerPolicy: ReturnType<typeof vi.fn>
  }
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
      return (options.permissionGuard ?? {
        check: vi.fn().mockResolvedValue({ allowed: true }),
        registerPolicy: vi.fn(),
      }) as T
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
      knowledgeBaseStorage: { mode: "default" },
    },
    agent: {
      defaultPermissionMode: "default",
      defaultProviderModel: null,
      ...agent,
    },
  }
}

function repositoryFixture(
  overrides: Partial<SynapseConfig["repositories"][number]> = {},
): SynapseConfig["repositories"][number] {
  return {
    uuid: "repo-1",
    name: "Repo",
    localPath: "/repo",
    contentDirs: {},
    ...overrides,
  }
}
