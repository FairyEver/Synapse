/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ScheduledTask } from "@/types/task-scheduler"
import { TaskExportDialog } from "../task-export-dialog"

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
})

describe("TaskExportDialog", () => {
  it("prunes selected task ids when the task list changes", async () => {
    const onExport = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <TaskExportDialog
          open
          tasks={[task("task-a"), task("task-b")]}
          onExport={onExport}
          onOpenChange={vi.fn()}
        />,
      )
    })

    await act(async () => {
      checkboxAt(1).dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(document.body.textContent).toContain("已选 1 项")

    await act(async () => {
      root.render(
        <TaskExportDialog
          open
          tasks={[task("task-b")]}
          onExport={onExport}
          onOpenChange={vi.fn()}
        />,
      )
    })

    expect(document.body.textContent).toContain("已选 0 项")
    expect(buttonByText("导出").disabled).toBe(true)
  })
})

function task(id: string): ScheduledTask {
  return {
    id,
    schemaVersion: 2,
    name: id,
    scope: { type: "global" },
    trigger: { type: "builtin.interval", config: { everyMinutes: 5 } },
    action: { type: "builtin.agent", config: { prompt: "hello" } },
    enabled: true,
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    runCount: 0,
  }
}

function checkboxAt(index: number): HTMLButtonElement {
  const checkbox = document.body.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[index]
  if (!checkbox) throw new Error(`Checkbox not found: ${index}`)
  return checkbox
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}
