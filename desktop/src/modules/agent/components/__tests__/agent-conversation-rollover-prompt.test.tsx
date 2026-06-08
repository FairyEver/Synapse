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
  it("renders a lightweight composer note and the new conversation action", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentConversationRolloverPrompt
          onStartNewConversation={vi.fn()}
        />,
      )
    })

    const prompt = container.querySelector(".agent-conversation-rollover-prompt")
    expect(prompt).toBeTruthy()
    expect(container.textContent).toContain("已空闲较久，继续对话可能无法命中缓存")
    expect(container.textContent).toContain("新建对话")
    expect(container.textContent).not.toContain("完整上下文计费")
    expect(container.textContent).not.toContain("您可以")
    expect(container.textContent).not.toContain("这个对话已经很长")
    expect(prompt?.className).not.toContain("border")
    expect(prompt?.className).not.toContain("bg-")
    expect(prompt?.className).not.toContain("rounded")
    expect(prompt?.className).toContain("text-xs")
    expect(container.querySelector("button")?.className).toContain("text-xs")
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
          onStartNewConversation={onStartNewConversation}
        />,
      )
    })

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onStartNewConversation).toHaveBeenCalledTimes(1)
  })
})
