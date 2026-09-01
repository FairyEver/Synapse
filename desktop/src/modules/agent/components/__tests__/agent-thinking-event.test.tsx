/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentThinkingEvent } from "../agent-thinking-event"

const { rendererLogger, track } = vi.hoisted(() => ({
  rendererLogger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
  track: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: () => "复制思考过程",
  track,
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
const sensitiveThinkingContent =
  "Authorization: Bearer sk-live-bearer ANTHROPIC_AUTH_TOKEN=sk-live-secret " +
  '{"token":"data-server-token"} Cookie: session=secret-cookie /Users/liyang/project/file.ts'

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

  it("renders long thinking content without an internal height cap", () => {
    const html = renderToStaticMarkup(<AgentThinkingEvent
      item={{
        id: "thinking-scroll",
        kind: "thinking",
        timestamp: "2026-05-13T00:00:00.000Z",
        content: `${"long thinking line\n".repeat(80)}`,
      }}
      profile={{ ...profile, thinkingDefaultCollapsed: false }}
    />)
    const container = document.createElement("div")
    container.innerHTML = html

    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')

    expect(viewport).toBeNull()
    expect(html).not.toContain("max-h-60")
  })

  it("redacts sensitive thinking content before rendering", () => {
    const html = renderToStaticMarkup(<AgentThinkingEvent
      item={{
        id: "thinking-redacted",
        kind: "thinking",
        timestamp: "2026-05-13T00:00:00.000Z",
        content: sensitiveThinkingContent,
      }}
      profile={{ ...profile, thinkingDefaultCollapsed: false }}
    />)

    expect(html).toContain("[redacted]")
    expect(html).toContain("/Users/liyang/project/file.ts")
    expect(html).not.toContain("sk-live-bearer")
    expect(html).not.toContain("sk-live-secret")
    expect(html).not.toContain("data-server-token")
    expect(html).not.toContain("secret-cookie")
  })

  it("copies redacted thinking content", async () => {
    vi.mocked(window.navigator.clipboard.writeText).mockResolvedValue(undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentThinkingEvent
        item={{
          id: "thinking-copy-redacted",
          kind: "thinking",
          timestamp: "2026-05-13T00:00:00.000Z",
          content: sensitiveThinkingContent,
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

    const copied = vi.mocked(window.navigator.clipboard.writeText).mock.calls[0]?.[0] ?? ""
    expect(copied).toContain("[redacted]")
    expect(copied).toContain("/Users/liyang/project/file.ts")
    expect(copied).not.toContain("sk-live-bearer")
    expect(copied).not.toContain("sk-live-secret")
    expect(copied).not.toContain("data-server-token")
    expect(copied).not.toContain("secret-cookie")
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

  it("tracks thinking copy clicks without recording thinking content", async () => {
    vi.mocked(window.navigator.clipboard.writeText).mockResolvedValue(undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentThinkingEvent
        item={{
          id: "thinking-copy",
          kind: "thinking",
          timestamp: "2026-05-13T00:00:00.000Z",
          content: "sensitive thinking text",
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

    expect(track).toHaveBeenCalledWith({
      component: "agent",
      name: "agent-thinking-copy",
      action: "click",
      eventKey: "agent.thinking.copy",
      metadata: {
        boundary: "renderer.agent.thinking-copy",
        itemId: "thinking-copy",
        contentLength: 23,
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("sensitive thinking text")
  })
})
