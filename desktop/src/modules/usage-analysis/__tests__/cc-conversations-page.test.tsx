import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CcConversationsPage } from "../cc/pages/conversations"
import type { CcConversationListResult } from "@/types/usage-analysis-conversations"
import type { ReportState } from "../shared/types"

const conversationData: CcConversationListResult = {
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
}

function createConversationState(): ReportState<CcConversationListResult> {
  return {
    data: conversationData,
    loading: false,
    error: null,
    reload: async () => undefined,
  }
}

let conversationsState = createConversationState()

vi.mock("../cc/hooks", () => ({
  useCcConversations: () => conversationsState,
}))

describe("CcConversationsPage", () => {
  beforeEach(() => {
    conversationsState = createConversationState()
  })

  it("renders conversation filters and table headings", () => {
    const html = renderToStaticMarkup(<CcConversationsPage range="30d" refreshKey={0} />)

    expect(html).toContain("原文")
    expect(html).toContain("项目")
    expect(html).toContain("模型")
    expect(html).toContain("打开对话")
  })

  it("shows a visible loading status while conversations are loading", () => {
    conversationsState = {
      ...conversationsState,
      data: null,
      loading: true,
    }

    const html = renderToStaticMarkup(<CcConversationsPage range="30d" refreshKey={0} />)

    expect(html).toContain("正在读取对话")
  })

  it("keeps the loading status visible while refreshing existing conversations", () => {
    conversationsState = {
      ...conversationsState,
      loading: true,
    }

    const html = renderToStaticMarkup(<CcConversationsPage range="30d" refreshKey={0} />)

    expect(html).toContain("正在读取对话")
    expect(html).toContain("打开对话")
  })
})
