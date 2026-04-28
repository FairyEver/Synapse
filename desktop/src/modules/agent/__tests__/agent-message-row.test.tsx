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
  it("right-aligns user messages with a primary outgoing bubble", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "user" }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("justify-end")
    expect(html).toContain("bg-primary")
    expect(html).toContain("text-primary-foreground")
  })

  it("left-aligns assistant messages with a neutral incoming bubble", () => {
    const html = renderToStaticMarkup(
      <AgentMessageEvent
        item={{ ...baseEntry, role: "assistant" }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("justify-start")
    expect(html).toContain("bg-muted/50")
    expect(html).not.toContain("bg-primary")
  })

  it("wraps long message content inside the bubble", () => {
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
})
