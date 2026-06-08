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
  it("renders concise idle cache copy and the new conversation action", async () => {
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

    expect(container.textContent).toContain("继续当前对话可能按完整上下文计费，您可以")
    expect(container.textContent).toContain("新建对话")
    expect(container.textContent).not.toContain("这个对话已经很长")
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
