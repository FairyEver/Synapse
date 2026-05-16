/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "@/types/workflow"

const { rendererLogger, toastError } = vi.hoisted(() => ({
  rendererLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  toastError: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: vi.fn(),
  },
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: { global: { projects: [] } },
  }),
}))

vi.mock("../../../../workflow-nodes/register.renderer", () => ({}))

vi.mock("../canvas-floating-toolbar", () => ({
  CanvasFloatingToolbar: ({
    onRun,
  }: {
    onRun: (params: Record<string, unknown>) => Promise<string | null>
  }) => (
    <button type="button" onClick={() => { void onRun({}) }}>
      Run workflow
    </button>
  ),
}))

vi.mock("../canvas", () => ({
  WorkflowCanvas: () => <div data-testid="canvas" />,
}))

vi.mock("../node-palette", () => ({
  NodePalette: () => <div data-testid="node-palette" />,
}))

vi.mock("../node-config-panel", () => ({
  NodeConfigPanel: () => <div data-testid="node-config-panel" />,
}))

vi.mock("@/components/ui/resizable", () => ({
  ResizableHandle: () => <div data-testid="resize-handle" />,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { WorkflowEditorApp } from "../editor-app"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  window.history.replaceState({}, "", "/")
  vi.clearAllMocks()
})

describe("WorkflowEditorApp", () => {
  it("logs definition load failures without exposing raw backend error text", async () => {
    const rawError = "workflow get failed token=sk-secret at /Users/example/repo prompt text"
    const workflowApi = {
      get: vi.fn().mockRejectedValue(new Error(rawError)),
      openRunner: vi.fn(),
      runDefinition: vi.fn(),
      save: vi.fn(),
      onEditorRefocus: vi.fn(() => vi.fn()),
      onDefinitionUpdated: vi.fn(() => vi.fn()),
    }
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: { workflow: workflowApi },
    })
    window.history.replaceState({}, "", "/?workflowId=workflow-1")
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowEditorApp />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(workflowApi.get).toHaveBeenCalledWith("workflow-1")
    expect(document.body.textContent).toContain("加载失败")
    expect(document.body.textContent).not.toContain("sk-secret")
    expect(document.body.textContent).not.toContain("/Users/example")
    expect(document.body.textContent).not.toContain("prompt text")
    expect(rendererLogger.error).toHaveBeenCalledWith("editor definition load threw", {
      workflowId: "workflow-1",
      boundary: "renderer.workflow.editor.load",
      errorName: "Error",
      errorLength: rawError.length,
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/example")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("prompt text")
  })

  it("logs and displays workflow run IPC failures without raw backend error text", async () => {
    const rawError = "workflow run failed token=sk-secret at /Users/example/repo prompt text"
    const workflowApi = {
      get: vi.fn().mockResolvedValue(definition()),
      openRunner: vi.fn(),
      runDefinition: vi.fn().mockRejectedValue(new Error(rawError)),
      save: vi.fn().mockResolvedValue({ versionHash: "v2" }),
      onEditorRefocus: vi.fn(() => vi.fn()),
      onDefinitionUpdated: vi.fn(() => vi.fn()),
    }
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: { workflow: workflowApi },
    })
    window.history.replaceState({}, "", "/?workflowId=workflow-1")
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowEditorApp />)
      await Promise.resolve()
    })

    await act(async () => {
      buttonByText("Run workflow").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(workflowApi.runDefinition).toHaveBeenCalled()
    expect(document.body.textContent).toContain("运行失败")
    expect(document.body.textContent).not.toContain("sk-secret")
    expect(document.body.textContent).not.toContain("/Users/example")
    expect(document.body.textContent).not.toContain("prompt text")
    expect(rendererLogger.error).toHaveBeenCalledWith("handleRun failed", {
      workflowId: "workflow-1",
      boundary: "renderer.workflow.editor.run",
      errorName: "Error",
      errorLength: rawError.length,
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/example")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("prompt text")
  })

  it("logs force-run IPC failures without exposing raw backend error text", async () => {
    const rawError = "force run failed token=sk-secret at /Users/example/repo prompt text"
    const workflowApi = {
      get: vi.fn().mockResolvedValue(definition()),
      openRunner: vi.fn(),
      runDefinition: vi.fn()
        .mockResolvedValueOnce({ conflict: true })
        .mockRejectedValueOnce(new Error(rawError)),
      save: vi.fn().mockResolvedValue({ versionHash: "v2" }),
      onEditorRefocus: vi.fn(() => vi.fn()),
      onDefinitionUpdated: vi.fn(() => vi.fn()),
    }
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: { workflow: workflowApi },
    })
    window.history.replaceState({}, "", "/?workflowId=workflow-1")
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowEditorApp />)
      await Promise.resolve()
    })

    await act(async () => {
      buttonByText("Run workflow").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      buttonByText("取消旧运行并启动").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(workflowApi.runDefinition).toHaveBeenCalledTimes(2)
    expect(toastError).toHaveBeenCalledWith("运行失败：无法连接到主进程")
    expect(rendererLogger.error).toHaveBeenCalledWith("force run failed", {
      workflowId: "workflow-1",
      boundary: "renderer.workflow.editor.force-run",
      errorName: "Error",
      errorLength: rawError.length,
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/example")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("prompt text")
  })
})

function definition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Nightly check",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [],
    edges: [],
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}
