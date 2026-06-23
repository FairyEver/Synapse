/**
 * @vitest-environment jsdom
 */
import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkflowCallNodeCard } from "../card"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots.length = 0
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: unknown }).synapse
  vi.clearAllMocks()
})

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("WorkflowCallNodeCard", () => {
  it("shows the selected workflow name instead of the raw workflow id", async () => {
    const workflowId = "0650653b-14c7-4281-8203-5022e6d1d1d1"
    const workflowGet = vi.fn().mockResolvedValue({
      id: workflowId,
      name: "写作业 V1",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [],
      nodes: [],
      edges: [],
    })
    ;(window as unknown as { synapse: { workflow: { get: typeof workflowGet } } }).synapse = {
      workflow: { get: workflowGet },
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(React.createElement(WorkflowCallNodeCard, {
        config: { workflowId, variables: [], paramTemplates: {}, paramBindings: {} },
        name: "调用工作流",
      }))
    })
    await flushEffects()

    expect(workflowGet).toHaveBeenCalledWith(workflowId)
    expect(container.textContent).toContain("写作业 V1")
    expect(container.textContent).not.toContain(workflowId)
  })

  it("shows a missing child workflow state when the selected workflow no longer exists", async () => {
    const workflowGet = vi.fn().mockResolvedValue(null)
    ;(window as unknown as { synapse: { workflow: { get: typeof workflowGet } } }).synapse = {
      workflow: { get: workflowGet },
    }

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(React.createElement(WorkflowCallNodeCard, {
        config: { workflowId: "deleted-child", variables: [], paramTemplates: {}, paramBindings: {} },
        name: "调用工作流",
      }))
    })
    await flushEffects()

    expect(workflowGet).toHaveBeenCalledWith("deleted-child")
    expect(container.textContent).toContain("子工作流不存在")
    expect(container.textContent).not.toContain("已选择工作流")
  })
})
