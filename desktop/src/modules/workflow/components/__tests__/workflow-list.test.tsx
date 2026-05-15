/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "@/types/workflow"
import { WorkflowList } from "../workflow-list"

const {
  loggerWarn,
  toastError,
  toastSuccess,
  track,
  workflowGet,
  workflowRunDefinition,
  workflowOpenRunner,
} = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  track: vi.fn(),
  workflowGet: vi.fn(),
  workflowRunDefinition: vi.fn(),
  workflowOpenRunner: vi.fn(),
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

vi.mock("@/lib/ui-tracking", () => ({
  track,
}))

vi.mock("../workflow-card", () => ({
  WorkflowCard: ({ meta, onRun }: { meta: { id: string }; onRun: () => void }) => (
    <button type="button" data-testid={`run-${meta.id}`} onClick={onRun}>run</button>
  ),
}))

vi.mock("../run-params-dialog", () => ({
  RunParamsDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean
    onConfirm: (values: Record<string, unknown>, rawValues: Record<string, string>) => void
  }) => open ? (
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
  ) : null,
}))

vi.mock("../run-history-dialog", () => ({
  RunHistoryDialog: () => null,
}))

vi.mock("../../hooks/use-workflow-list", () => ({
  useWorkflowList: () => ({
    items: [{
      id: "workflow-param",
      name: "Parameterized",
      version: "v1",
      nodeCount: 1,
      createdAt: 0,
      updatedAt: 0,
    }],
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
  workflowGet.mockResolvedValue(parameterizedWorkflow)
  workflowRunDefinition.mockResolvedValue({ runId: "run-1" })
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      workflow: {
        get: workflowGet,
        runDefinition: workflowRunDefinition,
        openRunner: workflowOpenRunner,
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
    })
    expect(JSON.stringify(toastError.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("/Users/example/repo")
  })
})
