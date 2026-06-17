/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AgentDetachedConversation } from "@/types/agent-conversation-window"
import { AgentDetachedPlaceholder } from "../components/agent-detached-placeholder"
import { useDetachedAgentConversations } from "../hooks/use-detached-agent-conversations"

function HookProbe({ onValue }: { readonly onValue: (items: readonly AgentDetachedConversation[]) => void }) {
  const items = useDetachedAgentConversations()
  onValue(items)
  return null
}

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

describe("detached agent conversations", () => {
  afterEach(() => {
    for (const root of roots) {
      act(() => {
        root.unmount()
      })
    }
    roots = []
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
  })

  it("loads and updates detached conversations", async () => {
    const listeners: Array<(items: AgentDetachedConversation[]) => void> = []
    const first = [{
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
      windowId: 1,
      openedAt: "2026-06-17T00:00:00.000Z",
    }]
    vi.stubGlobal("synapse", {
      agent: {
        listDetachedConversationWindows: vi.fn(async () => first),
        onDetachedConversationWindowsChanged: vi.fn((listener) => {
          listeners.push(listener)
          return () => undefined
        }),
      },
    })
    const values: Array<readonly AgentDetachedConversation[]> = []

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      root.render(<HookProbe onValue={(items) => values.push(items)} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(values.at(-1)).toEqual(first)

    const next: AgentDetachedConversation[] = []
    act(() => listeners[0]?.(next))
    expect(values.at(-1)).toEqual(next)
  })

  it("detects detached conversations by project and conversation", async () => {
    const { isDetachedAgentConversation } = await import("../hooks/use-detached-agent-conversations")
    const items: AgentDetachedConversation[] = [{
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
      windowId: 1,
      openedAt: "2026-06-17T00:00:00.000Z",
    }]

    expect(isDetachedAgentConversation(items, {
      projectId: "project-1",
      conversationId: "conversation-1",
    })).toBe(true)
    expect(isDetachedAgentConversation(items, {
      projectId: "project-1",
      conversationId: "conversation-2",
    })).toBe(false)
  })

  it("renders a focused placeholder", () => {
    const onShowWindow = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    act(() => {
      root.render(<AgentDetachedPlaceholder onShowWindow={onShowWindow} />)
    })

    expect(container.textContent).toContain("已经在新窗口打开")
    expect(container.firstElementChild?.className).toContain("h-full")
    const button = container.querySelector("button")
    expect(button?.textContent).toContain("显示窗口")
    act(() => {
      button?.click()
    })

    expect(onShowWindow).toHaveBeenCalledTimes(1)
  })
})
