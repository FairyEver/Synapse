import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AgentSessionSidebar } from "../components/agent-session-sidebar"

describe("AgentSessionSidebar", () => {
  it("renders the follow Feishu control and unread marker", () => {
    const html = renderToStaticMarkup(
      <AgentSessionSidebar
        sessions={[{
          projectId: "project-1",
          id: "feishu-conv",
          sessionKey: "feishu:oc_group:ou_user",
          platform: "feishu",
          sourceLabel: "Dev Group / User One",
          active: false,
          historyCount: 2,
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T01:00:00.000Z",
        }]}
        selectedProjectId="project-local"
        selectedConversationId="local-conv"
        loading={false}
        followFeishu={true}
        unreadByConversationId={{ "project-1:feishu-conv": 2 }}
        onFollowFeishuChange={vi.fn()}
        onRefresh={vi.fn()}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(html).toContain("跟随飞书")
    expect(html).toContain("Dev Group / User One")
    expect(html).toContain("2<span class=\"sr-only\"> 条未读</span>")
  })
})
