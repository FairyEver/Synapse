import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AgentMessageItem } from "../index"
import type { SynapseAgentTimelineEntry } from "@/types/agent"

const baseEntry = {
  id: "message-1",
  content: "你好",
  timestamp: "2026-04-27T03:15:00.000Z",
} satisfies Omit<SynapseAgentTimelineEntry, "role">

describe("AgentMessageItem", () => {
  it("right-aligns user messages with a blue outgoing bubble", () => {
    const html = renderToStaticMarkup(
      <AgentMessageItem
        entry={{ ...baseEntry, role: "user" }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("items-end")
    expect(html).toContain("bg-gradient-to-b")
    expect(html).toContain("from-blue-500")
    expect(html).toContain("to-blue-600")
    expect(html).toContain("text-white")
  })

  it("left-aligns assistant messages with a neutral incoming bubble", () => {
    const html = renderToStaticMarkup(
      <AgentMessageItem
        entry={{ ...baseEntry, role: "assistant" }}
        onOpenReference={vi.fn()}
      />,
    )

    expect(html).toContain("items-start")
    expect(html).toContain("bg-muted/50")
    expect(html).not.toContain("from-blue-500")
  })
})
