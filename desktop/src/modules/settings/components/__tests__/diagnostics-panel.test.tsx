import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import {
  DiagnosticsPanel,
  DiagnosticsReportDetails,
  groupChecks,
} from "@/modules/settings/components/diagnostics-panel"
import type { SynapseDiagnosticsReport } from "@/types/diagnostics"

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    ops: {
      runDiagnostics: vi.fn(),
      exportDiagnosticsBundle: vi.fn(),
    },
    shell: {
      showItemInFolder: vi.fn(),
    },
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: vi.fn(),
    promise: async <T,>(task: () => Promise<T>) => task(),
  }),
}))

describe("DiagnosticsPanel", () => {
  it("starts with export disabled and no raw JSON action", () => {
    const html = renderToStaticMarkup(<DiagnosticsPanel />)

    expect(html).toContain("运行诊断后显示结果。")
    expect(html).toContain("导出诊断包")
    expect(html).not.toContain("原始 JSON")
    expect(html).not.toContain("导出位置")
    expect(html).toContain("disabled")
  })

  it("renders grouped details with long values", () => {
    const html = renderToStaticMarkup(<DiagnosticsReportDetails report={createReport()} />)

    expect(html).toContain("系统")
    expect(html).toContain("进程")
    expect(html).toContain("/Users/liyang/Documents/very-long-project-path-that-should-wrap")
    expect(html).toContain("复制")
  })

  it("groups checks by group name", () => {
    const groups = groupChecks(createReport().checks)

    expect(groups.get("系统")?.map((check) => check.id)).toEqual(["system.process"])
  })
})

function createReport(): SynapseDiagnosticsReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-04-29T03:31:20.000Z",
    overallStatus: "ok",
    summary: { ok: 1, degraded: 0, failed: 0, skipped: 0 },
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
      details: {
        path: "/Users/liyang/Documents/very-long-project-path-that-should-wrap",
      },
    }],
  }
}
