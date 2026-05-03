import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { buildDiagnosticsSummary } from "@/lib/diagnostics-summary"
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
      ping: vi.fn(),
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
    success: vi.fn(),
  }),
}))

describe("DiagnosticsPanel", () => {
  it("starts with export disabled and no raw JSON action", () => {
    const html = renderToStaticMarkup(<DiagnosticsPanel />)

    expect(html).toContain("运行诊断后显示结果。")
    expect(html).toContain("导出诊断包")
    expect(html).toContain("复制摘要")
    expect(html).not.toContain("原始 JSON")
    expect(html).not.toContain("导出位置")
    expect(html).toContain("disabled")
  })

  it("renders the default info tab", () => {
    const html = renderToStaticMarkup(<DiagnosticsReportDetails report={createReport()} />)

    expect(html).toContain("基础信息")
    expect(html).toContain("本机信息")
    expect(html).toContain("platform")
    expect(html).toContain("aria-label=\"复制 platform\"")
  })

  it("renders diagnostic categories as tabs", () => {
    const html = renderToStaticMarkup(<DiagnosticsReportDetails report={createReport()} />)

    expect(html).toContain("role=\"tablist\"")
    expect(html).toContain("基础信息")
    expect(html).toContain("兼容性")
    expect(html).toContain("本地环境")
    expect(html).toContain("运行服务")
  })

  it("renders Windows compatibility in a separate section", () => {
    const html = renderToStaticMarkup(<DiagnosticsReportDetails report={createCompatibilityReport()} />)

    expect(html).toContain("Windows 兼容性")
    expect(html).toContain("环境变量")
    expect(html).toContain("PATH 分隔符")
    expect(html).not.toContain("windowsCompatibility")
  })

  it("renders macOS compatibility in a separate section", () => {
    const html = renderToStaticMarkup(<DiagnosticsReportDetails report={createCompatibilityReport()} />)

    expect(html).toContain("macOS 兼容性")
    expect(html).toContain("正在 macOS 运行")
    expect(html).not.toContain("macCompatibility")
  })

  it("groups checks by group name", () => {
    const groups = groupChecks(createReport().checks)

    expect(groups.get("系统")?.map((check) => check.id)).toEqual(["system.process"])
    expect(groups.get("Database")?.map((check) => check.id)).toEqual(["data-store.status"])
  })

  it("builds a concise diagnostic summary", () => {
    expect(buildDiagnosticsSummary(createReport())).toContain("# Synapse Diagnostics Summary")
    expect(buildDiagnosticsSummary(createReport())).toContain("Synapse 0.2.49")
    expect(buildDiagnosticsSummary(createReport())).toContain("## 异常项\n无")
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
      windowsCompatibility: {
        platform: "darwin",
        arch: "arm64",
        release: "24.0.0",
        runningOnWindows: false,
        pathDelimiter: ":",
        env: {
          pathKey: "PATH",
          hasPath: true,
          pathEntryCount: 12,
        },
        paths: {
          userDataPath: "/Users/liyang/Library/Application Support/Synapse",
          logPath: "/Users/liyang/Library/Application Support/Synapse/logs",
        },
      },
      macCompatibility: {
        platform: "darwin",
        arch: "arm64",
        release: "24.0.0",
        runningOnMac: true,
        pathDelimiter: ":",
        env: {
          pathKey: "PATH",
          hasPath: true,
          pathEntryCount: 12,
          shell: "/bin/zsh",
          hasShell: true,
          home: "/Users/liyang",
          hasHome: true,
        },
        paths: {
          userDataPath: "/Users/liyang/Library/Application Support/Synapse",
          logPath: "/Users/liyang/Library/Application Support/Synapse/logs",
          userDataInApplicationSupport: true,
        },
      },
    },
    app: {
      version: "0.2.49",
    },
    activeContext: {
      projectId: "project-1",
      projectName: "Project",
    },
    checks: [
      {
        id: "system.process",
        group: "系统",
        name: "进程",
        status: "ok",
        severity: "info",
        message: "通过",
        details: {
          path: "/Users/liyang/Documents/very-long-project-path-that-should-wrap",
        },
      },
      {
        id: "data-store.status",
        group: "Database",
        name: "数据库",
        status: "ok",
        severity: "info",
        message: "数据库状态已读取",
      },
    ],
  }
}

function createCompatibilityReport(): SynapseDiagnosticsReport {
  const report = createReport()

  return {
    ...report,
    system: {
      windowsCompatibility: report.system.windowsCompatibility,
      macCompatibility: report.system.macCompatibility,
    },
    app: {},
    activeContext: {},
    checks: [],
  }
}
