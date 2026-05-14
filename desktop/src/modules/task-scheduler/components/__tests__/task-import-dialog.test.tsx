/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { TaskExportEntry } from "../../types"
import { TaskImportDialog } from "../task-import-dialog"

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
})

function entry(name: string): TaskExportEntry {
  return {
    name,
    scope: { type: "global" },
    trigger: {
      type: "builtin.interval",
      config: { everyMinutes: 5 },
    },
    action: {
      type: "builtin.agent",
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
