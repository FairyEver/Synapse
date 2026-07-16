/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("../../../../workflow-nodes/register.renderer", () => ({}))

vi.mock("../../hooks/use-workflow-events", () => ({
  useWorkflowEvents: vi.fn(),
}))

vi.mock("@/components/ui/resizable", () => ({
  ResizableHandle: () => <div data-testid="resize-handle" />,
  ResizablePanel: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}))

vi.mock("../dag-view", () => ({
  DagView: () => <div data-testid="dag-view" />,
}))

vi.mock("../timeline-view", () => ({
  TimelineView: () => <div data-testid="timeline-view" />,
}))

vi.mock("../node-result-panel", () => ({
  NodeResultPanel: () => <div data-testid="node-result-panel" />,
}))

vi.mock("../runner-toolbar", () => ({
  RunnerToolbar: ({
    runError,
    onRerun,
  }: {
    readonly runError?: string | null
    readonly onRerun: () => Promise<void>
  }) => (
    <div>
      <button type="button" onClick={() => void onRerun()}>重新运行</button>
      {runError ? <span data-testid="run-error">{runError}</span> : null}
    </div>
  ),
}))

import { WorkflowRunnerApp } from "../runner-app"
import { sanitizeError } from "@/lib/error-sanitize"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  rendererLogger.warn.mockClear()
  window.history.pushState({}, "", "/runner?workflowId=workflow-1&runId=run-1")
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: unknown }).synapse
})

describe("WorkflowRunnerApp rerun validation", () => {
  it("shows a generic rerun validation failure and logs sanitized diagnostics", async () => {
    const rawMessage = "invalid prompt token=sk-secret at /Users/example/repo"
    const rerun = vi.fn(async () => ({
      errors: [{ type: "invalid_config", nodeId: "node-1", message: rawMessage }],
    }))
    installWorkflowBridge({ rerun })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const rerunButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("重新运行"))
    expect(rerunButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      rerunButton?.click()
      await Promise.resolve()
    })

    expect(rerun).toHaveBeenCalledWith("run-1", {}, undefined, "workflow-1")
    expect(container.querySelector("[data-testid='run-error']")?.textContent)
      .toBe("重新运行失败：校验未通过")
    expect(rendererLogger.warn).toHaveBeenCalledWith("rerun failed", {
      runId: "run-1",
      errorCount: 1,
      firstErrorType: "invalid_config",
      firstErrorMessage: sanitizeError(rawMessage),
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("/Users/example/repo")
    expect(container.textContent).not.toContain(rawMessage)
  })
})

function installWorkflowBridge(overrides: {
  readonly rerun?: (runId: string, params: Record<string, unknown>) => Promise<unknown>
}): void {
  ;(window as unknown as { synapse: { workflow: Record<string, unknown> } }).synapse = {
    workflow: {
      runStatus: vi.fn(async () => ({
        definition: {
          id: "workflow-1",
          name: "Workflow",
          version: "1",
          createdAt: 0,
          updatedAt: 0,
          nodes: [],
          edges: [],
          params: [],
        },
        params: {},
      })),
      get: vi.fn(),
      onEvent: vi.fn(() => vi.fn()),
      onRunnerSwitchRun: vi.fn(() => vi.fn()),
      cancel: vi.fn(),
      rerun: overrides.rerun ?? vi.fn(),
      openEditor: vi.fn(),
    },
  }
}
