/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WorkflowShareImportPreview } from "@/types/workflow-package"

vi.mock("@/components/provider-model-select-dialog", () => ({ ProviderModelSelectDialog: () => null }))
vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: () => ({ chooseParamFile: vi.fn(), chooseParamDirectory: vi.fn() }),
}))

import { WorkflowShareImportDialog } from "../workflow-share-import-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView = vi.fn()
Element.prototype.hasPointerCapture = vi.fn()
Element.prototype.setPointerCapture = vi.fn()
Element.prototype.releasePointerCapture = vi.fn()

const roots: Root[] = []
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

function preview(overrides: Partial<WorkflowShareImportPreview> = {}): WorkflowShareImportPreview {
  return {
    packagePath: "/tmp/share.synapse-workflow",
    packageDigest: "sha256:test",
    formatVersion: "4.0.0",
    artifactId: "artifact-1",
    lineageId: "lineage-1",
    sourceVerified: false,
    mode: "create",
    content: {
      entrypoints: ["root"],
      workflows: [{ ref: "root", name: "日报", nodeCount: 3, sourceRevision: "source-1", action: "create" }],
    },
    compatibility: {
      supported: true,
      issues: [],
      requiredCapabilities: [],
      sensitiveLocations: [],
      highRiskLocations: [],
      portabilityWarnings: [],
      excludedAutomationCount: 0,
      automationUpdates: [],
    },
    mappings: { models: [], projects: [], resources: [], environments: [] },
    providerOptions: [],
    projectOptions: [],
    suggestions: { models: [], projects: [], resources: [], environments: [] },
    summary: {
      createCount: 1,
      updateCount: 0,
      deleteCount: 0,
      detachCount: 0,
      preserveRunHistory: true,
      undoAvailable: false,
      transactionalBackup: false,
      incompatiblePresetCount: 0,
    },
    ...overrides,
  }
}

function fullPreview(): WorkflowShareImportPreview {
  const base = preview()
  const rootOccurrence = {
    workflowRef: "root",
    nodeId: "node-1",
    nodeName: "生成日报",
    nodeType: "model",
    fieldPath: ["config", "model"],
    inherited: false,
  }
  const childOccurrence = {
    workflowRef: "child",
    nodeId: "node-2",
    nodeName: "整理附件",
    nodeType: "resource",
    fieldPath: ["config", "path"],
    inherited: false,
  }
  return {
    ...base,
    shareNote: "导入后需要检查日报项目和附件目录。",
    content: {
      entrypoints: ["root"],
      workflows: [
        { ref: "root", name: "日报", nodeCount: 3, sourceRevision: "source-1", action: "create" },
        { ref: "child", name: "附件整理", nodeCount: 2, sourceRevision: "source-2", action: "update", targetWorkflowId: "local-child" },
      ],
    },
    compatibility: {
      ...base.compatibility,
      requiredCapabilities: [{ id: "workflow.model", minVersion: "1.0.0" }],
      sensitiveLocations: [{ ...rootOccurrence, fieldPath: ["config", "token"] }],
      highRiskLocations: [{ ...rootOccurrence, code: "shell-command", message: "节点会执行本地命令。" }],
      portabilityWarnings: [{ ...childOccurrence, code: "local-path", message: "路径需要重新选择。" }],
      excludedAutomationCount: 1,
      automationUpdates: [{ id: "automation-1", name: "日报定时任务", action: "disable", reason: "工作流参数已变化" }],
    },
    mappings: {
      models: [{
        id: "model-1",
        environment: "synapse",
        sourceProviderId: "openai",
        sourceProviderName: "OpenAI",
        sourceModelTier: "default",
        sourceModelName: "gpt-5.4",
        occurrences: [rootOccurrence],
      }],
      projects: [{
        id: "project-1",
        sourceProjectId: "source-project",
        sourceProjectName: "日报项目",
        sourceProjectType: "git",
        occurrences: [rootOccurrence],
      }],
      resources: [{
        id: "resource-1",
        kind: "local_path",
        entryType: "directory",
        cardinality: "one",
        access: "read-write",
        displayName: "附件目录",
        occurrences: [childOccurrence],
      }],
      environments: [{
        id: "environment-1",
        kind: "shell",
        occurrences: [rootOccurrence],
      }],
    },
    providerOptions: [{
      providerId: "local-openai",
      providerName: "本地 OpenAI",
      models: { default: "gpt-5.4", haiku: undefined, sonnet: undefined, opus: undefined },
    }],
    projectOptions: [{ id: "local-project", name: "本地日报项目", type: "git" }],
    suggestions: {
      models: [{ sourceRefId: "model-1", action: "map", targetProviderId: "local-openai", targetModelTier: "default" }],
      projects: [{ sourceRefId: "project-1", targetProjectId: "local-project" }],
      resources: [{ sourceRefId: "resource-1", target: { kind: "local_path", path: "/tmp/attachments" } }],
      environments: [{ sourceRefId: "environment-1", action: "replace", targetValue: "/bin/zsh" }],
    },
    summary: {
      ...base.summary,
      updateCount: 1,
      undoAvailable: true,
      transactionalBackup: true,
      incompatiblePresetCount: 1,
    },
  }
}

function renderDialog(value: WorkflowShareImportPreview) {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  const onImport = vi.fn()
  act(() => {
    root.render(<WorkflowShareImportDialog open preview={value} onOpenChange={vi.fn()} onImport={onImport} />)
  })
  return { onImport }
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.body.querySelectorAll("button")).find((item) => item.textContent?.trim() === label)
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`)
  return match
}

describe("WorkflowShareImportDialog", () => {
  it("keeps six fixed steps while skipping empty mapping steps", () => {
    renderDialog(preview())
    expect(document.body.textContent).toContain("1 / 6 · 内容")
    act(() => button("下一步").click())
    expect(document.body.textContent).toContain("2 / 6 · 风险与兼容")
    act(() => button("下一步").click())
    expect(document.body.textContent).toContain("6 / 6 · 确认")
    act(() => button("上一步").click())
    expect(document.body.textContent).toContain("2 / 6 · 风险与兼容")
  })

  it("submits automatically completed selections from the confirmation step", () => {
    const { onImport } = renderDialog(preview())
    act(() => button("下一步").click())
    act(() => button("下一步").click())
    act(() => button("导入工作流").click())
    expect(onImport).toHaveBeenCalledWith({ models: [], projects: [], resources: [], environments: [] })
  })

  it("blocks confirmation when required capabilities are unavailable", () => {
    renderDialog(preview({
      compatibility: {
        ...preview().compatibility,
        supported: false,
        issues: ["缺少能力 app.example@1.0.0"],
      },
    }))
    act(() => button("下一步").click())
    act(() => button("下一步").click())
    expect(button("导入工作流").disabled).toBe(true)
    expect(document.body.textContent).toContain("缺少能力")
  })

  it("uses adaptive height and presents every populated step with compact readable sections", () => {
    renderDialog(fullPreview())

    const content = document.body.querySelector('[data-slot="dialog-content"]')
    const body = document.body.querySelector('[data-slot="dialog-frame-body"]')
    expect(content?.className).toContain("max-h-[calc(100vh-2rem)]")
    expect(content?.className).not.toContain("h-[min(640px")
    expect(body?.className).toContain("max-h-[min(30rem,calc(100vh-10rem))]")
    expect(body?.className).toContain("overflow-y-auto")
    expect(document.body.textContent).toContain("导入后需要检查日报项目和附件目录。")
    expect(document.body.textContent).toContain("入口")
    expect(document.body.textContent).toContain("依赖")

    if (!(body instanceof HTMLDivElement)) throw new Error("Dialog body not found")
    body.scrollTop = 120
    act(() => button("下一步").click())
    expect(body.scrollTop).toBe(0)
    expect(document.body.textContent).toContain("来源未验证")
    expect(document.body.textContent).toContain("敏感信息")
    expect(document.body.textContent).toContain("高风险配置")
    expect(document.body.textContent).toContain("兼容提醒")
    expect(document.body.textContent).toContain("必需能力")
    expect(document.body.textContent).toContain("导入影响")

    act(() => button("下一步").click())
    expect(document.body.textContent).toContain("3 / 6 · 模型映射")
    expect(document.body.textContent).toContain("发送方模型")
    expect(document.body.textContent).toContain("gpt-5.4")

    act(() => button("下一步").click())
    expect(document.body.textContent).toContain("4 / 6 · 项目映射")
    expect(document.body.textContent).toContain("发送方项目")
    expect(document.body.textContent).toContain("日报项目")

    act(() => button("下一步").click())
    expect(document.body.textContent).toContain("5 / 6 · 外部依赖")
    expect(document.body.textContent).toContain("文件与目录")
    expect(document.body.textContent).toContain("本地资源")
    expect(document.body.querySelector('input[aria-label="shell替换值"]')).not.toBeNull()

    act(() => button("下一步").click())
    expect(document.body.textContent).toContain("6 / 6 · 确认")
    expect(document.body.textContent).toContain("变更摘要")
    expect(document.body.textContent).toContain("依赖映射")
    expect(document.body.textContent).toContain("导入保障")
    expect(document.body.textContent).toContain("完成后可撤销本次导入")
  })

  it("preserves model choices when navigating backward", () => {
    renderDialog(fullPreview())
    act(() => button("下一步").click())
    act(() => button("下一步").click())

    act(() => button("本地默认").click())
    expect(button("本地默认").dataset.variant).toBe("secondary")
    act(() => button("下一步").click())
    act(() => button("上一步").click())
    expect(button("本地默认").dataset.variant).toBe("secondary")
  })

  it("only shows an environment value field when replacement is selected", () => {
    const value = fullPreview()
    renderDialog({
      ...value,
      suggestions: {
        ...value.suggestions,
        environments: [{ sourceRefId: "environment-1", action: "reuse" }],
      },
    })
    act(() => button("下一步").click())
    act(() => button("下一步").click())
    act(() => button("下一步").click())
    act(() => button("下一步").click())

    expect(document.body.textContent).toContain("5 / 6 · 外部依赖")
    expect(document.body.textContent).toContain("保留原值")
    expect(document.body.querySelector('input[aria-label="shell替换值"]')).toBeNull()
  })
})
