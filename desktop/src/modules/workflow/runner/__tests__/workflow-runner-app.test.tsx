/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowDefinition } from "@/types/workflow"

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

const toast = vi.hoisted(() => vi.fn())

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("sonner", () => ({
  toast,
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
  ResizablePanel: ({
    children,
    defaultSize,
    maxSize,
    minSize,
  }: {
    readonly children: ReactNode
    readonly defaultSize?: number
    readonly maxSize?: number
    readonly minSize?: number
  }) => (
    <div
      data-testid={defaultSize ? "selected-result-resizable-panel" : "main-resizable-panel"}
      data-default-size={defaultSize}
      data-max-size={maxSize}
      data-min-size={minSize}
    >
      {children}
    </div>
  ),
  ResizablePanelGroup: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}))

vi.mock("../dag-view", () => ({
  DagView: ({ onNodeSelect }: { readonly onNodeSelect: (nodeId: string) => void }) => (
    <button type="button" data-testid="dag-view" onClick={() => onNodeSelect("node-1")}>
      DAG
    </button>
  ),
}))

vi.mock("../timeline-view", () => ({
  TimelineView: () => <div data-testid="timeline-view" />,
}))

vi.mock("../node-result-panel", () => ({
  NodeResultPanel: ({ onCopyNodeReport }: { readonly onCopyNodeReport: () => Promise<void> }) => (
    <button type="button" data-testid="node-result-panel-copy" onClick={() => void onCopyNodeReport()}>
      copy node
    </button>
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
  toast.mockClear()
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  })
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

  it("uses a wider result panel when a node is selected", async () => {
    installWorkflowBridge({
      runStatus: vi.fn(async () => ({
        definition: workflowDefinition(),
        params: {},
      })),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
    })

    const dagButton = container.querySelector("[data-testid='dag-view']")
    expect(dagButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      dagButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const resultPanel = container.querySelector("[data-testid='selected-result-resizable-panel']")
    expect(resultPanel).toBeInstanceOf(HTMLDivElement)
    expect(resultPanel?.getAttribute("data-default-size")).toBe("460")
    expect(resultPanel?.getAttribute("data-max-size")).toBe("900")
    expect(resultPanel?.getAttribute("data-min-size")).toBe("320")
  })

  it("copies the whole workflow run report from the toolbar", async () => {
    installWorkflowBridge({
      runStatus: vi.fn(async () => ({
        definition: workflowDefinition(),
        params: { topic: "token=secret-value" },
      })),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
    })

    const copyButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("复制"))
    expect(copyButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      copyButton?.click()
      await Promise.resolve()
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0] ?? ""
    expect(copied).toContain("# 工作流运行报告：Workflow")
    expect(copied).toContain('"topic": "token=[redacted]"')
    expect(copied).not.toContain("secret-value")
    expect(toast).toHaveBeenCalledWith("运行报告已复制。")
  })

  it("copies the selected node report from the node panel", async () => {
    installWorkflowBridge({
      runStatus: vi.fn(async () => ({
        definition: workflowDefinition(),
        params: {},
      })),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
    })

    const dagButton = container.querySelector("[data-testid='dag-view']")
    await act(async () => {
      dagButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const copyButton = container.querySelector("[data-testid='node-result-panel-copy']")
    expect(copyButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0] ?? ""
    expect(copied).toContain("# 节点运行报告：Prompt node")
    expect(toast).toHaveBeenCalledWith("节点报告已复制。")
  })

  it("shows a concise error when report copy fails", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("clipboard denied token=secret-value"))
    installWorkflowBridge({
      runStatus: vi.fn(async () => ({
        definition: workflowDefinition(),
        params: {},
      })),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
    })

    const copyButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("复制"))

    await act(async () => {
      copyButton?.click()
      await Promise.resolve()
    })

    expect(toast).toHaveBeenCalledWith("复制失败。")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("token=secret-value")
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

function workflowDefinition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "1",
    createdAt: 1,
    updatedAt: 1,
    nodes: [{
      id: "node-1",
      name: "Prompt node",
      type: "prompt",
      position: { x: 0, y: 0 },
      config: {},
    }],
    edges: [],
    params: [],
  }
}
