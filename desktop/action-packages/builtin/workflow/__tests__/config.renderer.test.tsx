// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkflowConfigForm } from "../config.renderer"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const workflowApi = {
  list: vi.fn(),
  get: vi.fn(),
}

describe("WorkflowConfigForm", () => {
  beforeEach(() => {
    workflowApi.list.mockResolvedValue({
      items: [{ id: "wf-1", name: "每日汇总", version: "v1", nodeCount: 2, createdAt: 1, updatedAt: 2 }],
      migrationDiagnostics: [],
    })
    workflowApi.get.mockResolvedValue({
      id: "wf-1",
      name: "每日汇总",
      version: "v1",
      createdAt: 1,
      updatedAt: 2,
      params: [{ name: "topic", type: "text", default: null, description: "主题" }],
      nodes: [],
      edges: [],
    })
    ;(window as unknown as { synapse: { workflow: typeof workflowApi } }).synapse = {
      workflow: workflowApi,
    }
  })

  afterEach(() => {
    document.body.innerHTML = ""
    vi.clearAllMocks()
  })

  it("loads the selected workflow and renders parameter templates", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const onChange = vi.fn()

    await act(async () => {
      root.render(<WorkflowConfigForm value={{ workflowId: "wf-1", paramTemplates: {} }} onChange={onChange} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(workflowApi.list).toHaveBeenCalled()
    expect(workflowApi.get).toHaveBeenCalledWith("wf-1")
    expect(host.textContent).toContain("每日汇总")
    expect(host.textContent).toContain("主题")

    const input = host.querySelector<HTMLTextAreaElement>("#automation-workflow-param-topic")
    expect(input).not.toBeNull()

    await act(async () => {
      if (!input) return
      changeTextarea(input, "{{trigger.request.body.title}}")
    })

    expect(onChange).toHaveBeenCalledWith({
      workflowId: "wf-1",
      paramTemplates: { topic: "{{trigger.request.body.title}}" },
    })
  })
})

function changeTextarea(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  if (!setter) throw new Error("Textarea value setter not found")
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}
