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
})
