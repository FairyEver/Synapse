/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { TaskExportEntry } from "../../types"
import { TaskImportDialog } from "../task-import-dialog"

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

describe("TaskImportDialog", () => {
  it("resets selected indices when import entries change", async () => {
    const onImport = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <TaskImportDialog
          open
          entries={[entry("first"), entry("second")]}
          onImport={onImport}
          onOpenChange={vi.fn()}
        />,
      )
    })
    expect(document.body.textContent).toContain("已选 2 项")

    await act(async () => {
      root.render(
        <TaskImportDialog
          open
          entries={[entry("replacement")]}
          onImport={onImport}
          onOpenChange={vi.fn()}
        />,
      )
    })

    expect(document.body.textContent).toContain("已选 1 项")
    await act(async () => {
      buttonByText("导入").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onImport).toHaveBeenCalledWith([0])
  })

  it("tracks import submits with a sanitized selected entry summary", async () => {
    const onImport = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <TaskImportDialog
          open
          entries={[entry("agent-task"), entry("command-task", "builtin.command")]}
          onImport={onImport}
          onOpenChange={vi.fn()}
        />,
      )
    })

    await act(async () => {
      checkboxAt(2).dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(document.body.textContent).toContain("已选 1 项")

    await act(async () => {
      buttonByText("导入").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onImport).toHaveBeenCalledWith([0])
    expect(track).toHaveBeenCalledWith({
      component: "task-scheduler",
      name: "task-import-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.task-scheduler.import.dialog",
        entryCount: 2,
        selectedCount: 1,
        agentTaskCount: 1,
        actionTypes: ["builtin.agent"],
        triggerTypes: ["builtin.interval"],
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("hello")
  })
})

function entry(name: string, actionType = "builtin.agent"): TaskExportEntry {
  return {
    name,
    scope: { type: "global" },
    trigger: {
      type: "builtin.interval",
      config: { everyMinutes: 5 },
    },
    action: {
      type: actionType,
      config: { prompt: "hello" },
    },
    missedRunPolicy: "skip",
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

function checkboxAt(index: number): HTMLButtonElement {
  const checkbox = Array.from(document.body.querySelectorAll("[role='checkbox']")).at(index)
  if (!(checkbox instanceof HTMLButtonElement)) throw new Error(`Checkbox not found: ${index}`)
  return checkbox
}
