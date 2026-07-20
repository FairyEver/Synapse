/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WorkflowShareExportPreflight } from "@/types/workflow-package"
import { WorkflowExportDialog } from "../workflow-export-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView = vi.fn()

const roots: Root[] = []
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.innerHTML = ""
})

function preflight(blockers: string[] = []): WorkflowShareExportPreflight {
  return {
    workflowId: "workflow-1",
    workflowName: "日报",
    shareNote: "运行参数：日期",
    entrypoints: ["root"],
    workflows: [{ ref: "root", id: "workflow-1", name: "日报", revision: "v1", nodeCount: 3 }],
    references: {
      models: [],
      projects: [],
      resources: [{
        id: "resource-1",
        kind: "local_path",
        entryType: "file",
        cardinality: "one",
        access: "read",
        displayName: "template.docx",
        sourceIdentity: "/private/template.docx",
        occurrences: [{ workflowRef: "root", nodeId: "doc", nodeName: "生成文档", nodeType: "document_template_docx_generate", fieldPath: ["templatePath"], inherited: false }],
      }],
      environments: [],
      runtimes: [],
    },
    requiredCapabilities: [],
    risks: {
      sensitiveLocations: [{ workflowRef: "root", nodeId: "http", nodeName: "请求", nodeType: "http_request", fieldPath: ["headers", "Authorization"] }],
      highRiskLocations: [],
      portabilityWarnings: [],
      excludedAutomationCount: 1,
    },
    blockers,
    packageDigestSeed: "digest",
  }
}

function render(value = preflight()) {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  const onExport = vi.fn()
  act(() => root.render(
    <WorkflowExportDialog open preflight={value} exporting={false} onOpenChange={vi.fn()} onExport={onExport} />,
  ))
  return { onExport }
}

describe("WorkflowExportDialog", () => {
  it("shows excluded local resources and sensitive locations without exposing their values", () => {
    render()
    expect(document.body.textContent).toContain("template.docx")
    expect(document.body.textContent).toContain("请求")
    expect(document.body.textContent).toContain("headers.Authorization")
    expect(document.body.textContent).not.toContain("/private/template.docx")
    expect(document.body.textContent).toContain("1 个关联 Automation 不会导出")
  })

  it("submits the editable share note and blocks export when preflight has blockers", () => {
    const { onExport } = render()
    const textarea = document.body.querySelector("textarea")
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("Textarea missing")
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(textarea, "请先准备模板")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const exportButton = Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent === "导出文件")
    act(() => exportButton?.click())
    expect(onExport).toHaveBeenCalledWith("请先准备模板")

    act(() => roots[0].render(
      <WorkflowExportDialog open preflight={preflight(["存在循环调用"])} exporting={false} onOpenChange={vi.fn()} onExport={onExport} />,
    ))
    expect((Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent === "导出文件") as HTMLButtonElement).disabled).toBe(true)
  })
})
