/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentConversationRolloverPrompt } from "../agent-conversation-rollover-prompt"

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

describe("AgentConversationRolloverPrompt", () => {
  it("renders concise long-conversation copy and the start action", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentConversationRolloverPrompt
          disabled={false}
          onStartNewConversation={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("这个对话已经很长")
    expect(container.textContent).toContain("新对话会保留当前项目和模型。")
    expect(container.textContent).toContain("开始新对话")
    expect(container.querySelector("button")?.getAttribute("disabled")).toBeNull()
  })

  it("calls onStartNewConversation when the button is clicked", async () => {
    const onStartNewConversation = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentConversationRolloverPrompt
          disabled={false}
          onStartNewConversation={onStartNewConversation}
        />,
      )
    })

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onStartNewConversation).toHaveBeenCalledTimes(1)
  })

  it("disables the action while unavailable", async () => {
    const onStartNewConversation = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentConversationRolloverPrompt
          disabled
          onStartNewConversation={onStartNewConversation}
        />,
      )
    })

    const button = container.querySelector("button")
    expect(button?.getAttribute("disabled")).toBe("")
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onStartNewConversation).not.toHaveBeenCalled()
  })
})
