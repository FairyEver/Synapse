/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ScheduledTask } from "@/types/task-scheduler"
import { TaskExportDialog } from "../task-export-dialog"

const { track } = vi.hoisted(() => ({
  track: vi.fn(),
}))

vi.mock("@/lib/ui-tracking", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ui-tracking")>("@/lib/ui-tracking")
  return {
    ...actual,
    track,
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

  it("tracks export submits with a sanitized selected task summary", async () => {
    const onExport = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <TaskExportDialog
          open
          tasks={[task("task-a"), task("task-b", "builtin.command")]}
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
      buttonByText("导出").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onExport).toHaveBeenCalledWith(["task-a"])
    expect(track).toHaveBeenCalledWith({
      component: "task-scheduler",
      name: "task-export-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.task-scheduler.export.dialog",
        taskCount: 2,
        selectedCount: 1,
        agentTaskCount: 1,
        actionTypes: ["builtin.agent"],
        triggerTypes: ["builtin.interval"],
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("hello")
  })
})

function task(id: string, actionType = "builtin.agent"): ScheduledTask {
  return {
    id,
    schemaVersion: 2,
    name: id,
    scope: { type: "global" },
    trigger: { type: "builtin.interval", config: { everyMinutes: 5 } },
    action: { type: actionType, config: { prompt: "hello" } },
    enabled: true,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
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
