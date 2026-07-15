/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from "react"
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
    const container = await renderWorkflowCard({ onOpen })

    const copyIdButton = container.querySelector<HTMLButtonElement>('[aria-label="复制工作流 ID"]')
    expect(copyIdButton?.textContent).toBe("WORKFL")

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
    const container = await renderWorkflowCard({ onRun, onHistory, onExport, onDelete })

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
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("deletes immediately when Alt-clicking the delete action", async () => {
    const onDelete = vi.fn()
    const container = await renderWorkflowCard({ onDelete })

    const deleteButton = container.querySelector<HTMLButtonElement>('[aria-label="删除工作流"]')

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }))
    })

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain("确定删除")
  })

  it("confirms deletion without opening the workflow", async () => {
    const onOpen = vi.fn()
    const onDelete = vi.fn()
    const container = await renderWorkflowCard({ onOpen, onDelete })

    await openDeleteDialog(container)
    const confirmButton = findButtonByText("删除")

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("cancels deletion without opening the workflow", async () => {
    const onOpen = vi.fn()
    const onDelete = vi.fn()
    const container = await renderWorkflowCard({ onOpen, onDelete })

    await openDeleteDialog(container)
    const overlay = document.body.querySelector<HTMLElement>('[data-slot="alert-dialog-overlay"]')

    await act(async () => {
      overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(onOpen).not.toHaveBeenCalled()
    const cancelButton = findButtonByText("取消")

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(onDelete).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("opens the active run from the progress action", async () => {
    const onOpenActiveRun = vi.fn()
    const container = await renderWorkflowCard({
      runState: { status: "running", runId: "active-run" },
      running: false,
      onOpenActiveRun,
    })

    const progressButton = container.querySelector<HTMLButtonElement>('[aria-label="查看进度"]')
    expect(progressButton).toBeTruthy()

    await act(async () => {
      progressButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onOpenActiveRun).toHaveBeenCalledWith("active-run")
  })

  it("marks malformed workflows and disables unsafe actions", async () => {
    const onRun = vi.fn()
    const onExport = vi.fn()
    const container = await renderWorkflowCard({
      meta: { ...workflowMeta, loadError: "工作流数据格式异常" },
      onRun,
      onExport,
    })

    expect(container.textContent).toContain("数据异常")
    const runButton = container.querySelector<HTMLButtonElement>('[aria-label="运行工作流"]')
    const exportButton = container.querySelector<HTMLButtonElement>('[aria-label="导出工作流"]')
    expect(runButton?.disabled).toBe(true)
    expect(exportButton?.disabled).toBe(true)
  })

  it("allows raw export but not execution for future-schema workflows", async () => {
    const onRun = vi.fn()
    const onExport = vi.fn()
    const container = await renderWorkflowCard({
      meta: {
        ...workflowMeta,
        loadError: "工作流由更高版本创建",
        rawExportAvailable: true,
      },
      onRun,
      onExport,
    })

    const runButton = container.querySelector<HTMLButtonElement>('[aria-label="运行工作流"]')
    const exportButton = container.querySelector<HTMLButtonElement>('[aria-label="导出工作流原文"]')
    expect(runButton?.disabled).toBe(true)
    expect(exportButton?.disabled).toBe(false)

    await act(async () => {
      exportButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onExport).toHaveBeenCalledOnce()
    expect(onRun).not.toHaveBeenCalled()
  })
})

async function renderWorkflowCard(props: Partial<ComponentProps<typeof WorkflowCard>> = {}): Promise<HTMLDivElement> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <table>
        <tbody>
          <WorkflowCard
            meta={workflowMeta}
            onOpen={vi.fn()}
            onRun={vi.fn()}
            onOpenActiveRun={vi.fn()}
            onHistory={vi.fn()}
            onExport={vi.fn()}
            onDelete={vi.fn()}
            {...props}
          />
        </tbody>
      </table>,
    )
  })

  return container
}

async function openDeleteDialog(container: HTMLDivElement): Promise<void> {
  const deleteButton = container.querySelector<HTMLButtonElement>('[aria-label="删除工作流"]')
  await act(async () => {
    deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
}

function findButtonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === text)
}

const workflowMeta: WorkflowMeta = {
  id: "workflow-1",
  name: "Nightly Check",
  version: "v1",
  nodeCount: 3,
  createdAt: 0,
  updatedAt: 0,
}
