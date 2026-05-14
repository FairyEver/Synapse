/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentMessageEvent } from "../agent-message-event"

const { rendererLogger } = vi.hoisted(() => ({
  rendererLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

const profile: SynapseAgentDisplayProfile = {
  agentLabel: "Claude",
  thinkingDefaultCollapsed: true,
  toolDefaultCollapsed: "auto",
  toolPreviewLines: 6,
  toolPreviewChars: 1200,
  statusLabels: {
    pending: "Pending",
    running: "Running",
    success: "Done",
    error: "Failed",
    denied: "Denied",
  },
}

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(),
    },
  })
})

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

describe("AgentMessageEvent", () => {
  it("logs assistant code block copy failures with message context", async () => {
    const clipboardError = new DOMException("Permission denied for clipboard", "NotAllowedError")
    vi.mocked(window.navigator.clipboard.writeText).mockRejectedValue(clipboardError)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            id: "message-123",
            kind: "message",
            role: "assistant",
            content: "```ts\nconst secret = 'do-not-log'\n```",
            timestamp: "2026-04-27T03:15:00.000Z",
          }}
          profile={profile}
          onOpenReference={vi.fn()}
        />,
      )
    })

    const copyButton = container.querySelector<HTMLButtonElement>(".code-copy-btn")
    expect(copyButton).not.toBeNull()

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(window.navigator.clipboard.writeText).toHaveBeenCalled()
    expect(rendererLogger.warn).toHaveBeenCalledWith("agent.code.copy.failed", {
      boundary: "renderer.agent.code-copy",
      messageId: "message-123",
      role: "assistant",
      contentLength: 37,
      codeLength: 28,
      errorName: "NotAllowedError",
      errorLength: "Permission denied for clipboard".length,
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("do-not-log")
  })
})
