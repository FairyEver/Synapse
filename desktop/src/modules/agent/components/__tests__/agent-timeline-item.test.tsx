import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile } from "@/types/agent"
import { AgentTimelineItem } from "../agent-timeline-item"

const profile: SynapseAgentDisplayProfile = {
  agentLabel: "Claude Code",
  thinkingDefaultCollapsed: false,
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

describe("AgentTimelineItem", () => {
  it("wraps multi-line Agent error diagnostics without collapsing SDK details", () => {
    const html = renderToStaticMarkup(
      <AgentTimelineItem
        item={{
          id: "error-1",
          kind: "error",
          message: "SDK failed\n[path redacted]/very-long-segment-without-spaces",
          timestamp: "2026-05-14T00:00:00.000Z",
        }}
        profile={profile}
        pendingPermissions={[]}
        onOpenReference={vi.fn()}
        onRespondPermission={vi.fn()}
      />,
    )

    expect(html).toContain("whitespace-pre-wrap")
    expect(html).toContain("break-words")
    expect(html).toContain("SDK failed")
    expect(html).toContain("[path redacted]/very-long-segment-without-spaces")
  })
})
