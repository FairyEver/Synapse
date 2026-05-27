import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CcConversationsPage } from "../cc/pages/conversations"

vi.mock("../cc/hooks", () => ({
  useCcConversations: () => ({
    data: {
      total: 1,
      partial: false,
      items: [{
        sessionId: "s1",
        title: "修登录问题",
        workspaceKey: "-repo",
        workspaceLabel: "/repo",
        startedAt: "2026-05-27T01:00:00.000Z",
        endedAt: "2026-05-27T01:00:01.000Z",
        modelSummary: "claude-opus-4.6",
        tokens: 15,
        estimatedCost: 0.01,
        toolCalls: 1,
        eventCount: 3,
        attachmentCount: 0,
        lastUsedAt: "2026-05-27T01:00:01.000Z",
        sourceFilePath: "/tmp/session-1.jsonl",
      }],
    },
    loading: false,
    error: null,
    reload: async () => undefined,
  }),
}))

describe("CcConversationsPage", () => {
  it("renders conversation filters and table headings", () => {
    const html = renderToStaticMarkup(<CcConversationsPage range="30d" refreshKey={0} />)

    expect(html).toContain("原文")
    expect(html).toContain("项目")
    expect(html).toContain("模型")
    expect(html).toContain("打开对话")
  })
})
