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
  toast: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: mocks.toast,
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
  it("copies the workflow id without opening the workflow", async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const onOpen = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <WorkflowCard
          meta={workflowMeta}
          onOpen={onOpen}
          onRun={vi.fn()}
          onHistory={vi.fn()}
          onExport={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
    })

    const copyIdButton = container.querySelector<HTMLButtonElement>('[aria-label="复制工作流 ID"]')
    expect(copyIdButton?.textContent).toContain("workflow-1")

    await act(async () => {
      copyIdButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(writeText).toHaveBeenCalledWith("workflow-1")
    expect(onOpen).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith("ID 已复制")
  })

  it("gives icon actions stable labels and tracking names", async () => {
    const onRun = vi.fn()
    const onHistory = vi.fn()
    const onExport = vi.fn()
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
          onExport={onExport}
          onDelete={onDelete}
        />,
      )
    })

    const runButton = container.querySelector<HTMLButtonElement>('[aria-label="运行工作流"]')
    const historyButton = container.querySelector<HTMLButtonElement>('[aria-label="查看运行历史"]')
    const exportButton = container.querySelector<HTMLButtonElement>('[aria-label="导出工作流"]')
    const deleteButton = container.querySelector<HTMLButtonElement>('[aria-label="删除工作流"]')

    expect(runButton).toBeTruthy()
    expect(historyButton).toBeTruthy()
    expect(exportButton).toBeTruthy()
    expect(deleteButton).toBeTruthy()

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      historyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      exportButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onHistory).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledTimes(1)
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
      name: "workflow-card-export",
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
