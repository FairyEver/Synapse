import { describe, expect, it, vi } from "vitest"

import type { SynapseConfig } from "../../../src/types/config"
import type { SynapseDiagnosticsCheck } from "../../../src/types/diagnostics"
import {
  DiagnosticsService,
  summarizeDiagnosticsChecks,
} from "../diagnostics-service"

describe("summarizeDiagnosticsChecks", () => {
  it("marks a report failed when any check fails", () => {
    const checks: SynapseDiagnosticsCheck[] = [
      {
        id: "system.ok",
        group: "系统",
        name: "系统",
        status: "ok",
        severity: "info",
        message: "通过",
      },
      {
        id: "path.project",
        group: "路径与权限",
        name: "项目路径",
        status: "failed",
        severity: "error",
        message: "路径不可访问",
      },
    ]

    expect(summarizeDiagnosticsChecks(checks)).toEqual({
      overallStatus: "failed",
      summary: {
        ok: 1,
        degraded: 0,
        failed: 1,
        skipped: 0,
      },
    })
  })

  it("marks a report degraded when warnings exist without failures", () => {
    const checks: SynapseDiagnosticsCheck[] = [{
      id: "data-store.cli",
      group: "Data Store",
      name: "CLI",
      status: "degraded",
      severity: "warning",
      message: "CLI 不可用",
    }]

    expect(summarizeDiagnosticsChecks(checks).overallStatus).toBe("degraded")
  })
})

describe("DiagnosticsService.collect", () => {
  it("returns a report even when a probe throws", async () => {
    const service = createService({
      statPath: vi.fn(async (targetPath: string) => {
        if (targetPath === "/missing-project") {
          throw new Error("ENOENT")
        }
        return { isDirectory: () => true }
      }),
    })

    const report = await service.collect()

    expect(report.schemaVersion).toBe(1)
    expect(report.overallStatus).toBe("failed")
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "project.path.project-1",
          status: "failed",
          message: "ENOENT",
        }),
      ]),
    )
  })
})

describe("DiagnosticsService.exportBundle", () => {
  it("writes diagnostics package files and records allowed export", async () => {
    const writtenFiles = new Map<string, string>()
    const auditSink = {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    }
    const service = createService({
      auditSink,
      writeTextFile: vi.fn(async (targetPath: string, content: string) => {
        writtenFiles.set(targetPath, content)
      }),
    })
    const report = await service.collect()

    const result = await service.exportBundle({ report })

    expect(result).toEqual({
      success: true,
      filePath: "/downloads/synapse-diagnostics.zip",
      fileCount: expect.any(Number),
    })
    expect(writtenFiles.has("/tmp/synapse-diagnostics-test/synapse-diagnostics-2026-04-29T03-31-20-000Z/diagnostics.json")).toBe(true)
    expect(writtenFiles.has("/tmp/synapse-diagnostics-test/synapse-diagnostics-2026-04-29T03-31-20-000Z/manifest.json")).toBe(true)
    expect(writtenFiles.has("/tmp/synapse-diagnostics-test/synapse-diagnostics-2026-04-29T03-31-20-000Z/config/config-backup.json")).toBe(true)
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "/downloads/synapse-diagnostics.zip",
    }))
  })

  it("returns success false when export output is unavailable", async () => {
    const service = createService({
      chooseSavePath: vi.fn(async () => null),
    })
    const report = await service.collect()

    await expect(service.exportBundle({ report })).resolves.toEqual({ success: false })
  })
})

function createService(
  overrides: Partial<ConstructorParameters<typeof DiagnosticsService>[0]> = {},
) {
  return new DiagnosticsService({
    appInfo: {
      getAppPath: () => "/app",
      getLocale: () => "zh-CN",
      getName: () => "Synapse",
      getVersion: () => "0.2.49",
      hasSingleInstanceLock: () => true,
      isPackaged: false,
      getPath: (name) => `/app/${name}`,
    },
    configStore: {
      load: vi.fn(async () => createConfig()),
    },
    dataRepository: {
      inspect: () => [],
    },
    serviceRegistry: {
      inspect: () => [],
      get: vi.fn((serviceId: string) => {
        throw new Error(`service not registered: ${serviceId}`)
      }),
    },
    logStore: {
      getLogDirectory: () => "/logs",
      listLogFilesInfo: vi.fn(async () => []),
      flush: vi.fn(async () => undefined),
    },
    dataStore: {
      getDbPath: () => "/data/synapse-data.db",
      getDbSize: () => 0,
      getTableCount: () => 0,
      exportDatabase: vi.fn(),
    },
    getDataStoreRuntimeStatus: vi.fn(() => ({
      running: true,
      port: 19731,
      dbSize: 0,
      tableCount: 0,
      dbDirectoryPath: "/data",
    })),
    collectOpsStatus: vi.fn(async () => ({
      appVersion: "0.2.49",
      singleInstanceLocked: true,
      logPath: "/logs",
    })),
    getCliDebugInfo: vi.fn(async () => ({
      status: { available: true },
    })),
    getMcpHttpStatus: vi.fn(() => ({
      running: false,
      port: 0,
      url: "",
    })),
    getMcpServers: vi.fn(() => []),
    permissionGuard: {
      check: vi.fn(async () => ({ allowed: true as const })),
      registerPolicy: vi.fn(),
    },
    auditSink: {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    },
    logger: createLogger(),
    now: () => new Date("2026-04-29T03:31:20.000Z"),
    platformInfo: () => ({
      platform: "darwin",
      arch: "arm64",
      release: "25.0.0",
      node: "v25.6.0",
      chrome: "143.0.0",
      electron: "41.2.1",
      pid: 123,
      hostname: "synapse-test",
      totalMemoryBytes: 1024,
      freeMemoryBytes: 512,
      uptimeSeconds: 10,
      cpuCount: 8,
    }),
    statPath: vi.fn(async () => ({ isDirectory: () => true })),
    writeReadDeleteProbe: vi.fn(async () => undefined),
    chooseSavePath: vi.fn(async () => "/downloads/synapse-diagnostics.zip"),
    makeTempDir: vi.fn(async () => "/tmp/synapse-diagnostics-test"),
    writeTextFile: vi.fn(async () => undefined),
    copyFile: vi.fn(async () => undefined),
    createZipArchive: vi.fn(async () => undefined),
    removePath: vi.fn(async () => undefined),
    createConfigBackupPayload: vi.fn(async () => ({
      schemaVersion: 1,
      exportedAt: "2026-04-29T03:31:20.000Z",
      config: {
        activeRepoUuid: null,
        repositories: [],
        global: {
          themeMode: "system",
          projects: [],
          favorites: { rule: [], skill: [], prompt: [] },
          recentlyViewed: { rule: [], skill: [], prompt: [] },
          contentSortOrder: "modified-desc",
        },
      },
      identity: {
        schemaVersion: 2,
        userId: "0123456789abcdef0123456789abcdef",
        generatedAt: "2026-04-29T03:31:20.000Z",
      },
    })),
    ...overrides,
  })
}

function createConfig(): SynapseConfig {
  return {
    activeRepoUuid: "repo-1",
    repositories: [{
      uuid: "repo-1",
      name: "Repo",
      localPath: "/repo",
      contentDirs: {},
    }],
    global: {
      themeMode: "system",
      projects: [{ id: "project-1", name: "Project", path: "/missing-project" }],
      favorites: { rule: [], skill: [], prompt: [] },
      recentlyViewed: { rule: [], skill: [], prompt: [] },
      contentSortOrder: "modified-desc",
    },
  }
}

function createLogger() {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  }

  return logger
}
