import { describe, expect, it, vi } from "vitest"

import type { SynapseDiagnosticsReport } from "../../../../src/types/diagnostics"
import { createInMemoryHarness, type IpcHandlerContext } from "../../../runtime/ipc"
import { opsIpcModule } from "../ipc"

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

    const result = await harness.invoke("synapse:ops:diagnostics:run", {
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

    const result = await harness.invoke("synapse:ops:diagnostics:export-bundle", {
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

    const result = await harness.invoke("synapse:ops:ping", undefined)

    expect(result).toEqual({
      ok: true,
      receivedAt: expect.any(String),
    })
  })
})

function createHarness(diagnostics: {
  collect: (payload?: { projectId?: string }) => Promise<SynapseDiagnosticsReport>
  exportBundle: (payload: { report: SynapseDiagnosticsReport }) => Promise<{
    success: boolean
    filePath?: string
    fileCount?: number
  }>
}) {
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
    if (serviceId === "core.diagnostics") return diagnostics as T
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
