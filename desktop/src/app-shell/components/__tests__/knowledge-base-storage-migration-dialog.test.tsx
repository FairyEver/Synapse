/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { KnowledgeBaseStorageMigrationDialog } from "../knowledge-base-storage-migration-dialog"
import type { SynapseKnowledgeBaseStorageMigrationProgress } from "@/types/knowledge-base"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const activeProgress: SynapseKnowledgeBaseStorageMigrationProgress = {
  active: true,
  phase: "copying",
  cancellable: true,
  copiedBytes: 10,
  totalBytes: 100,
  message: "正在复制",
}

const roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots.length = 0
  document.body.innerHTML = ""
})

describe("KnowledgeBaseStorageMigrationDialog", () => {
  it("prevents closing while migration is active", () => {
    renderDialog(activeProgress)

    const dialog = getDialog()
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })

    expect(getDialog()).toBeTruthy()
    expect(buttonByText("取消迁移")).toBeTruthy()
  })

  it("disables cancellation during switching", () => {
    renderDialog({
      ...activeProgress,
      phase: "switching",
      cancellable: false,
      copiedBytes: 100,
      totalBytes: 100,
      message: "正在切换",
    })

    expect(buttonByText("正在切换").disabled).toBe(true)
  })
})

function renderDialog(progress: SynapseKnowledgeBaseStorageMigrationProgress) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <KnowledgeBaseStorageMigrationDialog
        progress={progress}
        onCancel={async () => undefined}
      />,
    )
  })
}

function getDialog(): HTMLElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!dialog) throw new Error("Dialog not found")
  return dialog
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}
