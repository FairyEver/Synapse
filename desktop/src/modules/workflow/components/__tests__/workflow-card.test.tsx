/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowMeta } from "@/types/workflow"
import { WorkflowCard } from "../workflow-card"

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
}))

vi.mock("@/lib/ui-tracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ui-tracking")>()
  return {
    ...actual,
    track: mocks.track,
    extractLabel: (element: EventTarget | null) =>
      element instanceof HTMLElement ? element.getAttribute("aria-label") ?? undefined : undefined,
  }
})

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
  vi.clearAllMocks()
})

describe("WorkflowCard", () => {
  it("gives icon actions stable labels and tracking names", async () => {
    const onRun = vi.fn()
    const onHistory = vi.fn()
    const onDelete = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <WorkflowCard
          meta={workflowMeta}
          onOpen={vi.fn()}
          onRun={onRun}
          onHistory={onHistory}
          onDelete={onDelete}
        />,
      )
    })

    const runButton = container.querySelector<HTMLButtonElement>('[aria-label="运行工作流"]')
    const historyButton = container.querySelector<HTMLButtonElement>('[aria-label="查看运行历史"]')
    const deleteButton = container.querySelector<HTMLButtonElement>('[aria-label="删除工作流"]')

    expect(runButton).toBeTruthy()
    expect(historyButton).toBeTruthy()
    expect(deleteButton).toBeTruthy()

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      historyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onHistory).toHaveBeenCalledTimes(1)
    expect(mocks.track).toHaveBeenCalledWith({
      component: "button",
      name: "workflow-card-run",
      action: "click",
    })
    expect(mocks.track).toHaveBeenCalledWith({
      component: "button",
      name: "workflow-card-history",
      action: "click",
    })
    expect(mocks.track).toHaveBeenCalledWith({
      component: "button",
      name: "workflow-card-delete-open",
      action: "click",
    })
  })
})

const workflowMeta: WorkflowMeta = {
  id: "workflow-1",
  name: "Nightly Check",
  version: "v1",
  nodeCount: 3,
  createdAt: 0,
  updatedAt: 0,
}
