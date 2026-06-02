/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile, SynapseAgentMessageTimelineItem } from "@/types/agent"
import { AgentMessageEvent } from "../components/agent-message-event"

const baseEntry = {
  id: "message-1",
  kind: "message",
  content: "你好",
  timestamp: "2026-04-27T03:15:00.000Z",
} satisfies Omit<SynapseAgentMessageTimelineItem, "role">

const mockProfile: SynapseAgentDisplayProfile = {
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
  it("right-aligns user messages with a subtle outgoing bubble", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("items-end")
    expect(html).toContain("bg-muted")
    expect(html).toContain("text-foreground")
    expect(html).not.toContain("bg-primary")
  })

  it("user messages do not render a header with avatar", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).not.toContain("lucide-user")
    expect(html).not.toContain("lucide-bot")
  })

  it("user messages have a toolbar with copy button and time", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("复制")
    const d = new Date(baseEntry.timestamp)
    const expected = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`
    expect(html).toContain(expected)
  })

  it("left-aligns assistant messages with markdown rendering", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant", content: "**bold text**" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("items-start")
    expect(html).toContain('data-streamdown="strong"')
    expect(html).toContain("bold text")
  })

  it("assistant messages show agent icon when provided", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant" }}
        profile={mockProfile}
        agentIcon="/icons/claude.png"
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain('src="/icons/claude.png"')
    expect(html).not.toContain("lucide-bot")
  })

  it("assistant messages have a toolbar with copy button", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant" }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("复制")
  })

  it("assistant messages render token usage metadata", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "assistant",
          metadata: {
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 300,
              cache_creation_input_tokens: 40,
            },
          },
        }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain('aria-label="用量统计"')
    expect(html).toContain("输入")
    expect(html).toContain("100")
    expect(html).toContain("输出")
    expect(html).toContain("20")
    expect(html).toContain("缓存读")
    expect(html).toContain("300")
    expect(html).toContain("缓存写")
    expect(html).toContain("40")
  })

  it("wraps local references as markdown links for assistant", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "assistant",
          content: "/Users/liyang/project/file.ts:12",
        }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("<a")
    expect(html).toContain("/Users/liyang/project/file.ts:12")
  })

  it("does not link slash-separated app labels in assistant messages", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "assistant",
          content: "余额退款申请单(蛋鸡APP/PC)；养殖户模板(PC/APP)",
        }}
        profile={mockProfile}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).not.toContain("<a href")
    expect(html).toContain("蛋鸡APP/PC")
    expect(html).toContain("PC/APP")
  })

  it("opens wrapped relative file references through the reference bridge", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const onOpenReference = vi.fn()

    await act(async () => {
      root.render(
        <AgentMessageEvent
          item={{
            ...baseEntry,
            role: "assistant",
            content: "desktop/src/modules/agent/index.tsx:12",
          }}
          profile={mockProfile}
          onOpenReference={onOpenReference}
        />,
      )
    })

    const link = container.querySelector("a")
    expect(link?.getAttribute("data-reference")).toBe("desktop/src/modules/agent/index.tsx:12")

    act(() => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(onOpenReference).toHaveBeenCalledWith("desktop/src/modules/agent/index.tsx:12")
  })
})
