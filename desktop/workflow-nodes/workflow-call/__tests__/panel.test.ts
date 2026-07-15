/**
 * @vitest-environment jsdom
 */
import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkflowCallNodePanel } from "../panel"
import type { WorkflowCallNodePanelProps } from "../panel"
import type { WorkflowCallNodeConfig } from "../schema"

const workflowList = vi.fn()
const workflowGet = vi.fn()

Object.defineProperty(window, "synapse", {
  value: {
    workflow: {
      list: workflowList,
      get: workflowGet,
    },
  },
  configurable: true,
})

if (!globalThis.PointerEvent) {
  globalThis.PointerEvent = MouseEvent as never
}

Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
  configurable: true,
  value: () => false,
})
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
  configurable: true,
  value: vi.fn(),
})
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
  configurable: true,
  value: vi.fn(),
})
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  workflowList.mockReset()
  workflowGet.mockReset()
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

function renderPanel(
  config: WorkflowCallNodeConfig,
  onChange = vi.fn(),
  workflowParams: WorkflowCallNodePanelProps["workflowParams"] = [{ name: "topic", type: "text", default: null }],
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(React.createElement(WorkflowCallNodePanel, {
      config,
      onChange,
      upstreamNodes: [],
      workflowParams,
      projects: [],
      currentWorkflowId: "parent",
    }))
  })
  return { container, onChange }
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("WorkflowCallNodePanel", () => {
  it("loads child params and renders parameter templates", async () => {
    workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
    workflowGet.mockResolvedValue({
      id: "child",
      name: "子工作流",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [{ name: "topic", type: "text", default: null, description: "主题" }],
      nodes: [],
      edges: [],
    })

    const { container } = renderPanel({ workflowId: "child", variables: [], paramTemplates: { topic: "请总结 {{topic}}" }, paramBindings: {} })
    await flushEffects()

    expect(container.textContent).toContain("子工作流")
    expect(container.textContent).toContain("主题")
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("请总结 {{topic}}")
  })

  it("does not list the current workflow as a child option", async () => {
    workflowList.mockResolvedValue([
      { id: "parent", name: "父工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 },
      { id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 },
    ])
    workflowGet.mockResolvedValue(null)

    const { container } = renderPanel({ workflowId: "", variables: [], paramTemplates: {}, paramBindings: {} })
    await flushEffects()

    const trigger = container.querySelector<HTMLElement>("[role='combobox']")
    await act(async () => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))
      trigger?.click()
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("子工作流")
    expect(document.body.textContent).not.toContain("父工作流")
  })

  it("shows a missing child workflow state when the selected workflow no longer exists", async () => {
    workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
    workflowGet.mockResolvedValue(null)

    const { container } = renderPanel({ workflowId: "deleted-child", variables: [], paramTemplates: {}, paramBindings: {} })
    await flushEffects()

    expect(workflowGet).toHaveBeenCalledWith("deleted-child")
    expect(container.textContent).toContain("子工作流不存在")
  })

  it("updates templates on blur", async () => {
    workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
    workflowGet.mockResolvedValue({
      id: "child",
      name: "子工作流",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [{ name: "topic", type: "text", default: null }],
      nodes: [],
      edges: [],
    })
    const { container, onChange } = renderPanel({ workflowId: "child", variables: [], paramTemplates: { topic: "" }, paramBindings: {} })
    await flushEffects()

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    await act(async () => {
      if (!textarea) throw new Error("textarea not found")
      setTextareaValue(textarea, "请总结 {{topic}}")
      await Promise.resolve()
    })
    await act(async () => {
      textarea?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
      await Promise.resolve()
    })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      paramTemplates: { topic: "请总结 {{topic}}" },
    }))
  })

  it("auto-fills same-name parent params and bindings when child params load", async () => {
    workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
    workflowGet.mockResolvedValue({
      id: "child",
      name: "子工作流",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [{ name: "topic", type: "text", default: null }],
      nodes: [],
      edges: [],
    })

    const { onChange } = renderPanel({ workflowId: "child", variables: [], paramTemplates: {}, paramBindings: {} })
    await flushEffects()

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      variables: [{ name: "topic", source: { type: "param", param: "topic" } }],
      paramTemplates: { topic: "{{topic}}" },
      paramBindings: {},
    }))
  })

  it("auto-fills same-name resource params as value bindings", async () => {
    workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
    workflowGet.mockResolvedValue({
      id: "child",
      name: "子工作流",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [{ name: "input_file", type: "file", default: null }],
      nodes: [],
      edges: [],
    })

    const { onChange } = renderPanel(
      { workflowId: "child", variables: [], paramTemplates: {}, paramBindings: {} },
      vi.fn(),
      [{ name: "input_file", type: "file", default: null }],
    )
    await flushEffects()

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      variables: [],
      paramTemplates: {},
      paramBindings: {
        input_file: { mode: "value", source: { type: "param", param: "input_file" } },
      },
    }))
  })

  it("does not auto-fill a template when a multi-resource child param has no compatible parent", async () => {
    workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
    workflowGet.mockResolvedValue({
      id: "child",
      name: "子工作流",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [{ name: "input_files", type: "file", default: null, allowMultiple: true }],
      nodes: [],
      edges: [],
    })

    const { onChange } = renderPanel(
      { workflowId: "child", variables: [], paramTemplates: {}, paramBindings: {} },
      vi.fn(),
      [{ name: "input_files", type: "text", default: null }],
    )
    await flushEffects()

    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({
      paramTemplates: { input_files: "{{input_files}}" },
    }))
  })

  it("does not flag a legacy static binding for a single-resource child param", async () => {
    workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
    workflowGet.mockResolvedValue({
      id: "child",
      name: "子工作流",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [{ name: "input_file", type: "file", default: null }],
      nodes: [],
      edges: [],
    })

    const { container } = renderPanel({
      workflowId: "child",
      variables: [],
      paramTemplates: {},
      paramBindings: {
        input_file: { mode: "value", source: { type: "static", value: "/tmp/input.txt" } },
      },
    })
    await flushEffects()

    expect(container.textContent).not.toContain("绑定参数的资源类型或多选设置不一致")
  })

  it("warns when an existing resource binding has mismatched cardinality", async () => {
    workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
    workflowGet.mockResolvedValue({
      id: "child",
      name: "子工作流",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [{ name: "input_file", type: "file", default: null, allowMultiple: true }],
      nodes: [],
      edges: [],
    })

    const { container } = renderPanel(
      {
        workflowId: "child",
        variables: [],
        paramTemplates: {},
        paramBindings: {
          input_file: { mode: "value", source: { type: "param", param: "input_file" } },
        },
      },
      vi.fn(),
      [{ name: "input_file", type: "file", default: null }],
    )
    await flushEffects()

    expect(container.textContent).toContain("绑定参数的资源类型或多选设置不一致")
  })
})
