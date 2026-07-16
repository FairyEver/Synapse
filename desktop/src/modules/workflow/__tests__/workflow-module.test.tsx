/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkflowModule } from "../index"
import type { WorkflowImportDialogProps } from "../components/workflow-import-dialog"

const {
  loggerWarn,
  toastError,
  toastSuccess,
  workflowCreate,
  workflowExportPackage,
  workflowImportPackage,
  workflowInspectImportPackage,
  workflowOpenEditor,
} = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  workflowCreate: vi.fn(),
  workflowExportPackage: vi.fn(),
  workflowImportPackage: vi.fn(),
  workflowInspectImportPackage: vi.fn(),
  workflowOpenEditor: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: toastSuccess,
  },
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      activeRepoUuid: "repo-1",
      repositories: [],
      global: {
        projects: [{ id: "project-1", name: "Project", path: "/repo" }],
      },
    },
    error: null,
    isReady: true,
    refreshConfig: vi.fn(),
    resetKey: 0,
    updateConfig: vi.fn(),
  }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
  }),
}))

vi.mock("../components/workflow-list", () => ({
  WorkflowList: () => <div data-testid="workflow-list" />,
}))

vi.mock("../components/workflow-import-dialog", () => ({
  WorkflowImportDialog: ({ open, onImport }: WorkflowImportDialogProps) => (
    open ? <button type="button" onClick={() => onImport([], { targetProjectId: "project-1" })}>确认导入</button> : null
  ),
}))

vi.mock("../../../workflow-nodes/register.renderer", () => ({}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      workflow: {
        create: workflowCreate,
        exportPackage: workflowExportPackage,
        importPackage: workflowImportPackage,
        inspectImportPackage: workflowInspectImportPackage,
        openEditor: workflowOpenEditor,
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

describe("WorkflowModule", () => {
  it("shows a generic create failure and logs sanitized diagnostics", async () => {
    const rawError = "create failed token=sk-secret /Users/example/repo prompt text"
    workflowCreate.mockRejectedValue(new Error(rawError))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowModule />)
    })

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("新建"))
        ?.click()
      await Promise.resolve()
    })

    expect(toastError).toHaveBeenCalledWith("创建工作流失败，请重试")
    expect(loggerWarn).toHaveBeenCalledWith("Workflow create failed.", {
      boundary: "renderer.workflow.create",
      errorName: "Error",
      errorLength: rawError.length,
      errorMessage: "create failed token=[redacted] [path] prompt text",
    })
    expect(JSON.stringify(toastError.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain("/Users/example/repo")
  })

  it("starts workflow import from the toolbar", async () => {
    workflowInspectImportPackage.mockResolvedValue(null)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowModule />)
    })

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("导入"))
        ?.click()
      await Promise.resolve()
    })

    expect(workflowInspectImportPackage).toHaveBeenCalledTimes(1)
  })

  it("shows a sanitized actionable import preview error", async () => {
    workflowInspectImportPackage.mockRejectedValue(
      new Error("工作流包文件过大 token=sk-secret /Users/example/package.json"),
    )
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(<WorkflowModule />) })

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("导入"))
        ?.click()
      await Promise.resolve()
    })

    expect(toastError).toHaveBeenCalledWith("工作流包文件过大 token=[redacted] [path]")
    expect(JSON.stringify(toastError.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(toastError.mock.calls)).not.toContain("/Users/example")
  })

  it("shows a sanitized actionable import confirmation error", async () => {
    workflowInspectImportPackage.mockResolvedValue({
      packagePath: "/tmp/workflow.synapse-workflow.json",
      packageDigest: "sha256:preview",
      workflow: {
        id: "workflow-imported",
        name: "Imported",
        nodeCount: 1,
        modelReferenceCount: 0,
        requiresProjectMapping: true,
      },
      modelReferences: [],
      providerOptions: [],
      suggestedMappings: [],
    })
    workflowImportPackage.mockRejectedValue(new Error("工作流包已变化，请重新选择文件。"))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(<WorkflowModule />) })

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("导入"))
        ?.click()
      await Promise.resolve()
    })
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("确认导入"))
        ?.click()
      await Promise.resolve()
    })

    expect(toastError).toHaveBeenCalledWith("工作流包已变化，请重新选择文件。")
  })

  it("keeps successful import state when opening the imported workflow fails", async () => {
    workflowInspectImportPackage.mockResolvedValue({
      packagePath: "/tmp/workflow.synapse-workflow.json",
      packageDigest: "sha256:preview",
      workflow: {
        id: "workflow-imported",
        name: "Imported",
        nodeCount: 1,
        modelReferenceCount: 0,
        requiresProjectMapping: true,
      },
      modelReferences: [],
      providerOptions: [],
      suggestedMappings: [],
    })
    workflowImportPackage.mockResolvedValue({ workflowId: "workflow-imported", versionHash: "hash-1" })
    workflowOpenEditor.mockRejectedValue(new Error("open failed token=sk-secret /Users/example/repo"))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowModule />)
    })

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("导入"))
        ?.click()
      await Promise.resolve()
    })

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("确认导入"))
        ?.click()
      await Promise.resolve()
    })

    expect(workflowImportPackage).toHaveBeenCalledWith("/tmp/workflow.synapse-workflow.json", [], {
      targetProjectId: "project-1",
    }, "sha256:preview")
    expect(workflowOpenEditor).toHaveBeenCalledWith("workflow-imported")
    expect(toastSuccess).toHaveBeenCalledWith("工作流已导入")
    expect(toastError).toHaveBeenCalledWith("工作流已导入，但打开编辑器失败")
    expect(toastError).not.toHaveBeenCalledWith("导入失败，请重试")
    expect(loggerWarn).toHaveBeenCalledWith("Workflow import open editor failed.", {
      boundary: "renderer.workflow.import.openEditor",
      workflowId: "workflow-imported",
      errorName: "Error",
      errorLength: "open failed token=sk-secret /Users/example/repo".length,
      errorMessage: "open failed token=[redacted] [path]",
    })
  })
})
