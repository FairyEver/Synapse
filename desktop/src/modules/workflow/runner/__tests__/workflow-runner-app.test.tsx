/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowDefinition, WorkflowEvent } from "@/types/workflow"

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

vi.mock("../token-usage-view", () => ({
  TokenUsageView: () => <div data-testid="token-usage-view" />,
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
import { useWorkflowEvents } from "../../hooks/use-workflow-events"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  rendererLogger.warn.mockClear()
  toast.mockClear()
  vi.mocked(useWorkflowEvents).mockReset()
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

    expect(runStatus).toHaveBeenCalledWith("run-1", "workflow-1")
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

    expect(runStatus).toHaveBeenCalledWith("run-1", "workflow-1")
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

  it("falls back to the workflow definition when a hydrated run status has no definition", async () => {
    const runStatus = vi.fn(async () => ({
      status: "completed",
      params: {},
      nodeResults: {},
    }))
    const get = vi.fn(async () => workflowDefinition())
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

    expect(runStatus).toHaveBeenCalledWith("run-1", "workflow-1")
    expect(get).toHaveBeenCalledWith("workflow-1")
    expect(container.querySelector("[data-testid='dag-view']")).toBeInstanceOf(HTMLButtonElement)
  })

  it("protects historical runs whose snapshot definition comes from a future version", async () => {
    const runStatus = vi.fn(async () => ({
      status: "completed",
      params: {},
      nodeResults: {},
      definitionMigration: {
        kind: "unsupported_future",
        sourceVersion: "2.0.0",
        targetVersion: "1.0.0",
      },
    }))
    const get = vi.fn(async () => workflowDefinition())
    const openEditor = vi.fn(async () => undefined)
    installWorkflowBridge({ runStatus, get, openEditor })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(get).not.toHaveBeenCalled()
    expect(container.textContent).toContain("无法显示历史工作流结构")
    expect(container.textContent).toContain("此记录由较新版本创建，请升级 Synapse 后再查看。")
    expect(container.querySelector("[data-testid='dag-view']")).toBeNull()

    const openButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("打开当前工作流"))
    await act(async () => {
      openButton?.click()
      await Promise.resolve()
    })
    expect(openEditor).toHaveBeenCalledWith("workflow-1")
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

  it("switches to the Token usage view from the toolbar", async () => {
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

    const tokenButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Token"))
    expect(tokenButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      tokenButton?.click()
    })

    expect(container.querySelector("[data-testid='token-usage-view']")).toBeInstanceOf(HTMLDivElement)
  })

  it("keeps an opened historical run when the same workflow starts another run", async () => {
    let emitWorkflowEvent: ((event: WorkflowEvent) => void) | null = null
    const runStatus = vi.fn(async () => ({
      definition: workflowDefinition(),
      params: {},
    }))
    installWorkflowBridge({
      runStatus,
      onEvent: vi.fn((listener) => {
        emitWorkflowEvent = listener
        return vi.fn()
      }),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
    })

    expect(runStatus).toHaveBeenCalledTimes(1)
    expect(runStatus).toHaveBeenCalledWith("run-1", "workflow-1")
    expect(emitWorkflowEvent).toBeInstanceOf(Function)

    await act(async () => {
      emitWorkflowEvent?.({ type: "workflow:started", workflowId: "workflow-1", runId: "run-2" })
      await Promise.resolve()
    })

    expect(runStatus).toHaveBeenCalledTimes(1)
    expect(runStatus).not.toHaveBeenCalledWith("run-2")
  })

  it("updates the runner URL when switching to another run", async () => {
    let emitRunnerSwitch: ((payload: { runId: string }) => void) | null = null
    const runStatus = vi.fn(async () => ({
      definition: workflowDefinition(),
      params: {},
    }))
    installWorkflowBridge({
      runStatus,
      onRunnerSwitchRun: vi.fn((listener) => {
        emitRunnerSwitch = listener
        return vi.fn()
      }),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
    })

    expect(runStatus).toHaveBeenCalledWith("run-1", "workflow-1")
    expect(emitRunnerSwitch).toBeInstanceOf(Function)

    await act(async () => {
      emitRunnerSwitch?.({ runId: "run-2" })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(new URLSearchParams(window.location.search).get("runId")).toBe("run-2")
    expect(new URLSearchParams(window.location.search).get("workflowId")).toBe("workflow-1")
    expect(runStatus).toHaveBeenCalledWith("run-2", "workflow-1")
  })

  it("updates the runner URL after rerun starts a new run", async () => {
    let workflowEventHandlers: Parameters<typeof useWorkflowEvents>[1] | undefined
    vi.mocked(useWorkflowEvents).mockImplementation((_runId, handlers) => {
      workflowEventHandlers = handlers
    })
    const rerun = vi.fn(async () => ({ runId: "run-2" }))
    const runStatus = vi.fn(async () => ({
      definition: workflowDefinition(),
      params: {},
    }))
    installWorkflowBridge({ rerun, runStatus })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
    })
    const onCompleted = workflowEventHandlers?.onCompleted
    if (!onCompleted) {
      throw new Error("workflow completed handler was not registered")
    }
    await act(async () => {
      onCompleted({})
      await Promise.resolve()
    })
    const rerunButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("重新运行"))
    expect(rerunButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      rerunButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rerun).toHaveBeenCalledWith("run-1", {}, undefined, "workflow-1", undefined)
    expect(new URLSearchParams(window.location.search).get("runId")).toBe("run-2")
    expect(new URLSearchParams(window.location.search).get("workflowId")).toBe("workflow-1")
  })

  it("requires explicit script confirmation before rerun starts", async () => {
    let workflowEventHandlers: Parameters<typeof useWorkflowEvents>[1] | undefined
    vi.mocked(useWorkflowEvents).mockImplementation((_runId, handlers) => {
      workflowEventHandlers = handlers
    })
    const rerun = vi.fn(async (
      _runId: string,
      _params: Record<string, unknown>,
      _force?: boolean,
      _workflowId?: string,
      token?: string,
    ) => token
      ? { runId: "run-2" }
      : scriptConfirmationRequired("review-token-1", "process.stdout.write('reviewed')"))
    installWorkflowBridge({ rerun, runStatus: vi.fn(async () => ({ definition: workflowDefinition(), params: {} })) })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
    })
    await act(async () => {
      workflowEventHandlers?.onCompleted?.({})
      await Promise.resolve()
    })

    const rerunButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("重新运行"))
    await act(async () => {
      rerunButton?.click()
      await Promise.resolve()
    })

    expect(rerun).toHaveBeenCalledTimes(1)
    expect(new URLSearchParams(window.location.search).get("runId")).toBe("run-1")
    expect(document.body.textContent).toContain("process.stdout.write('reviewed')")

    const confirmButton = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("确认并运行"))
    await act(async () => {
      confirmButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rerun).toHaveBeenLastCalledWith("run-1", {}, undefined, "workflow-1", "review-token-1")
    expect(new URLSearchParams(window.location.search).get("runId")).toBe("run-2")
  })

  it("does not let force rerun bypass script confirmation", async () => {
    let workflowEventHandlers: Parameters<typeof useWorkflowEvents>[1] | undefined
    vi.mocked(useWorkflowEvents).mockImplementation((_runId, handlers) => {
      workflowEventHandlers = handlers
    })
    const rerun = vi.fn(async (
      _runId: string,
      _params: Record<string, unknown>,
      force?: boolean,
      _workflowId?: string,
      token?: string,
    ) => {
      if (!force) return { conflict: true as const, activeRunId: "active-run" }
      return token
        ? { runId: "run-forced" }
        : scriptConfirmationRequired("force-review-token", "process.stdout.write('force-reviewed')")
    })
    installWorkflowBridge({ rerun, runStatus: vi.fn(async () => ({ definition: workflowDefinition(), params: {} })) })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(<WorkflowRunnerApp />)
      await Promise.resolve()
    })
    await act(async () => {
      workflowEventHandlers?.onCompleted?.({})
      await Promise.resolve()
    })

    const rerunButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("重新运行"))
    await act(async () => {
      rerunButton?.click()
      await Promise.resolve()
    })
    const continueButton = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("继续重新运行"))
    await act(async () => {
      continueButton?.click()
      await Promise.resolve()
    })

    expect(rerun).toHaveBeenLastCalledWith("run-1", {}, true, "workflow-1", undefined)
    expect(new URLSearchParams(window.location.search).get("runId")).toBe("run-1")
    expect(document.body.textContent).toContain("process.stdout.write('force-reviewed')")

    const confirmButton = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("确认并运行"))
    await act(async () => {
      confirmButton?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rerun).toHaveBeenLastCalledWith("run-1", {}, true, "workflow-1", "force-review-token")
    expect(new URLSearchParams(window.location.search).get("runId")).toBe("run-forced")
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
  readonly openEditor?: (workflowId: string) => Promise<unknown>
  readonly onEvent?: (listener: (event: WorkflowEvent) => void) => () => void
  readonly onRunnerSwitchRun?: (listener: (payload: { runId: string }) => void) => () => void
  readonly rerun?: (
    runId: string,
    params: Record<string, unknown>,
    force?: boolean,
    workflowId?: string,
    scriptConfirmationToken?: string,
  ) => Promise<unknown>
  readonly runStatus?: (runId: string) => Promise<unknown>
}): void {
  ;(window as unknown as { synapse: { workflow: Record<string, unknown> } }).synapse = {
    workflow: {
      definition: { get: overrides.get ?? vi.fn() },
      run: {
        get: overrides.runStatus ?? vi.fn(async () => ({
          definition: {
            id: "workflow-1",
            name: "Workflow",
            nodes: [],
            edges: [],
            params: [],
          },
          params: {},
        })),
        disable: overrides.cancel ?? vi.fn(),
      },
      operation: {
        onEvent: overrides.onEvent ?? vi.fn(() => vi.fn()),
        onRunnerSwitchRun: overrides.onRunnerSwitchRun ?? vi.fn(() => vi.fn()),
        rerun: overrides.rerun ?? vi.fn(),
        openEditor: overrides.openEditor ?? vi.fn(),
      },
    },
  }
}

function scriptConfirmationRequired(token: string, source: string) {
  return {
    errors: [{
      type: "script_confirmation_required",
      message: "需要确认",
      details: {
        confirmationToken: token,
        scripts: [{
          workflowName: "Workflow",
          runtime: "Node.js",
          nodeName: "Script",
          source,
        }],
      },
    }],
  }
}

function workflowDefinition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "1",
    createdAt: 1,
    updatedAt: 1,
    layoutDirection: "horizontal" as const,
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
