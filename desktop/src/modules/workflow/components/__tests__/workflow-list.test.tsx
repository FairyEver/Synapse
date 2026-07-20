/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition, WorkflowEvent, WorkflowMeta, WorkflowMigrationDiagnostic } from "@/types/workflow"
import { WorkflowList } from "../workflow-list"

const {
  loggerWarn,
  toastError,
  toastSuccess,
  track,
  workflowGet,
  workflowListState,
  workflowActiveRuns,
  workflowExportPackage,
  workflowInspectExportPackage,
  workflowOpenEditor,
  workflowRunDefinition,
  workflowOpenRunner,
  workflowOnEvent,
} = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  track: vi.fn(),
  workflowGet: vi.fn(),
  workflowListState: { items: [] as WorkflowMeta[], migrationDiagnostics: [] as WorkflowMigrationDiagnostic[] },
  workflowActiveRuns: vi.fn(),
  workflowExportPackage: vi.fn(),
  workflowInspectExportPackage: vi.fn(),
  workflowOpenEditor: vi.fn(),
  workflowRunDefinition: vi.fn(),
  workflowOpenRunner: vi.fn(),
  workflowOnEvent: vi.fn((_callback: (event: WorkflowEvent) => void) => vi.fn()),
}))

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: toastSuccess,
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
  }),
}))

vi.mock("@/lib/ui-tracking", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ui-tracking")>(),
  track,
}))

vi.mock("../workflow-card", () => ({
  WorkflowCard: ({
    meta,
    runState,
    onExport,
    onOpen,
    onRun,
    onOpenActiveRun,
  }: {
    meta: { id: string }
    runState?: { status: string; runId?: string }
    onExport: () => void
    onOpen: () => void
    onRun: () => void
    onOpenActiveRun: (runId: string) => void
  }) => (
    <tr>
      <td>
        <button type="button" data-testid={`run-${meta.id}`} onClick={onRun}>run</button>
        <button type="button" data-testid={`open-${meta.id}`} onClick={onOpen}>open</button>
        {runState?.runId ? (
          <button type="button" data-testid={`open-active-${meta.id}`} onClick={() => onOpenActiveRun(runState.runId!)}>open active</button>
        ) : null}
        <button type="button" data-track="workflow-card-export" onClick={onExport}>export</button>
      </td>
    </tr>
  ),
}))

vi.mock("../run-params-dialog", () => ({
  RunParamsDialog: ({
    open,
    lastValues,
    onConfirm,
  }: {
    open: boolean
    lastValues?: unknown
    onConfirm: (values: Record<string, unknown>, rawValues: Record<string, string>) => void
  }) => open ? (
    <>
      <span data-testid="last-run-values">{JSON.stringify(lastValues)}</span>
      <button
        type="button"
        data-testid="confirm-run-params"
        onClick={() => onConfirm(
          { apiKey: "sk-secret", count: 2 },
          { apiKey: "sk-secret", count: "2" },
        )}
      >
        confirm
      </button>
    </>
  ) : null,
}))

vi.mock("../run-history-dialog", () => ({
  RunHistoryDialog: () => null,
}))

vi.mock("../../hooks/use-workflow-list", () => ({
  useWorkflowList: () => ({
    items: workflowListState.items,
    migrationDiagnostics: workflowListState.migrationDiagnostics,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

const parameterizedWorkflow: WorkflowDefinition = {
  id: "workflow-param",
  name: "Parameterized",
  version: "v1",
  createdAt: 0,
  updatedAt: 0,
  params: [
    { name: "apiKey", type: "text", default: null },
    { name: "count", type: "number", default: 1 },
  ],
  nodes: [],
  edges: [],
}

beforeEach(() => {
  workflowListState.migrationDiagnostics = []
  workflowListState.items = [{
    id: "workflow-param",
    name: "Parameterized",
    version: "v1",
    nodeCount: 1,
    createdAt: 0,
    updatedAt: 0,
  }]
  workflowGet.mockResolvedValue(parameterizedWorkflow)
  workflowActiveRuns.mockResolvedValue([])
  workflowRunDefinition.mockResolvedValue({ runId: "run-1" })
  workflowOpenRunner.mockResolvedValue(undefined)
  workflowInspectExportPackage.mockResolvedValue({
    workflowId: "workflow-param",
    workflowName: "Parameterized",
    shareNote: "",
    entrypoints: ["root"],
    workflows: [{ ref: "root", id: "workflow-param", name: "Parameterized", revision: "v1", nodeCount: 1 }],
    references: { models: [], projects: [], resources: [], environments: [], runtimes: [] },
    requiredCapabilities: [],
    risks: { sensitiveLocations: [], highRiskLocations: [], portabilityWarnings: [], excludedAutomationCount: 0 },
    blockers: [],
    packageDigestSeed: "digest",
  })
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      workflow: {
        get: workflowGet,
        activeRuns: workflowActiveRuns,
        exportPackage: workflowExportPackage,
        inspectExportPackage: workflowInspectExportPackage,
        openEditor: workflowOpenEditor,
        runDefinition: workflowRunDefinition,
        openRunner: workflowOpenRunner,
        onEvent: workflowOnEvent,
      },
    } as unknown as Window["synapse"],
  })
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("WorkflowList", () => {
  it("tracks parameterized run submissions without recording parameter values", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="run-workflow-param"]')?.click()
      await Promise.resolve()
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="confirm-run-params"]')?.click()
      await Promise.resolve()
    })

    expect(track).toHaveBeenCalledWith({
      component: "workflow",
      name: "workflow-list-run-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.workflow.list.run-submit",
        workflowId: "workflow-param",
        source: "workflow-list",
        force: false,
        paramCount: 2,
        hasParams: true,
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("sk-secret")
  })

  it("shows a generic run failure and logs sanitized diagnostics", async () => {
    const rawError = "SDK failed token=sk-secret /Users/example/repo prompt text"
    workflowRunDefinition.mockRejectedValue(new Error(rawError))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="run-workflow-param"]')?.click()
      await Promise.resolve()
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="confirm-run-params"]')?.click()
      await Promise.resolve()
    })

    expect(toastError).toHaveBeenCalledWith("运行失败，请重试")
    expect(loggerWarn).toHaveBeenCalledWith("Workflow list run failed.", {
      boundary: "renderer.workflow.list.run",
      force: false,
      paramCount: 2,
      workflowId: "workflow-param",
      errorName: "Error",
      errorLength: rawError.length,
      errorMessage: "SDK failed token=[redacted] [path] prompt text",
    })
    expect(JSON.stringify(toastError.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("/Users/example/repo")
  })

  it("remembers run parameters only after the backend starts a run", async () => {
    workflowRunDefinition.mockResolvedValueOnce({
      errors: [{ type: "invalid_config", message: "路径不存在或不可访问" }],
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="run-workflow-param"]')?.click()
      await Promise.resolve()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="confirm-run-params"]')?.click()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="last-run-values"]')?.textContent).toBe("")

    workflowRunDefinition.mockResolvedValueOnce({ runId: "run-2" })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="confirm-run-params"]')?.click()
      await Promise.resolve()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="run-workflow-param"]')?.click()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="last-run-values"]')?.textContent).toContain("sk-secret")
  })

  it("exports a workflow from the card action", async () => {
    workflowExportPackage.mockResolvedValue({
      path: "/tmp/parameterized.synapse-workflow.json",
      kind: "package",
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-track="workflow-card-export"]')?.click()
      await Promise.resolve()
    })
    await act(async () => {
      Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent === "导出文件")?.click()
      await Promise.resolve()
    })

    expect(workflowExportPackage).toHaveBeenCalledWith("workflow-param", "Parameterized", undefined, "", "digest")
    expect(toastSuccess).toHaveBeenCalledWith("工作流已导出")
  })

  it("reports protected raw exports explicitly", async () => {
    workflowListState.items = [{
      id: "workflow-future",
      name: "Future workflow",
      version: "v1",
      nodeCount: 0,
      createdAt: 0,
      updatedAt: 0,
      loadError: "版本过高",
      rawExportAvailable: true,
    }]
    workflowExportPackage.mockResolvedValue({
      path: "/tmp/future.synapse-workflow-future.json",
      kind: "future-raw",
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-track="workflow-card-export"]')?.click()
      await Promise.resolve()
    })

    expect(toastSuccess).toHaveBeenCalledWith("工作流原文已导出")
  })

  it("shows the protected workflow reason and raw export recovery action", async () => {
    workflowListState.items = [{
      id: "workflow-future",
      name: "Future workflow",
      version: "v1",
      nodeCount: 0,
      createdAt: 0,
      updatedAt: 0,
      loadError: "该工作流使用更高的数据版本，请升级 Synapse 后再试。",
      rawExportAvailable: true,
    }]
    workflowExportPackage.mockResolvedValue({
      path: "/tmp/future.synapse-workflow-future.json",
      kind: "future-raw",
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="open-workflow-future"]')?.click()
    })

    expect(document.body.textContent).toContain("该工作流使用更高的数据版本，请升级 Synapse 后再试。")
    expect(document.body.textContent).toContain("可导出原文备份，并在兼容版本中处理。")
    expect(workflowOpenEditor).not.toHaveBeenCalled()

    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "导出原文")
        ?.click()
      await Promise.resolve()
    })

    expect(workflowExportPackage).toHaveBeenCalledWith("workflow-future", "Future workflow")
    expect(toastSuccess).toHaveBeenCalledWith("工作流原文已导出")
  })

  it("shows legacy migration diagnostics without opening a workflow", async () => {
    workflowListState.items = []
    workflowListState.migrationDiagnostics = [{
      id: "legacy:workflow-legacy",
      workflowId: "workflow-legacy",
      status: "failed",
      targetSchemaVersion: "2.0.0",
      errorMessage: "节点配置无法迁移",
      updatedAt: 1,
    }]
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })

    expect(container.textContent).toContain("旧仓库工作流")
    expect(container.textContent).toContain("迁移失败")
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="查看恢复诊断"]')?.click()
    })

    expect(document.body.textContent).toContain("节点配置无法迁移")
    expect(document.body.textContent).toContain("原始文件仍保留在旧内容仓库")
    expect(workflowOpenEditor).not.toHaveBeenCalled()
  })

  it("exports raw content from an eligible legacy future diagnostic", async () => {
    workflowListState.items = []
    workflowListState.migrationDiagnostics = [{
      id: "legacy:workflow-future",
      workflowId: "workflow-future",
      status: "unsupported_future",
      targetSchemaVersion: "2.0.0",
      rawExportAvailable: true,
      updatedAt: 1,
    }]
    workflowExportPackage.mockResolvedValue({
      path: "/tmp/legacy-future.synapse-workflow-future.json",
      kind: "future-raw",
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="查看恢复诊断"]')?.click()
    })

    expect(document.body.textContent).toContain("可导出原文备份，并在兼容版本中处理。")
    await act(async () => {
      Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "导出原文")
        ?.click()
      await Promise.resolve()
    })

    expect(workflowExportPackage).toHaveBeenCalledWith(
      "workflow-future",
      "旧仓库工作流",
      "legacy:workflow-future",
    )
    expect(toastSuccess).toHaveBeenCalledWith("工作流原文已导出")
  })

  it("loads active runs and reopens the runner from the workflow card", async () => {
    workflowActiveRuns.mockResolvedValue([{
      runId: "active-run",
      workflowId: "workflow-param",
      status: "running",
      nodeResults: {},
      startedAt: 123,
    }])
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="open-active-workflow-param"]')?.click()
      await Promise.resolve()
    })

    expect(workflowActiveRuns).toHaveBeenCalled()
    expect(workflowOpenRunner).toHaveBeenCalledWith("workflow-param", "active-run")
  })

  it("records active run ids from workflow events and clears them on terminal events", async () => {
    let listener: ((event: WorkflowEvent) => void) | undefined
    workflowOnEvent.mockImplementation((callback) => {
      listener = callback
      return vi.fn()
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowList onCreate={vi.fn()} />)
    })

    await act(async () => {
      listener?.({ type: "workflow:started", workflowId: "workflow-param", runId: "event-run" })
    })

    expect(container.querySelector('[data-testid="open-active-workflow-param"]')).toBeTruthy()

    await act(async () => {
      listener?.({
        type: "workflow:completed",
        workflowId: "workflow-param",
        runId: "event-run",
        result: { status: "completed", nodeResults: {}, durationMs: 1 },
      })
    })

    expect(container.querySelector('[data-testid="open-active-workflow-param"]')).toBeNull()
  })
})
