import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => `/app/${name}`),
    getAppPath: vi.fn(() => "/app"),
    getLocale: vi.fn(() => "zh-CN"),
    getName: vi.fn(() => "Synapse"),
    getVersion: vi.fn(() => "0.2.49"),
    hasSingleInstanceLock: vi.fn(() => true),
    isPackaged: false,
  },
  dialog: {},
}))

import { DEFAULT_AGENT_GLOBAL_CONFIG } from "../../../src/constants/defaults"
import { DEFAULT_DOCK_APP_IDS } from "../../../src/modules/apps/dock"
import type { SynapseConfig } from "../../../src/types/config"
import type { SynapseDiagnosticsCheck } from "../../../src/types/diagnostics"
import type { PackagedClaudeRuntimeStatus } from "../agent-runtime/claude-runtime-binary"
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

  it("redacts sensitive values from recent log samples", () => {
    const summary = summarizeLogSignals([
      "[2026-04-29T03:11:18.063Z] [WARN ] failed Authorization: Bearer raw-bearer Cookie: session=raw-cookie token=raw-token at /Users/liyang/project/file.ts",
    ].join("\n"))
    const serialized = JSON.stringify(summary.samples)

    expect(serialized).toContain("/Users/liyang/project/file.ts")
    expect(serialized).not.toContain("raw-bearer")
    expect(serialized).not.toContain("raw-cookie")
    expect(serialized).not.toContain("raw-token")
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

  it("redacts sensitive values from Windows compatibility log samples", () => {
    const summary = summarizeWindowsCompatibilityLogSignals([
      "[2026-04-29T03:11:18.063Z] [ERROR] spawn codex.cmd ENOENT Authorization: Bearer raw-bearer token=raw-token at C:\\Users\\liyang\\project\\file.ts",
    ].join("\n"))
    const serialized = JSON.stringify(summary.samples)

    expect(serialized).toContain("C:\\\\Users\\\\liyang\\\\project\\\\file.ts")
    expect(serialized).not.toContain("raw-bearer")
    expect(serialized).not.toContain("raw-token")
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

  it("redacts sensitive values from lifecycle samples", () => {
    const summary = summarizeServiceLifecycle([
      "[2026-04-29T03:31:20.000Z] [INFO ] [main:main] Electron app is ready. Initializing IPC registry. Authorization: Bearer raw-bearer token=raw-token at /Users/liyang/project/file.ts",
    ].join("\n"))
    const serialized = JSON.stringify(summary.samples)

    expect(serialized).toContain("/Users/liyang/project/file.ts")
    expect(serialized).not.toContain("raw-bearer")
    expect(serialized).not.toContain("raw-token")
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

  it("records Codex process and config timing in MCP diagnostics", async () => {
    const service = createService({
      getMcpHttpStatus: vi.fn(() => ({
        running: true,
        port: 23578,
        url: "http://127.0.0.1:23578/mcp",
      })),
      getMcpServers: vi.fn(() => [{
        target: "codex",
        settingsPath: "/Users/lcj/.codex/config.toml",
        settingsFileExists: true,
        registered: true,
        mode: "http" as const,
        url: "http://127.0.0.1:23578/mcp",
      }]),
      probeMcpHttp: vi.fn(async () => ({ ok: true, method: "ping", status: 200 })),
      collectCodexRuntimeDiagnostics: vi.fn(async () => ({
        settingsPath: "/Users/lcj/.codex/config.toml",
        settingsFileExists: true,
        settingsModifiedAt: "2026-06-15T00:42:59.000Z",
        settingsModifiedMs: 1781484179000,
        processes: [{
          pid: 19501,
          command: "/Applications/Codex.app/Contents/MacOS/Codex",
          startedAt: "2026-06-14T07:00:00.000Z",
          startedAtMs: 1781420400000,
        }],
        processStartedBeforeConfigModified: true,
        warning: "Codex 进程/会话早于 MCP 配置修改，旧会话可能未加载 Synapse MCP。",
      })),
    })

    const report = await service.collect()
    const check = report.checks.find((item) => item.id === "database.mcp")

    expect(check).toMatchObject({
      status: "ok",
      details: {
        codexRuntime: {
          settingsPath: "/Users/lcj/.codex/config.toml",
          settingsModifiedAt: "2026-06-15T00:42:59.000Z",
          processStartedBeforeConfigModified: true,
          warning: "Codex 进程/会话早于 MCP 配置修改，旧会话可能未加载 Synapse MCP。",
        },
      },
    })
  })

  it("degrades MCP diagnostics when Codex process listing fails", async () => {
    const service = createService({
      getMcpHttpStatus: vi.fn(() => ({
        running: true,
        port: 23578,
        url: "http://127.0.0.1:23578/mcp",
      })),
      getMcpServers: vi.fn(() => [{
        target: "codex",
        settingsPath: "/Users/lcj/.codex/config.toml",
        settingsFileExists: true,
        registered: true,
        mode: "http" as const,
        url: "http://127.0.0.1:23578/mcp",
      }]),
      probeMcpHttp: vi.fn(async () => ({ ok: true, method: "ping", status: 200 })),
      collectCodexRuntimeDiagnostics: vi.fn(async () => ({
        settingsPath: "/Users/lcj/.codex/config.toml",
        settingsFileExists: true,
        processes: [],
        processStartedBeforeConfigModified: false,
        processListError: "process list unavailable",
      })),
    })

    const report = await service.collect()
    const check = report.checks.find((item) => item.id === "database.mcp")

    expect(check).toMatchObject({
      status: "degraded",
      severity: "warning",
      message: "Codex 运行态检查失败",
      details: {
        codexRuntime: {
          processListError: "process list unavailable",
        },
      },
    })
  })

  it("uses PowerShell to collect Codex processes on Windows", async () => {
    const diagnosticsModule = await import("../diagnostics-service")
    const collectCodexProcesses = (diagnosticsModule as {
      collectCodexProcesses?: (input: {
        readonly platform: NodeJS.Platform
        readonly execFile: (
          file: string,
          args: readonly string[],
          options: { readonly timeout: number },
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => void
      }) => Promise<{ processes: Array<{ pid: number; command: string; startedAt?: string; startedAtMs?: number }> }>
    }).collectCodexProcesses

    expect(collectCodexProcesses).toBeTypeOf("function")

    const execFileMock = vi.fn((file, args, options, callback) => {
      callback(null, JSON.stringify({
        pid: 4512,
        command: "C:\\Users\\Ada Lovelace\\AppData\\Local\\Programs\\Codex\\Codex.exe exec \"review my private acquisition plan\" --prompt secret-prompt apiKey=plain-secret",
        startedAt: "2026-06-14T07:00:00.000Z",
      }), "")
    })

    const result = await collectCodexProcesses!({
      platform: "win32",
      execFile: execFileMock,
    })

    expect(execFileMock).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-NoProfile", "-NonInteractive", "-Command"]),
      expect.objectContaining({ timeout: 3000 }),
      expect.any(Function),
    )
    expect(execFileMock.mock.calls[0]?.[1].at(-1)).not.toContain("??")
    expect(result.processes).toHaveLength(1)
    expect(result.processes[0]).toMatchObject({
      pid: 4512,
      command: "C:\\Users\\Ada Lovelace\\AppData\\Local\\Programs\\Codex\\Codex.exe [args redacted]",
      startedAt: "2026-06-14T07:00:00.000Z",
      startedAtMs: Date.parse("2026-06-14T07:00:00.000Z"),
    })
    expect(result.processes[0]?.command).not.toContain("private acquisition")
    expect(result.processes[0]?.command).not.toContain("secret-prompt")
    expect(result.processes[0]?.command).not.toContain("plain-secret")
  })

  it("redacts Codex process prompt arguments on POSIX", async () => {
    const diagnosticsModule = await import("../diagnostics-service")
    const collectCodexProcesses = (diagnosticsModule as {
      collectCodexProcesses?: (input: {
        readonly platform: NodeJS.Platform
        readonly execFile: (
          file: string,
          args: readonly string[],
          options: { readonly timeout: number },
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => void
      }) => Promise<{ processes: Array<{ pid: number; command: string; startedAtText?: string }> }>
    }).collectCodexProcesses

    const stdout = [
      "19501 Sun Jun 14 07:00:00 2026 /opt/homebrew/bin/codex exec \"summarize my private roadmap\" --prompt secret-prompt",
      "19502 Sun Jun 14 07:01:00 2026 /Applications/Codex.app/Contents/MacOS/Codex",
    ].join("\n")
    const execFileMock = vi.fn((file, args, options, callback) => {
      callback(null, stdout, "")
    })

    const result = await collectCodexProcesses!({
      platform: "darwin",
      execFile: execFileMock,
    })

    expect(result.processes).toEqual([
      expect.objectContaining({
        pid: 19501,
        command: "/opt/homebrew/bin/codex [args redacted]",
        startedAtText: "Sun Jun 14 07:00:00 2026",
      }),
      expect.objectContaining({
        pid: 19502,
        command: "/Applications/Codex.app/Contents/MacOS/Codex",
      }),
    ])
    expect(JSON.stringify(result.processes)).not.toContain("private roadmap")
    expect(JSON.stringify(result.processes)).not.toContain("secret-prompt")
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
        processGitPath: "/usr/bin/git",
        shellGitPath: "/opt/homebrew/bin/git",
        effectiveGitPath: "/usr/bin/git",
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

  it("reports Git visibility with a version probe", async () => {
    const service = createService({
      collectShellEnvironment: vi.fn(() => ({
        processPath: "/usr/bin:/bin",
        shellPath: "/opt/homebrew/bin:/usr/bin",
        effectivePath: "/usr/bin:/bin:/opt/homebrew/bin",
        processNodePath: null,
        shellNodePath: null,
        effectiveNodePath: "/usr/bin/node",
        processGitPath: "/usr/bin/git",
        shellGitPath: "/opt/homebrew/bin/git",
        effectiveGitPath: "/usr/bin/git",
        nodeRuntimeBinPath: null,
      })),
      probeGitVersion: vi.fn(async () => ({ ok: true, version: "git version 2.45.0" })),
    } as Partial<ConstructorParameters<typeof DiagnosticsService>[0]>)

    const report = await service.collect()
    const check = report.checks.find((item) => item.id === "system.git-visibility")

    expect(check).toMatchObject({
      status: "ok",
      group: "系统",
      name: "Git 可见性",
      message: "Git 可用",
      details: {
        "最终可用 git": "/usr/bin/git",
        version: "git version 2.45.0",
      },
    })
  })

  it("degrades Git visibility when git cannot be executed", async () => {
    const service = createService({
      collectShellEnvironment: vi.fn(() => ({
        processPath: "/usr/bin:/bin",
        shellPath: null,
        effectivePath: "/usr/bin:/bin",
        processNodePath: null,
        shellNodePath: null,
        effectiveNodePath: "/usr/bin/node",
        processGitPath: "/usr/bin/git",
        shellGitPath: null,
        effectiveGitPath: "/usr/bin/git",
        nodeRuntimeBinPath: null,
      })),
      probeGitVersion: vi.fn(async () => ({ ok: false, error: "xcrun: invalid active developer path" })),
    } as Partial<ConstructorParameters<typeof DiagnosticsService>[0]>)

    const report = await service.collect()
    const check = report.checks.find((item) => item.id === "system.git-visibility")

    expect(check).toMatchObject({
      status: "degraded",
      group: "系统",
      name: "Git 可见性",
      message: "Git 不可执行",
      details: {
        "最终可用 git": "/usr/bin/git",
        error: "xcrun: invalid active developer path",
      },
    })
  })

  it("checks managed knowledge base projects through their backing directory", async () => {
    const backingPath = path.join("/app/userData", "knowledge-bases", "kb-1")
    const statPath = vi.fn(async (targetPath: string) => {
      if (targetPath === backingPath || targetPath === "/repo") {
        return { isDirectory: () => true }
      }
      throw new Error(`unexpected stat path: ${targetPath}`)
    })
    const service = createService({
      configStore: {
        load: vi.fn(async () => createConfig({
          projects: [{
            id: "kb-1",
            name: "个人知识库",
            path: "synapse-kb://kb-1",
            capabilities: {
              knowledgeBase: {
                enabled: true,
                managed: true,
                runtimeId: "kb-1",
                schemaVersion: 1,
                templateVersion: "2026-05-21",
              },
            },
          }],
        })),
      },
      statPath,
    })

    const report = await service.collect({ projectId: "kb-1" })
    const check = report.checks.find((item) => item.id === "project.path.kb-1")

    expect(statPath).toHaveBeenCalledWith(backingPath)
    expect(check).toMatchObject({
      status: "ok",
      message: "目录可访问",
      details: {
        path: "synapse-kb://kb-1",
        resolvedPath: backingPath,
      },
    })
  })

  it("uses managed knowledge base backing directories for configured path diagnostics", async () => {
    const service = createService({
      configStore: {
        load: vi.fn(async () => createConfig({
          projects: [{
            id: "kb-1",
            name: "个人知识库",
            path: "synapse-kb://kb-1",
            capabilities: {
              knowledgeBase: {
                enabled: true,
                managed: true,
                runtimeId: "kb-1",
                schemaVersion: 1,
                templateVersion: "2026-05-21",
              },
            },
          }],
        })),
      },
    })

    const report = await service.collect({ projectId: "kb-1" })
    const check = report.checks.find((item) => item.id === "windows.configured-paths")
    const details = check?.details as {
      entries: Array<{ id: string; path: string; unsafeSegments: string[] }>
    } | undefined
    const entry = details?.entries.find((item) => item.id === "kb-1")

    expect(entry).toMatchObject({
      path: path.join("/app/userData", "knowledge-bases", "kb-1"),
      unsafeSegments: [],
    })
  })

  it("reports custom knowledge base storage status", async () => {
    const service = createService({
      configStore: {
        load: vi.fn(async () => createConfig({
          knowledgeBaseStorage: {
            mode: "custom",
            rootPath: "/Volumes/Data/SynapseData",
          },
        })),
      },
      statPath: vi.fn(async () => ({ isDirectory: () => true })),
    })

    const report = await service.collect()

    expect(report.knowledgeBaseStorage).toMatchObject({
      mode: "custom",
      available: true,
      rootPath: path.resolve("/Volumes/Data/SynapseData"),
      knowledgeBasesPath: path.join(path.resolve("/Volumes/Data/SynapseData"), "knowledge-bases"),
      runtimeCount: 0,
      missingRuntimeCount: 0,
      oldAbsoluteReferenceCount: 0,
    })
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "knowledge-base.storage",
        status: "ok",
      }),
    ]))
  })

  it("reports old absolute path references without rewriting files", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "synapse-diagnostics-kb-"))
    const userDataPath = path.join(tempRoot, "userData")
    const customRootPath = path.join(tempRoot, "custom")
    const runtimePath = path.join(customRootPath, "knowledge-bases", "kb-1")
    const wikiPath = path.join(runtimePath, "wiki", "index.md")
    const oldReference = path.join(userDataPath, "knowledge-bases", "kb-1", "wiki", "old.md")

    await mkdir(path.dirname(wikiPath), { recursive: true })
    await writeFile(wikiPath, oldReference, "utf8")

    try {
      const service = createService({
        appInfo: {
          getAppPath: () => "/app",
          getLocale: () => "zh-CN",
          getName: () => "Synapse",
          getVersion: () => "0.2.49",
          hasSingleInstanceLock: () => true,
          isPackaged: false,
          getPath: (name) => {
            if (name === "userData") return userDataPath
            return `/app/${name}`
          },
        },
        configStore: {
          load: vi.fn(async () => createConfig({
            knowledgeBaseStorage: {
              mode: "custom",
              rootPath: customRootPath,
            },
            projects: [{
              id: "kb-1",
              name: "个人知识库",
              path: "synapse-kb://kb-1",
              capabilities: {
                knowledgeBase: {
                  enabled: true,
                  managed: true,
                  runtimeId: "kb-1",
                  schemaVersion: 1,
                  templateVersion: "2026-05-21",
                },
              },
            }],
          })),
        },
      })

      const report = await service.collect()

      expect(report.knowledgeBaseStorage?.oldAbsoluteReferenceCount).toBe(1)
      await expect(readFile(wikiPath, "utf8")).resolves.toContain(oldReference)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("stops scanning knowledge base text after detecting an old absolute reference", async () => {
    const userDataPath = "/app/userData"
    const customRootPath = "/Volumes/Data/SynapseData"
    const oldReference = path.join(userDataPath, "knowledge-bases", "kb-1", "wiki", "old.md")
    const readTextFile = vi.fn(async (filePath: string) => {
      if (filePath.endsWith(path.join("wiki", "page-001.md"))) return oldReference
      return "new content"
    })
    const service = createService({
      appInfo: createAppInfo({ userDataPath }),
      configStore: {
        load: vi.fn(async () => createConfig({
          knowledgeBaseStorage: {
            mode: "custom",
            rootPath: customRootPath,
          },
          projects: [createManagedKnowledgeBaseProject("kb-1")],
        })),
      },
      readDirectory: vi.fn(async () => Array.from({ length: 100 }, (_, index) => createFileEntry(
        `page-${String(index + 1).padStart(3, "0")}.md`,
      ))),
      readTextFile,
      statPath: vi.fn(async () => ({ isDirectory: () => true, size: 128 })),
    })

    const report = await service.collect()

    expect(report.knowledgeBaseStorage?.oldAbsoluteReferenceCount).toBe(1)
    expect(readTextFile).toHaveBeenCalledWith(path.join(
      customRootPath,
      "knowledge-bases",
      "kb-1",
      "wiki",
      "page-001.md",
    ))
    expect(readTextFile).not.toHaveBeenCalledWith(path.join(
      customRootPath,
      "knowledge-bases",
      "kb-1",
      "wiki",
      "page-100.md",
    ))
  })

  it("bounds knowledge base old path diagnostics when no reference is found", async () => {
    const customRootPath = "/Volumes/Data/SynapseData"
    const readTextFile = vi.fn(async () => "new content")
    const service = createService({
      appInfo: createAppInfo({ userDataPath: "/app/userData" }),
      configStore: {
        load: vi.fn(async () => createConfig({
          knowledgeBaseStorage: {
            mode: "custom",
            rootPath: customRootPath,
          },
          projects: [createManagedKnowledgeBaseProject("kb-1")],
        })),
      },
      readDirectory: vi.fn(async () => Array.from({ length: 100 }, (_, index) => createFileEntry(
        `page-${String(index + 1).padStart(3, "0")}.md`,
      ))),
      readTextFile,
      statPath: vi.fn(async () => ({ isDirectory: () => true, size: 128 })),
    })

    const report = await service.collect()

    expect(report.knowledgeBaseStorage?.oldAbsoluteReferenceCount).toBe(0)
    expect(readTextFile.mock.calls.length).toBeLessThanOrEqual(64)
  })

  it("reports packaged Claude runtime as available", async () => {
    const service = createService({
      appInfo: {
        getAppPath: () => "/Applications/Synapse.app/Contents/Resources/app.asar",
        getLocale: () => "zh-CN",
        getName: () => "Synapse",
        getVersion: () => "0.2.49",
        hasSingleInstanceLock: () => true,
        isPackaged: true,
        getPath: (name) => `/app/${name}`,
      },
      inspectClaudeRuntime: vi.fn((): PackagedClaudeRuntimeStatus => ({
        status: "present",
        resourcesPath: "/Applications/Synapse.app/Contents/Resources",
        platform: "darwin",
        arch: "arm64",
        expectedPackages: ["@anthropic-ai/claude-agent-sdk-darwin-arm64"],
        expectedPaths: [
          "/Applications/Synapse.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
        ],
        packageName: "@anthropic-ai/claude-agent-sdk-darwin-arm64",
        binaryName: "claude",
        executablePath: "/Applications/Synapse.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
      })),
    })

    const report = await service.collect()
    const check = report.checks.find((item) => item.id === "app.claude-runtime")

    expect(check).toMatchObject({
      status: "ok",
      group: "应用",
      name: "Claude runtime",
      details: {
        appVersion: "0.2.49",
        isPackaged: true,
        status: "present",
        packageName: "@anthropic-ai/claude-agent-sdk-darwin-arm64",
        binaryName: "claude",
      },
    })
  })

  it("fails diagnostics when packaged Claude runtime is missing", async () => {
    const service = createService({
      appInfo: {
        getAppPath: () => "/Applications/Synapse.app/Contents/Resources/app.asar",
        getLocale: () => "zh-CN",
        getName: () => "Synapse",
        getVersion: () => "0.2.49",
        hasSingleInstanceLock: () => true,
        isPackaged: true,
        getPath: (name) => `/app/${name}`,
      },
      inspectClaudeRuntime: vi.fn((): PackagedClaudeRuntimeStatus => ({
        status: "missing",
        resourcesPath: "/Applications/Synapse.app/Contents/Resources",
        platform: "darwin",
        arch: "arm64",
        expectedPackages: ["@anthropic-ai/claude-agent-sdk-darwin-arm64"],
        expectedPaths: [
          "/Applications/Synapse.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
        ],
        binaryName: "claude",
      })),
    })

    const report = await service.collect()
    const check = report.checks.find((item) => item.id === "app.claude-runtime")

    expect(report.overallStatus).toBe("failed")
    expect(check).toMatchObject({
      status: "failed",
      message: "内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。",
      details: {
        appVersion: "0.2.49",
        isPackaged: true,
        status: "missing",
        expectedPackages: ["@anthropic-ai/claude-agent-sdk-darwin-arm64"],
        binaryName: "claude",
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
          "[2026-04-29T03:11:19.000Z] [ERROR] [main:automation-ingress] Automation Agent action failed. sdkSessionId=sdk-2",
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
        boundaries: expect.arrayContaining(["agent-runtime", "automation-ingress"]),
        components: expect.arrayContaining(["main:service.agent-runtime", "main:automation-ingress"]),
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
      configStore: {
        load: vi.fn(async () => {
          const config = createConfig({
            knowledgeBaseStorage: { mode: "custom", rootPath: "/secret/kb-root" },
          })
          return config
        }),
      },
      dataRepository: {
        inspect: () => [{
          namespace: "app.secrets.items",
          backend: "encrypted-json",
          schemaVersion: 1,
        }],
        namespace: vi.fn(() => ({
          list: vi.fn(async () => [{
            id: "secret-1",
            schemaVersion: 1 as const,
            name: "API_TOKEN",
            value: "sk-secret-value",
            description: "api",
            createdAt: "2026-07-09T00:00:00.000Z",
            updatedAt: "2026-07-09T00:00:00.000Z",
          }]),
        })),
      } as unknown as ConstructorParameters<typeof DiagnosticsService>[0]["dataRepository"],
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
    const configSummaryPath = findWrittenPath(writtenFiles, `${packagePathSuffix}/config/config-summary.json`)
    expect(configSummaryPath).toBeDefined()
    expect(findWrittenPath(writtenFiles, `${packagePathSuffix}/config/config-backup.json`)).toBeUndefined()
    const configSummary = writtenFiles.get(configSummaryPath ?? "") ?? ""
    const parsedConfigSummary = JSON.parse(configSummary) as {
      schemaVersion: number
      secrets: unknown
    }
    expect(parsedConfigSummary.schemaVersion).toBe(2)
    expect(parsedConfigSummary.secrets).toEqual({ count: 1 })
    expect(configSummary).toContain('"repositories"')
    expect(configSummary).toContain('"secrets"')
    expect(configSummary).not.toContain("API_TOKEN")
    expect(configSummary).not.toContain('"variables"')
    expect(configSummary).not.toContain("/repo")
    expect(configSummary).not.toContain("/missing-project")
    expect(configSummary).not.toContain("/secret/kb-root")
    expect(configSummary).not.toContain("sk-secret-value")
    expect(configSummary).not.toContain("userId")
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

  it("redacts optional file failure reasons written to the bundle manifest", async () => {
    const writtenFiles = new Map<string, string>()
    const rawError = "config failed token=sk-secret Authorization: Bearer sk-live-token at /Users/example/private/config.json"
    const service = createService({
      writeTextFile: vi.fn(async (targetPath: string, content: string) => {
        if (targetPath.replace(/\\/g, "/").endsWith("/config/config-summary.json")) {
          throw new Error(rawError)
        }
        writtenFiles.set(targetPath.replace(/\\/g, "/"), content)
      }),
    })
    const report = await service.collect()

    await service.exportBundle({ report })

    const packagePathSuffix = "/synapse-diagnostics-test/synapse-diagnostics-2026-04-29T03-31-20-000Z"
    const manifestContent = writtenFiles.get(findWrittenPath(writtenFiles, `${packagePathSuffix}/manifest.json`) ?? "")
    expect(manifestContent).toBeDefined()
    const manifest = JSON.parse(manifestContent ?? "") as {
      readonly skipped: Array<{ readonly path: string; readonly reason: string }>
    }
    expect(manifest.skipped).toEqual([
      {
        path: "config/config-summary.json",
        reason: expect.stringContaining("token=[redacted]"),
      },
    ])
    expect(manifest.skipped[0]?.reason).toContain("[redacted]")
    expect(manifest.skipped[0]?.reason).toContain("[path]")
    expect(manifestContent).not.toContain("sk-secret")
    expect(manifestContent).not.toContain("sk-live-token")
    expect(manifestContent).not.toContain("/Users/example/private/config.json")
  })

  it("redacts exported log files while preserving useful context", async () => {
    const writtenFiles = new Map<string, string>()
    const logContent = [
      "[2026-04-29T03:31:20.000Z] [INFO] [agent] starting /Users/liyang/project/file.ts",
      "[2026-04-29T03:31:20.100Z] [WARN] failed Authorization: Bearer report-bearer token=report-token at /Users/liyang/project/file.ts",
      "Authorization: Bearer sk-live-bearer Cookie: session=raw-cookie",
      "{\"apiKey\":\"sk-json-secret\",\"message\":\"ok\",\"dataServerToken\":\"data-server-secret\"}",
      "fetch https://user:password@example.com/callback?token=query-secret&ok=1",
      "ANTHROPIC_AUTH_TOKEN=sk-env-secret --env SYNAPSE_SIDE_CHANNEL_TOKEN=side-token",
    ].join("\n")
    const service = createService({
      logStore: {
        getLogDirectory: () => "/logs",
        listLogFilesInfo: vi.fn(async () => [{ name: "main.log", sizeBytes: logContent.length }]),
        readLogsByNames: vi.fn(async () => logContent),
        flush: vi.fn(async () => undefined),
      },
      readTextFile: vi.fn(async (targetPath: string) => {
        if (targetPath.replace(/\\/g, "/") === "/logs/main.log") return logContent
        return ""
      }),
      writeTextFile: vi.fn(async (targetPath: string, content: string) => {
        writtenFiles.set(targetPath.replace(/\\/g, "/"), content)
      }),
    })
    const report = await service.collect()

    await service.exportBundle({ report })

    const packagePathSuffix = "/synapse-diagnostics-test/synapse-diagnostics-2026-04-29T03-31-20-000Z"
    const logPath = findWrittenPath(writtenFiles, `${packagePathSuffix}/logs/main.log`)
    const exportedLog = writtenFiles.get(logPath ?? "")
    expect(exportedLog).toBeDefined()
    expect(exportedLog).toContain("[agent] starting")
    expect(exportedLog).toContain("project")
    expect(exportedLog).toContain("file.ts")
    expect(exportedLog).toContain("Authorization: Bearer [redacted]")
    expect(exportedLog).toContain("Cookie: [redacted]")
    expect(exportedLog).toContain("\"apiKey\":\"[redacted]\"")
    expect(exportedLog).toContain("\"dataServerToken\":\"[redacted]\"")
    expect(exportedLog).toContain("https://example.com/callback?token=%5Bredacted%5D&ok=1")
    expect(exportedLog).toContain("ANTHROPIC_AUTH_TOKEN=[redacted]")
    expect(exportedLog).toContain("SYNAPSE_SIDE_CHANNEL_TOKEN=[redacted]")
    expect(exportedLog).not.toContain("sk-live-bearer")
    expect(exportedLog).not.toContain("raw-cookie")
    expect(exportedLog).not.toContain("sk-json-secret")
    expect(exportedLog).not.toContain("data-server-secret")
    expect(exportedLog).not.toContain("query-secret")
    expect(exportedLog).not.toContain("sk-env-secret")
    expect(exportedLog).not.toContain("side-token")
    const diagnosticsPath = findWrittenPath(writtenFiles, `${packagePathSuffix}/diagnostics.json`)
    const diagnosticsJson = writtenFiles.get(diagnosticsPath ?? "")
    expect(diagnosticsJson).toBeDefined()
    expect(diagnosticsJson).toContain("Authorization: Bearer [redacted]")
    expect(diagnosticsJson).not.toContain("report-bearer")
    expect(diagnosticsJson).not.toContain("report-token")
  })

  it("skips log files outside the diagnostics bundle budget", async () => {
    const writtenFiles = new Map<string, string>()
    const readTextFile = vi.fn(async (targetPath: string) => `content from ${path.basename(targetPath)}`)
    const service = createService({
      logStore: {
        getLogDirectory: () => "/logs",
        listLogFilesInfo: vi.fn(async () => [
          { name: "log-1.log", sizeBytes: 1 },
          { name: "log-2.log", sizeBytes: 1 },
          { name: "log-3.log", sizeBytes: 1 },
          { name: "log-4.log", sizeBytes: 1 },
          { name: "log-5.log", sizeBytes: 1 },
          { name: "log-6.log", sizeBytes: 1 },
        ]),
        readLogsByNames: vi.fn(async () => ""),
        flush: vi.fn(async () => undefined),
      },
      readTextFile,
      writeTextFile: vi.fn(async (targetPath: string, content: string) => {
        writtenFiles.set(targetPath.replace(/\\/g, "/"), content)
      }),
    })
    const report = await service.collect()

    await service.exportBundle({ report })

    expect(readTextFile).toHaveBeenCalledTimes(5)
    expect(readTextFile.mock.calls.map(([targetPath]) => targetPath.replace(/\\/g, "/"))).toEqual([
      "/logs/log-1.log",
      "/logs/log-2.log",
      "/logs/log-3.log",
      "/logs/log-4.log",
      "/logs/log-5.log",
    ])

    const packagePathSuffix = "/synapse-diagnostics-test/synapse-diagnostics-2026-04-29T03-31-20-000Z"
    expect(findWrittenPath(writtenFiles, `${packagePathSuffix}/logs/log-6.log`)).toBeUndefined()
    const manifestContent = writtenFiles.get(findWrittenPath(writtenFiles, `${packagePathSuffix}/manifest.json`) ?? "")
    expect(manifestContent).toBeDefined()
    const manifest = JSON.parse(manifestContent ?? "") as {
      readonly skipped: Array<{ readonly path: string; readonly reason: string }>
    }
    expect(manifest.skipped).toEqual(expect.arrayContaining([
      {
        path: "logs/log-6.log",
        reason: expect.stringContaining("日志数量上限"),
      },
    ]))
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
      namespace: vi.fn(() => ({
        list: vi.fn(async () => []),
      })),
    } as unknown as ConstructorParameters<typeof DiagnosticsService>[0]["dataRepository"],
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
    ...overrides,
  })
}

function findWrittenPath(files: Map<string, string>, suffix: string): string | undefined {
  return [...files.keys()].find((targetPath) => targetPath.endsWith(suffix))
}

function createConfig(options: {
  projects?: SynapseConfig["global"]["projects"]
  knowledgeBaseStorage?: SynapseConfig["global"]["knowledgeBaseStorage"]
} = {}): SynapseConfig {
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
      projects: options.projects ?? [{ id: "project-1", name: "Project", path: "/missing-project" }],
      quickInputs: [],
      defaultQuickInputsSeededVersion: null,
      favorites: { rule: [], skill: [], prompt: [] },
      recentlyViewed: { rule: [], skill: [], prompt: [] },
      contentSortOrder: "modified-desc",
      variables: [],
      knowledgeBaseStorage: options.knowledgeBaseStorage ?? { mode: "default" },
      dockAppIds: [...DEFAULT_DOCK_APP_IDS],
    },
    agent: structuredClone(DEFAULT_AGENT_GLOBAL_CONFIG),
  }
}

function createAppInfo(options: { userDataPath: string }) {
  return {
    getAppPath: () => "/app",
    getLocale: () => "zh-CN",
    getName: () => "Synapse",
    getVersion: () => "0.2.49",
    hasSingleInstanceLock: () => true,
    isPackaged: false,
    getPath: (name: Parameters<Electron.App["getPath"]>[0]) => {
      if (name === "userData") return options.userDataPath
      return `/app/${name}`
    },
  }
}

function createManagedKnowledgeBaseProject(runtimeId: string): SynapseConfig["global"]["projects"][number] {
  return {
    id: runtimeId,
    name: "个人知识库",
    path: `synapse-kb://${runtimeId}`,
    capabilities: {
      knowledgeBase: {
        enabled: true,
        managed: true,
        runtimeId,
        schemaVersion: 1,
        templateVersion: "2026-05-21",
      },
    },
  }
}

function createFileEntry(name: string) {
  return {
    name,
    isDirectory: () => false,
    isFile: () => true,
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
