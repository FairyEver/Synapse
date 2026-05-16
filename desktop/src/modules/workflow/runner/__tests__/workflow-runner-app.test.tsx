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

vi.mock("../../../../workflow-nodes/provider-lookup-context", () => ({
  ProviderLookupProvider: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
}))

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

import { WorkflowRunnerApp } from "../runner-app"
import { sanitizeError } from "../../../../../electron/services/error-sanitize"

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

describe("WorkflowRunnerApp", () => {
  it("logs run status hydration failures and falls back without raw backend error text", async () => {
    const rawMessage = "runStatus failed token=secret-value at /Users/example/repo with prompt text"
    const runStatus = vi.fn(async () => {
      throw new Error(rawMessage)
    })
    const get = vi.fn(async () => ({
      id: "workflow-1",
      name: "Workflow",
      nodes: [],
      edges: [],
      params: [],
    }))
    installWorkflowBridge({ runStatus, get })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(runStatus).toHaveBeenCalledWith("run-1")
    expect(rendererLogger.warn).toHaveBeenCalledWith("runner hydration failed: runStatus rejected, triggering fallback", {
      workflowId: "workflow-1",
      runId: "run-1",
      boundary: "renderer.workflow.runner.hydration",
      errorName: "Error",
      errorLength: rawMessage.length,
      errorMessage: sanitizeError(rawMessage),
    })
    expect(get).toHaveBeenCalledWith("workflow-1")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("token=secret-value")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("/Users/example/repo")
  })

  it("logs fallback definition failures without raw backend error text", async () => {
    const rawMessage = "workflow get failed token=secret-value at /Users/example/repo with prompt text"
    const runStatus = vi.fn(async () => null)
    const get = vi.fn(async () => {
      throw new Error(rawMessage)
    })
    installWorkflowBridge({ runStatus, get })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(runStatus).toHaveBeenCalledWith("run-1")
    expect(get).toHaveBeenCalledWith("workflow-1")
    expect(rendererLogger.warn).toHaveBeenCalledWith("runner fallback definition failed", {
      workflowId: "workflow-1",
      runId: "run-1",
      boundary: "renderer.workflow.runner.fallback-definition",
      errorName: "Error",
      errorLength: rawMessage.length,
      errorMessage: sanitizeError(rawMessage),
    })
    expect(container.textContent).toContain("无法加载运行结果")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("token=secret-value")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("/Users/example/repo")
    expect(container.textContent).not.toContain(rawMessage)
  })

  it("logs cancel IPC failures without raw backend error text", async () => {
    const rawMessage = "cancel failed with token=secret-value and /Users/example/repo"
    const cancel = vi.fn(async () => {
      throw new Error(rawMessage)
    })
    installWorkflowBridge({ cancel })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
    })

    const stopButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("停止"))
    expect(stopButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      stopButton?.click()
      await Promise.resolve()
    })

    expect(cancel).toHaveBeenCalledWith("run-1")
    expect(rendererLogger.warn).toHaveBeenCalledWith("cancel IPC call failed", {
      runId: "run-1",
      errorName: "Error",
      errorLength: rawMessage.length,
      errorMessage: sanitizeError(rawMessage),
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("token=secret-value")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("/Users/example/repo")
  })
})

function installWorkflowBridge(overrides: {
  readonly cancel?: (runId: string) => Promise<unknown>
  readonly get?: (workflowId: string) => Promise<unknown>
  readonly runStatus?: (runId: string) => Promise<unknown>
}): void {
  ;(window as unknown as { synapse: { workflow: Record<string, unknown> } }).synapse = {
    workflow: {
      runStatus: overrides.runStatus ?? vi.fn(async () => ({
        definition: {
          id: "workflow-1",
          name: "Workflow",
          nodes: [],
          edges: [],
          params: [],
        },
        params: {},
      })),
      get: overrides.get ?? vi.fn(),
      onEvent: vi.fn(() => vi.fn()),
      onRunnerSwitchRun: vi.fn(() => vi.fn()),
      cancel: overrides.cancel ?? vi.fn(),
      rerun: vi.fn(),
      openEditor: vi.fn(),
    },
  }
}
