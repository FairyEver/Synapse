/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildDiagnosticsSummary } from "@/lib/diagnostics-summary"
import {
  DiagnosticsPanel,
  DiagnosticsReportDetails,
  groupChecks,
} from "@/modules/settings/components/diagnostics-panel"
import type { SynapseDiagnosticsReport } from "@/types/diagnostics"

const { bridgeOps, notificationState, rendererLogger, shell } = vi.hoisted(() => {
  const notificationState = {
    error: vi.fn(),
    success: vi.fn(),
    promiseErrors: [] as Array<string | null>,
    promise: vi.fn(async <T,>(
      task: () => Promise<T>,
      messages: {
        readonly error?: string | ((error: unknown) => string | null)
      },
    ) => {
      try {
        return await task()
      } catch (error) {
        const message = typeof messages.error === "function" ? messages.error(error) : messages.error ?? null
        notificationState.promiseErrors.push(message)
        throw error
      }
    }),
  }
  return {
    bridgeOps: {
      runDiagnostics: vi.fn(),
      exportDiagnosticsBundle: vi.fn(),
      ping: vi.fn(),
    },
    notificationState,
    rendererLogger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    shell: {
      showItemInFolder: vi.fn(),
    },
  }
})

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    ops: bridgeOps,
    shell,
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: notificationState.error,
    promise: notificationState.promise,
    success: notificationState.success,
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  })
  bridgeOps.runDiagnostics.mockResolvedValue(createReport())
  bridgeOps.exportDiagnosticsBundle.mockResolvedValue({ success: true, filePath: "/tmp/diagnostics.zip" })
  bridgeOps.ping.mockResolvedValue({ receivedAt: "2026-04-29T03:31:21.000Z" })
  shell.showItemInFolder.mockResolvedValue(undefined)
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  notificationState.promiseErrors.length = 0
  vi.clearAllMocks()
})

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

  it("renders knowledge base storage diagnostics", () => {
    const html = renderToStaticMarkup(<DiagnosticsReportDetails report={createKnowledgeBaseStorageReport()} />)

    expect(html).toContain("知识库存储")
    expect(html).toContain("自定义")
    expect(html).toContain("可用")
    expect(html).toContain("发现旧绝对路径引用。")
  })

  it("groups checks by group name", () => {
    const groups = groupChecks(createReport().checks)

    expect(groups.get("系统")?.map((check) => check.id)).toEqual(["system.process"])
    expect(groups.get("Database")?.map((check) => check.id)).toEqual(["database.status"])
  })

  it("builds a concise diagnostic summary", () => {
    expect(buildDiagnosticsSummary(createReport())).toContain("# Synapse Diagnostics Summary")
    expect(buildDiagnosticsSummary(createReport())).toContain("Synapse 0.2.49")
    expect(buildDiagnosticsSummary(createReport())).toContain("## 异常项\n无")
  })

  it("uses a fixed diagnostics run failure message and sanitized renderer log metadata", async () => {
    bridgeOps.runDiagnostics.mockRejectedValue(new Error("diagnostics failed token=sk-secret at /Users/example/private/report.zip"))
    const container = renderPanel()

    await clickButton(container, "运行诊断")

    expect(notificationState.promiseErrors).toEqual(["诊断失败"])
    expect(rendererLogger.error).toHaveBeenCalledWith("Diagnostics run failed.", {
      errorName: "Error",
      errorLength: expect.any(Number),
    })
    expect(JSON.stringify(notificationState.promiseErrors)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/example/private/report.zip")
    expect(container.textContent).not.toContain("sk-secret")
  })

  it("sanitizes renderer-main roundtrip errors before adding them to the diagnostics report", async () => {
    bridgeOps.ping.mockRejectedValue(new Error("ping failed token=sk-secret at /Users/example/private/report.zip"))
    const container = renderPanel()

    await clickButton(container, "运行诊断")
    await clickButton(container, "复制摘要")

    const copied = vi.mocked(window.navigator.clipboard.writeText).mock.calls[0]?.[0] ?? ""
    expect(copied).toContain("token=[redacted]")
    expect(copied).toContain("[path]")
    expect(copied).not.toContain("sk-secret")
    expect(copied).not.toContain("/Users/example/private/report.zip")
    expect(container.textContent).not.toContain("sk-secret")
    expect(container.textContent).not.toContain("/Users/example/private/report.zip")
  })

  it("uses a fixed diagnostics export failure message and sanitized renderer log metadata", async () => {
    bridgeOps.exportDiagnosticsBundle.mockRejectedValue(
      new Error("zip failed token=sk-secret at /Users/example/private/report.zip"),
    )
    const container = renderPanel()

    await clickButton(container, "运行诊断")
    await clickButton(container, "导出诊断包")
    await clickButton(document.body, "继续导出")

    expect(notificationState.promiseErrors).toEqual(["导出诊断包失败"])
    expect(rendererLogger.error).toHaveBeenCalledWith("Diagnostics bundle export failed.", {
      errorName: "Error",
      errorLength: expect.any(Number),
    })
    expect(JSON.stringify(notificationState.promiseErrors)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/example/private/report.zip")
    expect(container.textContent).not.toContain("sk-secret")
  })

  it("requires confirmation before exporting diagnostics bundle", async () => {
    const container = renderPanel()

    await clickButton(container, "运行诊断")
    await clickButton(container, "导出诊断包")

    expect(document.body.textContent).toContain("数据库副本")
    expect(bridgeOps.exportDiagnosticsBundle).not.toHaveBeenCalled()

    await clickButton(document.body, "取消")
    expect(bridgeOps.exportDiagnosticsBundle).not.toHaveBeenCalled()

    await clickButton(container, "导出诊断包")
    await clickButton(document.body, "继续导出")

    expect(bridgeOps.exportDiagnosticsBundle).toHaveBeenCalledTimes(1)
  })
})

function renderPanel(): HTMLElement {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<DiagnosticsPanel />)
  })
  return container
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll("button"))
    .find((element) => element.textContent?.includes(label))
  expect(button).toBeDefined()
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })
}

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
        id: "database.status",
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

function createKnowledgeBaseStorageReport(): SynapseDiagnosticsReport {
  return {
    ...createReport(),
    knowledgeBaseStorage: {
      mode: "custom",
      rootPath: "/Volumes/Data/SynapseData",
      knowledgeBasesPath: "/Volumes/Data/SynapseData/knowledge-bases",
      available: true,
      runtimeCount: 2,
      missingRuntimeCount: 0,
      oldAbsoluteReferenceCount: 1,
    },
  }
}
