import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentThinkingEvent } from "../agent-thinking-event"

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

    expect(html).toContain("Thinking")
    expect(html).toContain("analysis")
    expect(html).toContain("w-full")
    expect(html).not.toContain("border-y border-border")
    expect(html.indexOf("Thinking")).toBeLessThan(html.indexOf("lucide-chevron-down"))
  })
})
