import type { ComponentProps } from "react"
import { createRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { SynapseAgentDisplayProfile, SynapseAgentTimelineItem } from "@/types/agent"
import { AgentTimeline } from "../agent-timeline"

const profile: SynapseAgentDisplayProfile = {
  agentLabel: "Codex",
  thinkingDefaultCollapsed: true,
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

function renderTimeline(overrides: Partial<ComponentProps<typeof AgentTimeline>> = {}) {
  return renderToStaticMarkup(
    <AgentTimeline
      items={[]}
      profile={profile}
      sending={false}
      pendingPermissions={[]}
      onOpenReference={vi.fn()}
      onRespondPermission={vi.fn()}
      viewportRef={createRef<HTMLDivElement>()}
      showJumpToBottom={false}
      onJumpToBottom={vi.fn()}
      {...overrides}
    />,
  )
}

describe("AgentTimeline", () => {
  it("uses compact vertical spacing between timeline items", () => {
    const html = renderTimeline()
    expect(html).toContain("gap-2")
    expect(html).not.toContain("gap-5")
  })

  it("enables text selection on the content area", () => {
    const html = renderTimeline()
    expect(html).toContain('data-allow-select="true"')
  })

  it("does not render the jump-to-bottom pill when showJumpToBottom is false", () => {
    const html = renderTimeline({ showJumpToBottom: false })
    expect(html).not.toContain("↓ 新消息")
    expect(html).not.toContain("跳到最新消息")
  })

  it("renders the jump-to-bottom pill when showJumpToBottom is true", () => {
    const html = renderTimeline({ showJumpToBottom: true })
    expect(html).toContain("↓ 新消息")
    expect(html).toContain('aria-label="跳到最新消息"')
  })

  it("renders an AgentPhaseRow for phase items", () => {
    const items: SynapseAgentTimelineItem[] = [
      {
        id: "phase:received",
        kind: "phase",
        timestamp: "2026-05-10T00:00:00.000Z",
        runId: "run-1",
        phase: "received",
        status: "in-progress",
        startedAt: "2026-05-10T00:00:00.000Z",
      },
    ]
    const html = renderTimeline({ items })
    // AgentPhaseRow uses tabular-nums for elapsed time and aria-live for in-progress.
    expect(html).toContain("tabular-nums")
    expect(html).toContain('aria-live="polite"')
    // Legacy AgentRunStatus copy must not surface.
    expect(html).not.toContain("正在处理")
  })

  it("does not render the legacy 正在处理 spinner row even when sending=true", () => {
    const html = renderTimeline({ sending: true })
    expect(html).not.toContain("正在处理")
  })
})
