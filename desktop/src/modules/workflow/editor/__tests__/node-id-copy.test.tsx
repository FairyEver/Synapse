/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PromptNodeCard } from "../../../../../workflow-nodes/prompt/card"

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: mocks.toast,
}))

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
  vi.clearAllMocks()
})

describe("workflow node id copy", () => {
  it("shows a low-profile node id action that copies the node id", async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <PromptNodeCard
          config={{ prompt: "Summarize", variables: [] }}
          name="Summary"
          nodeId="prompt-123"
        />,
      )
    })

    const copyIdButton = container.querySelector<HTMLButtonElement>('[aria-label="复制节点 ID"]')
    expect(copyIdButton?.textContent).toBe("PROMPT")

    await act(async () => {
      copyIdButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(writeText).toHaveBeenCalledWith("prompt-123")
    expect(mocks.toast).toHaveBeenCalledWith("ID 已复制")
  })
})
