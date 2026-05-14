/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentThinkingEvent } from "../agent-thinking-event"

const { rendererLogger } = vi.hoisted(() => ({
  rendererLogger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

const profile: SynapseAgentDisplayProfile = {
  agentLabel: "Codex",
  thinkingDefaultCollapsed: false,
  toolDefaultCollapsed: "collapsed",
  toolPreviewLines: 6,
  toolPreviewChars: 20,
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

describe("AgentThinkingEvent", () => {
  it("renders with full-row hover and the chevron after the label", () => {
    const html = renderToStaticMarkup(<AgentThinkingEvent
      item={{
        id: "thinking-1",
        kind: "thinking",
        timestamp: "2026-04-28T00:00:00.000Z",
        content: "analysis",
      }}
      profile={profile}
    />)

    expect(html).toContain("思考过程")
    expect(html).toContain("analysis")
    expect(html).not.toContain("border-y border-border")
    expect(html.indexOf("思考过程")).toBeLessThan(html.indexOf("lucide-chevron-down"))
    expect(html).toContain("group-data-[state=closed]/agent-event-trigger:-rotate-90")
    expect(html).toContain("w-full")
    expect(html).toContain("hover:bg-transparent")
    expect(html).toContain("class=\"group relative pb-2 pt-1\"")
    expect(html).toContain("aria-label=\"复制思考过程\"")
  })

  it("renders thinking content when the profile defaults to expanded", () => {
    const html = renderToStaticMarkup(<AgentThinkingEvent
      item={{
        id: "thinking-expanded",
        kind: "thinking",
        timestamp: "2026-05-13T00:00:00.000Z",
        content: "visible thinking",
      }}
      profile={{ ...profile, thinkingDefaultCollapsed: false }}
    />)

    expect(html).toContain("visible thinking")
  })

  it("logs thinking copy failures without recording thinking content", async () => {
    vi.mocked(window.navigator.clipboard.writeText).mockRejectedValue(
      new DOMException("Permission denied for secret thinking", "NotAllowedError"),
    )
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentThinkingEvent
        item={{
          id: "thinking-secret",
          kind: "thinking",
          timestamp: "2026-05-13T00:00:00.000Z",
          content: "private chain of thought",
        }}
        profile={{ ...profile, thinkingDefaultCollapsed: false }}
      />)
    })

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="复制思考过程"]')
    expect(button).not.toBeNull()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(rendererLogger.warn).toHaveBeenCalledWith("Agent thinking copy failed.", {
      boundary: "renderer.agent.thinking-copy",
      itemId: "thinking-secret",
      contentLength: 24,
      errorName: "NotAllowedError",
      errorLength: 37,
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("private chain of thought")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("Permission denied for secret thinking")
  })
})
