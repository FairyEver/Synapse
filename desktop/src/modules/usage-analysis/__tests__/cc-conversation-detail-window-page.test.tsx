import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CcConversationDetailWindowPage } from "../cc/components/conversation-detail-window-page"

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    usageAnalysis: {
      cc: {
        getConversation: async () => ({
          session: {
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
            eventCount: 2,
            attachmentCount: 0,
            lastUsedAt: "2026-05-27T01:00:01.000Z",
            sourceFilePath: "/tmp/s1.jsonl",
          },
          events: [{
            id: "u1",
            type: "user",
            timestamp: "2026-05-27T01:00:00.000Z",
            timestampMs: 1779843600000,
            lineNumber: 1,
            byteOffset: 0,
            role: "user",
            contentBlocks: [{ type: "string", text: "请修登录问题" }],
            raw: { type: "user", message: { content: "请修登录问题" } },
          }],
          parseErrors: [],
          hasMore: false,
        }),
      },
    },
  }),
}))

describe("CcConversationDetailWindowPage", () => {
  it("renders the header, event stream, and inspector", () => {
    const html = renderToStaticMarkup(
      <CcConversationDetailWindowPage request={{ sessionId: "s1", title: "修登录问题" }} />,
    )

    expect(html).toContain("修登录问题")
    expect(html).toContain("事件")
    expect(html).toContain("字段")
  })
})
