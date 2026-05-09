import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

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
    expect(html).toContain("11:15")
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
    expect(html).toContain("<strong>bold text</strong>")
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
})
