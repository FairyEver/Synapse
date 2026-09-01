/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

const { rendererLogger, track } = vi.hoisted(() => ({
  rendererLogger: {
    error: vi.fn(),
  },
  track: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/lib/ui-tracking", () => ({
  track,
}))

import { AgentMessageToolbar } from "../agent-message-toolbar"

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
  rendererLogger.error.mockReset()
  track.mockReset()
  vi.restoreAllMocks()
})

describe("AgentMessageToolbar", () => {
  it("hides invalid timestamps", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentMessageToolbar content="agent response" timestamp="not-a-date" />)
    })

    expect(container.querySelector("time")).toBeNull()
    expect(container.textContent).not.toContain("NaN")
  })

  it("renders assistant token usage with an optional prefix", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageToolbar
          content="agent response"
          timestamp="2026-05-14T00:00:00.000Z"
          usagePrefix="会话累计"
          usage={{
            input_tokens: 1234,
            output_tokens: 56,
            cache_read_input_tokens: 7890,
            cache_creation_input_tokens: 12,
          }}
        />
      )
    })

    expect(container.textContent).toContain("会话累计")
    expect(container.textContent).toContain("输入 1,234")
    expect(container.textContent).toContain("输出 56")
    expect(container.textContent).toContain("缓存读 7,890")
    expect(container.textContent).toContain("缓存写 12")
  })

  it("renders assistant token usage without a prefix by default", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageToolbar
          content="agent response"
          usage={{
            input_tokens: 1234,
            output_tokens: 56,
            cache_read_input_tokens: 7890,
            cache_creation_input_tokens: 12,
          }}
        />
      )
    })

    expect(container.textContent).not.toContain("会话累计")
    expect(container.textContent).toContain("输入 1,234")
    expect(container.textContent).toContain("输出 56")
    expect(container.textContent).toContain("缓存读 7,890")
    expect(container.textContent).toContain("缓存写 12")
  })

  it("does not render assistant token usage cost in the toolbar", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageToolbar
          content="agent response"
          usage={{
            input_tokens: 1234,
            output_tokens: 56,
          }}
          costUsd={0.0123}
        />
      )
    })

    expect(container.textContent).toContain("输入 1,234")
    expect(container.textContent).not.toContain("费用 $0.01")
    expect(container.textContent).not.toContain("费用")
  })

  it("logs clipboard copy failures without logging message content", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard blocked"))
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
        <AgentMessageToolbar
          content="secret agent response"
          messageId="message-1"
          role="assistant"
          timestamp="2026-05-14T00:00:00.000Z"
        />
      )
    })

    const button = container.querySelector("button")
    expect(button).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledWith("secret agent response")
    expect(rendererLogger.error).toHaveBeenCalledWith("Agent message copy failed.", {
      boundary: "renderer.agent.message-toolbar",
      messageId: "message-1",
      role: "assistant",
      contentLength: 21,
      hasTimestamp: true,
      errorName: "Error",
      errorLength: 17,
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret agent response")
  })

  it("tracks message copy clicks without logging message content", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
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
        <AgentMessageToolbar
          content="secret copied response"
          messageId="message-2"
          role="user"
          timestamp="2026-05-14T00:00:00.000Z"
        />
      )
    })

    const button = container.querySelector("button")
    expect(button).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      button?.click()
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledWith("secret copied response")
    expect(track).toHaveBeenCalledWith({
      component: "agent",
      name: "agent-message-copy",
      action: "click",
      eventKey: "agent.message.copy",
      metadata: {
        boundary: "renderer.agent.message-toolbar",
        messageId: "message-2",
        role: "user",
        contentLength: 22,
        hasTimestamp: true,
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("secret copied response")
  })
})
