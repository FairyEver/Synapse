/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "@/types/workflow"

const { rendererLogger, toastError, toastInfo, toastWarning } = vi.hoisted(() => ({
  rendererLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastWarning: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    info: toastInfo,
    success: vi.fn(),
    warning: toastWarning,
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
  WorkflowCanvas: ({
    definition,
    onChange,
  }: {
    definition: WorkflowDefinition
    onChange: (definition: WorkflowDefinition) => void
  }) => (
    <button type="button" data-testid="canvas" onClick={() => onChange({ ...definition, name: "Changed workflow" })}>
      Change workflow
    </button>
  ),
}))

vi.mock("../node-palette", () => ({
  NodePalette: () => <div data-testid="node-palette" />,
}))

vi.mock("../node-config-panel", () => ({
  NodeConfigPanel: ({ validationItems = [] }: { validationItems?: Array<{ summary: string }> }) => (
    <div data-testid="node-config-panel">
      {validationItems.map((item) => <p key={item.summary}>{item.summary}</p>)}
    </div>
  ),
}))

vi.mock("@/components/ui/resizable", () => ({
  ResizableHandle: () => <div data-testid="resize-handle" />,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { WorkflowEditorApp } from "../editor-app"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

function createWorkflowApi(api: {
  get: ReturnType<typeof vi.fn>
  openRunner: ReturnType<typeof vi.fn>
  runDefinition: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
  onEditorRefocus: ReturnType<typeof vi.fn>
  onDefinitionUpdated: ReturnType<typeof vi.fn>
}) {
  return {
    definition: { get: api.get, update: api.save },
    operation: {
      openRunner: api.openRunner,
      runDefinition: api.runDefinition,
      onEditorRefocus: api.onEditorRefocus,
    },
    editor: { onDefinitionUpdated: api.onDefinitionUpdated },
  }
}

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
    const workflowApi = createWorkflowApi({
      get: vi.fn().mockRejectedValue(new Error(rawError)),
      openRunner: vi.fn(),
      runDefinition: vi.fn(),
      save: vi.fn(),
      onEditorRefocus: vi.fn(() => vi.fn()),
      onDefinitionUpdated: vi.fn(() => vi.fn()),
    })
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

    expect(workflowApi.definition.get).toHaveBeenCalledWith("workflow-1")
    expect(document.body.textContent).toContain("加载失败")
    expect(document.body.textContent).not.toContain("sk-secret")
    expect(document.body.textContent).not.toContain("/Users/example")
    expect(document.body.textContent).not.toContain("prompt text")
    expect(rendererLogger.error).toHaveBeenCalledWith("editor definition load threw", {
      workflowId: "workflow-1",
      boundary: "renderer.workflow.editor.load",
      errorName: "Error",
      errorLength: rawError.length,
      errorMessage: "workflow get failed token=[redacted] at [path] prompt text",
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/example")
  })

  it("logs and displays workflow run IPC failures without raw backend error text", async () => {
    const rawError = "workflow run failed token=sk-secret at /Users/example/repo prompt text"
    const workflowApi = createWorkflowApi({
      get: vi.fn().mockResolvedValue(definition()),
      openRunner: vi.fn(),
      runDefinition: vi.fn().mockRejectedValue(new Error(rawError)),
      save: vi.fn().mockResolvedValue({ versionHash: "v2" }),
      onEditorRefocus: vi.fn(() => vi.fn()),
      onDefinitionUpdated: vi.fn(() => vi.fn()),
    })
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

    expect(workflowApi.operation.runDefinition).toHaveBeenCalled()
    expect(document.body.textContent).toContain("运行失败")
    expect(document.body.textContent).not.toContain("sk-secret")
    expect(document.body.textContent).not.toContain("/Users/example")
    expect(document.body.textContent).not.toContain("prompt text")
    expect(rendererLogger.error).toHaveBeenCalledWith("handleRun failed", {
      workflowId: "workflow-1",
      boundary: "renderer.workflow.editor.run",
      errorName: "Error",
      errorLength: rawError.length,
      errorMessage: "workflow run failed token=[redacted] at [path] prompt text",
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/example")
  })

  it("logs force-run IPC failures without exposing raw backend error text", async () => {
    const rawError = "force run failed token=sk-secret at /Users/example/repo prompt text"
    const workflowApi = createWorkflowApi({
      get: vi.fn().mockResolvedValue(definition()),
      openRunner: vi.fn(),
      runDefinition: vi.fn()
        .mockResolvedValueOnce({ conflict: true })
        .mockRejectedValueOnce(new Error(rawError)),
      save: vi.fn().mockResolvedValue({ versionHash: "v2" }),
      onEditorRefocus: vi.fn(() => vi.fn()),
      onDefinitionUpdated: vi.fn(() => vi.fn()),
    })
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

    expect(workflowApi.operation.runDefinition).toHaveBeenCalledTimes(2)
    expect(toastError).toHaveBeenCalledWith("运行失败：无法连接到主进程")
    expect(rendererLogger.error).toHaveBeenCalledWith("force run failed", {
      workflowId: "workflow-1",
      boundary: "renderer.workflow.editor.force-run",
      errorName: "Error",
      errorLength: rawError.length,
      errorMessage: "force run failed token=[redacted] at [path] prompt text",
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/example")
  })

  it("clears stale editor state when an open workflow is deleted externally", async () => {
    let definitionUpdated: ((payload: { workflowId: string; source?: string }) => void) | undefined
    const workflowApi = createWorkflowApi({
      get: vi.fn()
        .mockResolvedValueOnce(definition())
        .mockResolvedValueOnce(null),
      openRunner: vi.fn(),
      runDefinition: vi.fn(),
      save: vi.fn(),
      onEditorRefocus: vi.fn(() => vi.fn()),
      onDefinitionUpdated: vi.fn((listener: (payload: { workflowId: string; source?: string }) => void) => {
        definitionUpdated = listener
        return vi.fn()
      }),
    })
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

    expect(document.body.textContent).toContain("Change workflow")

    await act(async () => {
      definitionUpdated?.({ workflowId: "workflow-1", source: "workflow-delete" })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(workflowApi.definition.get).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("工作流不存在或已被删除")
    expect(document.body.textContent).not.toContain("Change workflow")
    expect(toastInfo).toHaveBeenCalledWith("工作流已被删除", { duration: 2000 })
  })

  it("shows node repair hints without raw validation JSON", async () => {
    const rawMessage = JSON.stringify([{ code: "invalid_type", path: ["projectId"], message: "Required" }])
    const workflowApi = createWorkflowApi({
      get: vi.fn().mockResolvedValue(definitionWithPrompt()),
      openRunner: vi.fn(),
      runDefinition: vi.fn().mockResolvedValue({
        errors: [{ type: "invalid_config", nodeId: "prompt-1", message: rawMessage }],
      }),
      save: vi.fn().mockResolvedValue({ versionHash: "v2" }),
      onEditorRefocus: vi.fn(() => vi.fn()),
      onDefinitionUpdated: vi.fn(() => vi.fn()),
    })
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

    expect(document.body.textContent).toContain("需要处理 1 处")
    expect(document.body.textContent).toContain("请选择项目，或设置工作流默认项目。")
    expect(document.body.textContent).not.toContain("invalid_type")
    expect(document.body.textContent).not.toContain("[")
  })

  it("shows save validation details when run is cancelled before execution", async () => {
    const validationMessage = "节点「提示词节点」缺少 providerId"
    const workflowApi = createWorkflowApi({
      get: vi.fn().mockResolvedValue(definitionWithPrompt()),
      openRunner: vi.fn(),
      runDefinition: vi.fn(),
      save: vi.fn().mockResolvedValue({
        errors: [{ type: "invalid_config", nodeId: "prompt-1", message: validationMessage }],
      }),
      onEditorRefocus: vi.fn(() => vi.fn()),
      onDefinitionUpdated: vi.fn(() => vi.fn()),
    })
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
      buttonByText("Change workflow").click()
    })

    await act(async () => {
      buttonByText("Run workflow").dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(workflowApi.definition.update).toHaveBeenCalled()
    expect(workflowApi.operation.runDefinition).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(validationMessage)
  })

  it("collapses the floating validation card", async () => {
    const workflowApi = createWorkflowApi({
      get: vi.fn().mockResolvedValue(definitionWithPrompt()),
      openRunner: vi.fn(),
      runDefinition: vi.fn().mockResolvedValue({
        errors: [{ type: "missing_end_node", message: "工作流必须包含一个结束节点" }],
      }),
      save: vi.fn().mockResolvedValue({ versionHash: "v2" }),
      onEditorRefocus: vi.fn(() => vi.fn()),
      onDefinitionUpdated: vi.fn(() => vi.fn()),
    })
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
      buttonByLabel("关闭错误提示").click()
    })

    expect(document.body.textContent).toContain("1 处需要处理")
    expect(document.body.textContent).not.toContain("需要处理 1 处")
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

function definitionWithPrompt(): WorkflowDefinition {
  return {
    ...definition(),
    nodes: [
      {
        id: "prompt-1",
        name: "提示词节点",
        type: "prompt",
        position: { x: 0, y: 0 },
        config: { variables: [], prompt: "hello" },
      },
    ],
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}
