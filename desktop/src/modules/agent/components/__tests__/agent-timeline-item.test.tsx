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

  it("renders AskUserQuestion as a user question instead of a permission approval", () => {
    const item = {
      id: "question-1",
      kind: "permissionRequest" as const,
      requestId: "request-1",
      toolName: "AskUserQuestion",
      timestamp: "2026-05-14T00:00:00.000Z",
      questions: [{
        question: "该怎么处理？",
        header: "处理方式",
        options: [
          { label: "跳过", description: "保持现状" },
          { label: "重试", description: "重新处理" },
        ],
        multiSelect: false,
      }],
    }
    const html = renderToStaticMarkup(
      <AgentTimelineItem
        item={item}
        profile={profile}
        pendingPermissions={[{
          requestId: "request-1",
          projectId: "project-1",
          sessionKey: "local:renderer",
          conversationId: "conversation-1",
          toolName: "AskUserQuestion",
          questions: item.questions,
          createdAt: "2026-05-14T00:00:00.000Z",
        }]}
        onOpenReference={vi.fn()}
        onRespondPermission={vi.fn()}
      />,
    )

    expect(html).toContain("该怎么处理？")
    expect(html).toContain("提交")
    expect(html).not.toContain("允许")
    expect(html).not.toContain("拒绝")
  })
})
