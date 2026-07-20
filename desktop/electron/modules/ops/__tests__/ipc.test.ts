import { shell } from "electron"
import { describe, expect, it, vi } from "vitest"

import type { SynapseDiagnosticsReport } from "../../../../src/types/diagnostics"
import { createInMemoryHarness, type IpcHandlerContext } from "../../../runtime/ipc"
import type { ProjectContainer, ProjectContainerRegistry } from "../../../runtime/project-container"
import { configStore } from "../../../services/config-store"
import { opsIpcModule } from "../ipc"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"

const logMocks = vi.hoisted(() => ({
  mainLogger: {
    warn: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  shell: {
    openPath: vi.fn(),
  },
}))

vi.mock("../../../services/config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    })),
  },
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: () => logMocks.mainLogger,
  logStore: {
    getLogDirectory: () => "/logs",
  },
}))

describe("opsIpcModule diagnostics", () => {
  it("routes full diagnostics collection to DiagnosticsService", async () => {
    const report = createReport()
    const diagnostics = {
      collect: vi.fn(async () => report),
      exportBundle: vi.fn(),
    }
    const harness = createHarness(diagnostics)

    const result = await harness.invoke("synapse:app:ops:diagnostics:run", {
      projectId: "project-1",
    })

    expect(diagnostics.collect).toHaveBeenCalledWith({ projectId: "project-1" })
    expect(result).toEqual(report)
  })

  it("routes diagnostics bundle export to DiagnosticsService", async () => {
    const report = createReport()
    const diagnostics = {
      collect: vi.fn(),
      exportBundle: vi.fn(async () => ({
        success: true,
        filePath: "/downloads/synapse-diagnostics.zip",
        fileCount: 3,
      })),
    }
    const harness = createHarness(diagnostics)

    const result = await harness.invoke("synapse:app:ops:diagnostics:export_bundle", {
      report,
    })

    expect(diagnostics.exportBundle).toHaveBeenCalledWith({ report })
    expect(result).toEqual({
      success: true,
      filePath: "/downloads/synapse-diagnostics.zip",
      fileCount: 3,
    })
  })

  it("responds to lightweight ping requests", async () => {
    const harness = createHarness({
      collect: vi.fn(),
      exportBundle: vi.fn(),
    })

    const result = await harness.invoke("synapse:app:ops:operation:ping", undefined)

    expect(result).toEqual({
      ok: true,
      receivedAt: expect.any(String),
    })
  })

  it("records failed audit when opening the log directory fails", async () => {
    const auditEvents: Parameters<AuditSink["record"]>[0][] = []
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const auditSink: AuditSink = {
      record: (event) => {
        auditEvents.push(event)
      },
      list: () => [],
      clearForTests: vi.fn(),
    }
    vi.mocked(shell.openPath).mockResolvedValueOnce("open failed")
    const harness = createHarness({
      collect: vi.fn(),
      exportBundle: vi.fn(),
    }, { permissionGuard, auditSink })

    await expect(harness.invoke("synapse:app:ops:operation:open_log_directory", undefined))
      .rejects
      .toThrow("打开日志目录失败：open failed")

    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "fs.read.outside-userdata",
        resource: "/logs",
        outcome: "failed",
        metadata: expect.objectContaining({
          source: "ops.openLogDirectory",
          errorName: "Error",
        }),
      }),
    ])
  })

  it("opens repository-backed projects for compression state", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      activeRepoUuid: "repo-1",
      repositories: [{
        uuid: "repo-1",
        name: "Repo One",
        localPath: "/repo-one",
        contentDirs: {},
      }],
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
    const agent = {
      getCompressionState: vi.fn(async () => ({ enabled: true })),
    }
    const projectContainers: Pick<ProjectContainerRegistry, "open"> = {
      open: vi.fn(async () => ({
        projectId: "repo-1",
        get: <T,>() => agent as T,
        inspect: () => [],
        dispose: vi.fn(async () => undefined),
      } satisfies ProjectContainer)),
    }
    const harness = createHarness({
      collect: vi.fn(),
      exportBundle: vi.fn(),
    }, { projectContainers })

    const result = await harness.invoke("synapse:app:ops:compress:get", {
      projectId: "repo-1",
    })

    expect(projectContainers.open).toHaveBeenCalledWith("repo-1", {
      name: "Repo One",
      workspacePath: "/repo-one",
    })
    expect(agent.getCompressionState).toHaveBeenCalled()
    expect(result).toEqual({ enabled: true })
  })

  it("logs compression state failures with project context and without error text", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      activeRepoUuid: "repo-1",
      repositories: [{
        uuid: "repo-1",
        name: "Repo One",
        localPath: "/repo-one",
        contentDirs: {},
      }],
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
    const agent = {
      getCompressionState: vi.fn(async () => {
        throw new Error("SDK failed for secret compression prompt")
      }),
    }
    const projectContainers: Pick<ProjectContainerRegistry, "open"> = {
      open: vi.fn(async () => ({
        projectId: "repo-1",
        get: <T,>() => agent as T,
        inspect: () => [],
        dispose: vi.fn(async () => undefined),
      } satisfies ProjectContainer)),
    }
    const harness = createHarness({
      collect: vi.fn(),
      exportBundle: vi.fn(),
    }, { projectContainers })

    await expect(harness.invoke("synapse:app:ops:compress:get", {
      projectId: "repo-1",
    })).rejects.toThrow("SDK failed for secret compression prompt")

    expect(logMocks.mainLogger.warn).toHaveBeenCalledWith(
      "Ops Agent compression IPC failed.",
      expect.objectContaining({
        action: "get",
        agentType: "claude-code",
        boundary: "agent-runtime.compression",
        errorLength: "SDK failed for secret compression prompt".length,
        errorName: "Error",
        projectId: "repo-1",
      }),
    )
    expect(JSON.stringify(logMocks.mainLogger.warn.mock.calls)).not.toContain("secret compression prompt")
  })
})

function createHarness(diagnostics: {
  collect: (payload?: { projectId?: string }) => Promise<SynapseDiagnosticsReport>
  exportBundle: (payload: { report: SynapseDiagnosticsReport }) => Promise<{
    success: boolean
    filePath?: string
    fileCount?: number
  }>
}, services: {
  readonly projectContainers?: Pick<ProjectContainerRegistry, "open">
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
} = {}) {
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
    if (serviceId === "core.diagnostics") return diagnostics as T
    if (serviceId === "core.project-containers" && services.projectContainers) return services.projectContainers as T
    if (serviceId === "core.permission-guard" && services.permissionGuard) return services.permissionGuard as T
    if (serviceId === "core.audit-sink" && services.auditSink) return services.auditSink as T
    throw new Error(`Unknown service: ${serviceId}`)
  }
  harness.registry.register(opsIpcModule, { moduleId: "ops", resolve })
  return harness
}

function createReport(): SynapseDiagnosticsReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-04-29T03:31:20.000Z",
    overallStatus: "ok",
    summary: {
      ok: 1,
      degraded: 0,
      failed: 0,
      skipped: 0,
    },
    system: {
      platform: "darwin",
    },
    app: {
      version: "0.2.49",
    },
    knowledgeBaseStorage: {
      mode: "custom",
      rootPath: "/kb-root",
      knowledgeBasesPath: "/kb-root/knowledge-bases",
      available: false,
      runtimeCount: 2,
      missingRuntimeCount: 1,
      oldAbsoluteReferenceCount: 3,
    },
    activeContext: {
      projectId: "project-1",
      projectName: "Project",
    },
    checks: [{
      id: "system.process",
      group: "系统",
      name: "进程",
      status: "ok",
      severity: "info",
      message: "通过",
    }],
  }
}
