import { describe, expect, it, vi } from "vitest"

import type { SynapseConfig } from "../../../src/types/config"
import type { SynapseDiagnosticsCheck } from "../../../src/types/diagnostics"
import {
  DiagnosticsService,
  summarizeDiagnosticsChecks,
  summarizeLogSignals,
  summarizeServiceLifecycle,
} from "../diagnostics-service"
import { summarizeWindowsCompatibilityLogSignals } from "../windows-compatibility"

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
      id: "database.mcp",
      group: "Database",
      name: "MCP",
      status: "degraded",
      severity: "warning",
      message: "MCP HTTP 未运行",
    }]

    expect(summarizeDiagnosticsChecks(checks).overallStatus).toBe("degraded")
  })
})

describe("summarizeLogSignals", () => {
  it("counts recent warning and error log lines", () => {
    expect(summarizeLogSignals([
      "[2026-04-29T03:11:18.063Z] [WARN ] AgentRuntime queued turn failed.",
      "{ error: 'write EPIPE' }",
      "[2026-04-29T03:11:20.000Z] [INFO ] ok",
    ].join("\n"))).toEqual({
      warningCount: 1,
      errorCount: 1,
      samples: [
        "[2026-04-29T03:11:18.063Z] [WARN ] AgentRuntime queued turn failed.",
        "{ error: 'write EPIPE' }",
      ],
    })
  })
})

describe("summarizeWindowsCompatibilityLogSignals", () => {
  it("extracts Windows compatibility signals from recent logs", () => {
    expect(summarizeWindowsCompatibilityLogSignals([
      "[2026-04-29T03:11:18.063Z] [ERROR] spawn codex.cmd ENOENT",
      "[2026-04-29T03:11:19.000Z] [WARN ] powershell.exe Compress-Archive failed",
      "[2026-04-29T03:11:20.000Z] [INFO ] ok",
    ].join("\n"))).toMatchObject({
      signalCount: 2,
      errorCount: 1,
      warningCount: 1,
      keywords: expect.arrayContaining(["powershell", "spawn"]),
    })
  })

  it("does not treat normal compatibility snapshots as failures", () => {
    expect(summarizeWindowsCompatibilityLogSignals([
      "[2026-04-29T03:11:18.063Z] [INFO ] [main:windows.compatibility] Windows compatibility snapshot captured.",
      "{ platform: 'win32', pathKey: 'Path', pathEntryCount: 12 }",
    ].join("\n"))).toMatchObject({
      signalCount: 0,
      errorCount: 0,
      warningCount: 0,
      keywords: [],
    })
  })
})

describe("summarizeServiceLifecycle", () => {
  it("extracts startup timing and restart traces from lifecycle logs", () => {
    const summary = summarizeServiceLifecycle([
      "[2026-04-29T03:31:20.000Z] [INFO ] [main:main] Electron app is ready. Initializing IPC registry.",
      "[2026-04-29T03:31:20.100Z] [INFO ] [main:database] Database HTTP server ready.",
      "[2026-04-29T03:31:20.200Z] [INFO ] [main:database] MCP HTTP server ready.",
      "[2026-04-29T03:31:20.300Z] [INFO ] [main:database] Database initialized.",
      "[2026-04-29T03:31:20.500Z] [INFO ] [main:main] Service registry started. Creating main window.",
      "[2026-04-29T03:31:20.800Z] [INFO ] [main:bootstrap.main-window] Main window is ready to show.",
      "[2026-04-29T03:31:21.000Z] [INFO ] [renderer:renderer.bootstrap] Renderer bootstrap started.",
      "[2026-04-29T03:31:21.200Z] [INFO ] [renderer:app] App mounted.",
      "[2026-04-29T03:32:00.000Z] [INFO ] [main:database] Database shut down.",
    ].join("\n"))

    expect(summary.runCount).toBe(1)
    expect(summary.shutdownCount).toBe(1)
    expect(summary.latestStartedAt).toBe("2026-04-29T03:31:20.000Z")
    expect(summary.latestStartupDurationsMs).toMatchObject({
      electronReady: 0,
      databaseHttpReady: 100,
      mcpHttpReady: 200,
      databaseInitialized: 300,
      serviceRegistryStarted: 500,
      mainWindowReady: 800,
      rendererBootstrapStarted: 1000,
      appMounted: 1200,
    })
    expect(summary.restartTrace).toBe(true)
    expect(summary.rendererRestartTrace).toBe(false)
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
    expect(report.system.macCompatibility).toEqual(expect.objectContaining({
      platform: "darwin",
      runningOnMac: true,
    }))
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

  it("surfaces recent log warnings, database health, and mcp probe", async () => {
    const service = createService({
      logStore: {
        getLogDirectory: () => "/logs",
        listLogFilesInfo: vi.fn(async () => [{ name: "synapse.log", sizeBytes: 100 }]),
        readLogsByNames: vi.fn(async () => "[2026-04-29T03:11:18.063Z] [WARN ] AgentRuntime queued turn failed."),
        flush: vi.fn(async () => undefined),
      },
      getMcpHttpStatus: vi.fn(() => ({
        running: true,
        port: 23578,
        url: "http://127.0.0.1:23578/mcp",
      })),
      getMcpServers: vi.fn(() => [{
        target: "codex",
        settingsPath: "/config",
        settingsFileExists: true,
        registered: true,
        mode: "http" as const,
        url: "http://127.0.0.1:23578/mcp",
      }]),
      probeMcpHttp: vi.fn(async () => ({ ok: true, method: "ping", status: 200 })),
    })

    const report = await service.collect()

    expect(report.overallStatus).toBe("degraded")
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "logs.recent-signals",
        status: "degraded",
      }),
      expect.objectContaining({
        id: "database.integrity",
        status: "ok",
      }),
      expect.objectContaining({
        id: "database.mcp",
        status: "ok",
      }),
    ]))
  })

  it("reports App PATH, login shell PATH, and node visibility", async () => {
    const service = createService({
      collectShellEnvironment: vi.fn(() => ({
        processPath: "/usr/bin:/bin",
        shellPath: "/opt/homebrew/bin:/usr/bin",
        effectivePath: "/usr/bin:/bin:/opt/homebrew/bin:/synapse/runtime-bin",
        processNodePath: null,
        shellNodePath: "/opt/homebrew/bin/node",
        effectiveNodePath: "/opt/homebrew/bin/node",
        nodeRuntimeBinPath: "/synapse/runtime-bin",
      })),
    })

    const report = await service.collect()
    const check = report.checks.find((item) => item.id === "system.node-visibility")

    expect(check).toMatchObject({
      status: "ok",
      group: "系统",
      name: "Node 可见性",
      details: {
        "App PATH": "/usr/bin:/bin",
        "Login Shell PATH": "/opt/homebrew/bin:/usr/bin",
        "App PATH 中的 node": null,
        "Login Shell 中的 node": "/opt/homebrew/bin/node",
        "最终可用 node": "/opt/homebrew/bin/node",
      },
    })
  })

  it("surfaces Agent runtime log signals without raw prompt or auth details", async () => {
    const service = createService({
      logStore: {
        getLogDirectory: () => "/logs",
        listLogFilesInfo: vi.fn(async () => [{ name: "synapse.log", sizeBytes: 100 }]),
        readLogsByNames: vi.fn(async () => [
          "[2026-04-29T03:11:18.063Z] [WARN ] [main:service.agent-runtime] AgentRuntime queued turn failed.",
          "{ conversationId: 'conversation-1', sdkSessionId: 'sdk-1', taskId: 'task-1', runId: 'run-1', prompt: 'secret prompt', authorization: 'Bearer secret' }",
          "[2026-04-29T03:11:19.000Z] [ERROR] [main:service.task-scheduler.execution] Scheduled Agent action failed. sdkSessionId=sdk-2",
        ].join("\n")),
        flush: vi.fn(async () => undefined),
      },
    })

    const report = await service.collect()
    const check = report.checks.find((item) => item.id === "logs.agent-runtime")

    expect(check).toMatchObject({
      status: "degraded",
      details: {
        signalCount: 3,
        warningCount: 2,
        errorCount: 1,
        boundaries: expect.arrayContaining(["agent-runtime", "task-scheduler"]),
        components: expect.arrayContaining(["main:service.agent-runtime", "main:service.task-scheduler.execution"]),
        correlation: {
          conversationId: 1,
          sdkSessionId: 2,
          taskId: 1,
          runId: 1,
        },
      },
    })
    const details = JSON.stringify(check?.details)
    expect(details).not.toContain("secret prompt")
    expect(details).not.toContain("Bearer secret")
  })

  it("adds Windows compatibility checks to the report", async () => {
    const service = createService({
      appInfo: {
        getAppPath: () => "C:\\Program Files\\Synapse",
        getLocale: () => "zh-CN",
        getName: () => "Synapse",
        getVersion: () => "0.2.49",
        hasSingleInstanceLock: () => true,
        isPackaged: true,
        getPath: (name) => {
          if (name === "userData") return "C:\\Program Files\\Synapse\\data"
          if (name === "temp") return "C:\\Users\\Ada Lovelace\\AppData\\Local\\Temp"
          if (name === "downloads") return "C:\\Users\\Ada Lovelace\\Downloads"
          return `C:\\Users\\Ada Lovelace\\${name}`
        },
      },
      database: {
        getDbPath: () => "C:\\Program Files\\Synapse\\data\\synapse-database.db",
        getDbSize: () => 0,
        getDiagnosticsHealth: () => ({
          quickCheck: "ok",
          metaTableCount: 0,
          metaColumnCount: 0,
          operationLogCount: 0,
        }),
        getTableCount: () => 0,
        exportDatabase: vi.fn(),
      },
      platformInfo: () => ({
        platform: "win32",
        arch: "x64",
        release: "10.0.22631",
        node: "v25.6.0",
        chrome: "143.0.0",
        electron: "41.2.1",
        pid: 123,
      }),
    })

    const report = await service.collect()

    expect(report.system.windowsCompatibility).toEqual(expect.objectContaining({
      platform: "win32",
      runningOnWindows: true,
    }))
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "windows.environment",
        group: "Windows 兼容性",
      }),
      expect.objectContaining({
        id: "windows.writable-data",
        status: "degraded",
      }),
      expect.objectContaining({
        id: "windows.configured-paths",
        status: "degraded",
      }),
    ]))
  })
})

describe("DiagnosticsService.exportBundle", () => {
  it("writes diagnostics package files and records allowed export", { timeout: 15_000 }, async () => {
    const writtenFiles = new Map<string, string>()
    const auditSink = {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    }
    const service = createService({
      auditSink,
      writeTextFile: vi.fn(async (targetPath: string, content: string) => {
        writtenFiles.set(targetPath.replace(/\\/g, "/"), content)
      }),
    })
    const report = await service.collect()

    const result = await service.exportBundle({ report })

    const resultPath = (result as { filePath?: string }).filePath?.replace(/\\/g, "/")
    expect(result).toEqual({
      success: true,
      filePath: expect.any(String),
      fileCount: expect.any(Number),
    })
    expect(resultPath).toContain("synapse-diagnostics.zip")
    const packagePathSuffix = "/synapse-diagnostics-test/synapse-diagnostics-2026-04-29T03-31-20-000Z"
    const diagnosticsPath = findWrittenPath(writtenFiles, `${packagePathSuffix}/diagnostics.json`)
    expect(diagnosticsPath).toBeDefined()
    expect(writtenFiles.get(diagnosticsPath ?? ""))
      .not.toContain("/downloads/synapse-diagnostics.zip")
    expect(writtenFiles.get(findWrittenPath(writtenFiles, `${packagePathSuffix}/summary.md`) ?? ""))
      .toContain("# Synapse Diagnostics Summary")
    expect(findWrittenPath(writtenFiles, `${packagePathSuffix}/manifest.json`)).toBeDefined()
    expect(findWrittenPath(writtenFiles, `${packagePathSuffix}/config/config-backup.json`)).toBeDefined()
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

  it("records failed exports without raw error text in audit metadata", async () => {
    const rawError = "zip failed token=sk-secret at /Users/example/private/report.zip"
    const auditSink = {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    }
    const service = createService({
      auditSink,
      createZipArchive: vi.fn(async () => {
        throw new Error(rawError)
      }),
    })
    const report = await service.collect()

    await expect(service.exportBundle({ report })).rejects.toThrow(rawError)

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "failed",
      metadata: expect.objectContaining({
        source: "ops.exportDiagnosticsBundle",
        errorName: "Error",
        errorLength: rawError.length,
      }),
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("/Users/example/private")
  })

  it("does not use renderer-provided generatedAt for staging paths", { timeout: 15_000 }, async () => {
    const writtenFiles = new Map<string, string>()
    const service = createService({
      writeTextFile: vi.fn(async (targetPath: string, content: string) => {
        writtenFiles.set(targetPath.replace(/\\/g, "/"), content)
      }),
    })
    const report = {
      ...(await service.collect()),
      generatedAt: "../outside",
    }

    await service.exportBundle({ report })

    expect([...writtenFiles.keys()].every((targetPath) => (
      targetPath.includes("/synapse-diagnostics-test/synapse-diagnostics-2026-04-29T03-31-20-000Z/")
    ))).toBe(true)
    expect([...writtenFiles.keys()].some((targetPath) => targetPath.includes("../outside"))).toBe(false)
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
      readLogsByNames: vi.fn(async () => ""),
      flush: vi.fn(async () => undefined),
    },
    database: {
      getDbPath: () => "/data/synapse-database.db",
      getDbSize: () => 0,
      getDiagnosticsHealth: () => ({
        quickCheck: "ok",
        metaTableCount: 0,
        metaColumnCount: 0,
        operationLogCount: 0,
      }),
      getTableCount: () => 0,
      exportDatabase: vi.fn(),
    },
    getDatabaseRuntimeStatus: vi.fn(() => ({
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
    getMcpHttpStatus: vi.fn(() => ({
      running: false,
      port: 0,
      url: "",
    })),
    getMcpServers: vi.fn(() => []),
    probeMcpHttp: vi.fn(async () => ({ ok: false, method: "ping", error: "MCP HTTP 未运行" })),
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

function findWrittenPath(files: Map<string, string>, suffix: string): string | undefined {
  return [...files.keys()].find((targetPath) => targetPath.endsWith(suffix))
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
      quickInputs: [],
      favorites: { rule: [], skill: [], prompt: [] },
      recentlyViewed: { rule: [], skill: [], prompt: [] },
      contentSortOrder: "modified-desc",
    },
    agent: {
      defaultPermissionMode: "default",
      defaultProviderModel: null,
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
