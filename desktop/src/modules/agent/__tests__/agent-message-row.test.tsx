import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { SynapseAgentMessageTimelineItem } from "@/types/agent"
import { AgentMessageEvent } from "../components/agent-message-event"

const baseEntry = {
  id: "message-1",
  kind: "message",
  content: "你好",
  timestamp: "2026-04-27T03:15:00.000Z",
} satisfies Omit<SynapseAgentMessageTimelineItem, "role">

describe("AgentMessageEvent", () => {
  it("right-aligns user messages with a subtle outgoing bubble", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("justify-end")
    expect(html).toContain("bg-muted")
    expect(html).toContain("text-foreground")
    expect(html).not.toContain("bg-primary")
    expect(html).not.toContain("text-primary-foreground")
  })

  it("left-aligns assistant messages without an incoming bubble surface", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant" }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("justify-start")
    expect(html).toContain("max-w-[76ch]")
    expect(html).not.toContain("bg-muted")
    expect(html).not.toContain("bg-primary")
    expect(html).not.toContain("rounded-2xl")
  })

  it("wraps long message content and preserves whitespace treatment", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "assistant",
          content: "very-long-token-without-natural-breaks/very-long-token-without-natural-breaks",
        }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("min-w-0")
    expect(html).toContain("break-words")
    expect(html).toContain("whitespace-pre-wrap")
  })

  it("keeps local references clickable", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{
          ...baseEntry,
          role: "assistant",
          content: "/Users/liyang/project/file.ts:12",
        }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("<button")
    expect(html).toContain("/Users/liyang/project/file.ts:12")
  })
})
