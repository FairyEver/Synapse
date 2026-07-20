/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WorkflowImportPreview, WorkflowModelMapping } from "@/types/workflow-package"
import type { SynapseAgentProvider } from "@/types/bridge"
import { WorkflowImportDialog } from "../workflow-import-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

function renderDialog(props: Partial<Parameters<typeof WorkflowImportDialog>[0]> = {}) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  const onImport = vi.fn()
  act(() => {
    root!.render(
      <WorkflowImportDialog
        open
        preview={preview()}
        projects={[{ id: "project-1", name: "Project", path: "/repo" }]}
        importing={false}
        onOpenChange={vi.fn()}
        onImport={onImport}
        {...props}
      />,
    )
  })
  return { onImport }
}

function preview(): WorkflowImportPreview {
  return {
    packagePath: "/tmp/shared.synapse-workflow.json",
    packageDigest: "sha256:preview",
    workflow: { id: "workflow-1", name: "Shared Workflow", nodeCount: 3, modelReferenceCount: 2, requiresProjectMapping: true },
    modelReferences: [
      {
        id: "ref-1",
        sourceProviderId: "deepseek",
        sourceProviderName: "DeepSeek",
        sourceModelTier: "sonnet",
        sourceModelName: "deepseek-reasoner",
        occurrences: [{ kind: "workflowDefault" }, { kind: "node", nodeId: "n1", nodeName: "分析", nodeType: "prompt", inherited: true }],
      },
      {
        id: "ref-2",
        sourceProviderId: "claude",
        sourceProviderName: "Claude",
        sourceModelTier: "opus",
        sourceModelName: "claude-opus",
        occurrences: [{ kind: "node", nodeId: "n2", nodeName: "终审", nodeType: "prompt", inherited: false }],
      },
    ],
    providerOptions: [
      { providerId: "local-openai", providerName: "OpenAI", active: true, models: { default: "gpt-5-mini", haiku: "gpt-5-mini", sonnet: "gpt-5", opus: "gpt-5-pro" } },
      { providerId: "local-deepseek", providerName: "DeepSeek", models: { default: "deepseek-chat", haiku: "deepseek-chat", sonnet: "deepseek-reasoner", opus: "deepseek-reasoner" } },
    ],
    suggestedMappings: [
      { sourceRefId: "ref-1", targetProviderId: "local-deepseek", targetModelTier: "sonnet" },
      { sourceRefId: "ref-2", targetProviderId: "local-openai", targetModelTier: "opus" },
    ],
  }
}

describe("WorkflowImportDialog", () => {
  it("renders original model references and usage summary", () => {
    renderDialog()

    expect(document.body.textContent).toContain("Shared Workflow")
    expect(document.body.textContent).toContain("DeepSeek")
    expect(document.body.textContent).toContain("deepseek-reasoner")
    expect(document.body.textContent).toContain("全局")
    expect(document.body.textContent).toContain("分析")
    expect(document.body.textContent).toContain("终审")
  })

  it("explains why import is unavailable without local providers", () => {
    renderDialog({
      preview: {
        ...preview(),
        providerOptions: [],
        suggestedMappings: [],
      },
    })

    expect(document.body.textContent).toContain("先配置供应商后再导入")
    const importButton = Array.from(document.querySelectorAll("button")).find((node) => node.textContent === "导入")
    expect(importButton?.disabled).toBe(true)
  })

  it("submits suggested mappings by default", () => {
    const { onImport } = renderDialog()
    const button = Array.from(document.querySelectorAll("button")).find((node) => node.textContent === "导入")
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(onImport).toHaveBeenCalledWith([
      { sourceRefId: "ref-1", targetProviderId: "local-deepseek", targetModelTier: "sonnet" },
      { sourceRefId: "ref-2", targetProviderId: "local-openai", targetModelTier: "opus" },
    ] satisfies WorkflowModelMapping[], { targetProjectId: "project-1" })
  })

  it("maps all rows to the active default model", () => {
    const { onImport } = renderDialog()
    const allButton = Array.from(document.querySelectorAll("button")).find((node) => node.textContent === "全部使用默认模型")
    act(() => allButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    const importButton = Array.from(document.querySelectorAll("button")).find((node) => node.textContent === "导入")
    act(() => importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(onImport).toHaveBeenCalledWith([
      { sourceRefId: "ref-1", targetProviderId: "local-openai", targetModelTier: "default" },
      { sourceRefId: "ref-2", targetProviderId: "local-openai", targetModelTier: "default" },
    ], { targetProjectId: "project-1" })
  })

  it("changes a row through the shared provider model dialog", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn(async () => providers()),
        },
      } as unknown as Window["synapse"],
    })
    const { onImport } = renderDialog()
    const mappingButton = Array.from(document.querySelectorAll("button"))
      .find((node) => node.textContent?.includes("DeepSeek / deepseek-reasoner"))

    await act(async () => {
      mappingButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    const haikuButton = document.querySelector<HTMLButtonElement>('button[data-tier="haiku"]')
    await act(async () => {
      haikuButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const confirmButton = Array.from(document.querySelectorAll("button"))
      .find((node) => node.textContent === "确认")
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    const importButton = Array.from(document.querySelectorAll("button")).find((node) => node.textContent === "导入")
    act(() => importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(onImport).toHaveBeenCalledWith([
      { sourceRefId: "ref-1", targetProviderId: "local-openai", targetModelTier: "haiku" },
      { sourceRefId: "ref-2", targetProviderId: "local-openai", targetModelTier: "opus" },
    ], { targetProjectId: "project-1" })
  })

  it("requires a project before importing workflows with model nodes", () => {
    renderDialog({ projects: [] })

    expect(document.body.textContent).toContain("先添加项目后再导入")
    const importButton = Array.from(document.querySelectorAll("button")).find((node) => node.textContent === "导入")
    expect(importButton?.disabled).toBe(true)
  })

  it("blocks close actions while importing", () => {
    const onOpenChange = vi.fn()
    renderDialog({ importing: true, onOpenChange })

    expect(buttonByText("取消").disabled).toBe(true)
    const closeButton = queryButtonByText("关闭")
    if (closeButton) {
      act(() => closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    }

    expect(queryButtonByText("关闭")).toBeNull()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

function providers(): SynapseAgentProvider[] {
  return [
    {
      id: "local-openai",
      name: "OpenAI",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      active: true,
      model: "gpt-5-mini",
      haikuModel: "gpt-5-mini",
      sonnetModel: "gpt-5",
      opusModel: "gpt-5-pro",
      env: {},
      createdAt: "2026-05-19T10:00:00.000Z",
      updatedAt: "2026-05-19T10:00:00.000Z",
    },
    {
      id: "local-deepseek",
      name: "DeepSeek",
      category: "cn_official",
      apiKeyField: "ANTHROPIC_API_KEY",
      model: "deepseek-chat",
      haikuModel: "deepseek-chat",
      sonnetModel: "deepseek-reasoner",
      opusModel: "deepseek-reasoner",
      env: {},
      createdAt: "2026-05-19T10:00:00.000Z",
      updatedAt: "2026-05-19T10:00:00.000Z",
    },
  ]
}

function buttonByText(text: string): HTMLButtonElement {
  const button = queryButtonByText(text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

function queryButtonByText(text: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((node) => node.textContent === text) ?? null
}
