/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ScriptConfirmationDialog } from "../script-confirmation-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const firstSource = "self.onmessage = event => {\n  postMessage(event.data)\n}"
const secondSource = "process.stdout.write(JSON.stringify({ complete: true }))\n// source-end-marker"
const scripts = [
  {
    workflowName: "Imported parent",
    runtime: "JavaScript",
    nodeName: "Browser script",
    source: firstSource,
  },
  {
    workflowName: "Imported child",
    runtime: "Node.js",
    nodeName: "Node script",
    source: secondSource,
  },
]

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
})

describe("ScriptConfirmationDialog", () => {
  it("shows every script with its workflow, runtime, node, and complete source", () => {
    renderDialog({ onCancel: vi.fn(), onConfirm: vi.fn() })

    expect(document.body.textContent).toContain("Imported parent")
    expect(document.body.textContent).toContain("JavaScript")
    expect(document.body.textContent).toContain("Browser script")
    expect(sourceByLabel("Imported parent Browser script 源码").textContent).toBe(firstSource)
    expect(document.body.textContent).toContain("Imported child")
    expect(document.body.textContent).toContain("Node.js")
    expect(document.body.textContent).toContain("Node script")
    expect(sourceByLabel("Imported child Node script 源码").textContent).toBe(secondSource)
  })

  it("confirms only through the explicit confirmation action", () => {
    const onConfirm = vi.fn()
    renderDialog({ onCancel: vi.fn(), onConfirm })

    act(() => {
      buttonByText("确认并运行").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("treats cancel and close as rejection", () => {
    const onCancel = vi.fn()
    const root = renderDialog({ onCancel, onConfirm: vi.fn() })

    act(() => {
      buttonByText("取消").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledOnce()

    act(() => {
      root.render(
        <ScriptConfirmationDialog
          open
          scripts={scripts}
          onCancel={onCancel}
          onConfirm={vi.fn()}
        />,
      )
    })
    act(() => {
      buttonByText("关闭").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it("cannot close through Escape, outside dismissal, or the header while confirming", () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel, onConfirm: vi.fn(), confirming: true })

    expect([...document.querySelectorAll("button")]
      .some((button) => button.textContent?.trim() === "关闭")).toBe(false)
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    })

    expect(onCancel).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("确认运行导入脚本")
  })
})

function renderDialog(callbacks: {
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly confirming?: boolean
}): Root {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <ScriptConfirmationDialog
        open
        scripts={scripts}
        confirming={callbacks.confirming}
        onCancel={callbacks.onCancel}
        onConfirm={callbacks.onConfirm}
      />,
    )
  })
  return root
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`)
  return button
}

function sourceByLabel(label: string): HTMLElement {
  const source = document.querySelector(`[aria-label="${label}"]`)
  if (!(source instanceof HTMLElement)) throw new Error(`Source not found: ${label}`)
  return source
}
