/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CcConversationDetailWindowPage } from "../cc/components/conversation-detail-window-page"
import type { CcConversationDetail } from "@/types/usage-analysis-conversations"

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn<() => Promise<CcConversationDetail>>(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    usageAnalysis: {
      cc: {
        getConversation: mocks.getConversation,
      },
    },
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  mocks.getConversation.mockResolvedValue(createDetail())
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("CcConversationDetailWindowPage", () => {
  it("renders the header, event stream, and inspector", async () => {
    await renderWindow()

    expect(document.body.textContent).toContain("修登录问题")
    expect(document.body.textContent).toContain("事件")
    expect(document.body.textContent).toContain("字段")
  })

  it("shows parse errors when transcript lines cannot be read", async () => {
    mocks.getConversation.mockResolvedValue(createDetail({
      parseErrors: [{
        id: "parse-2",
        lineNumber: 2,
        byteOffset: 128,
        message: "Unexpected token",
        rawLine: "{broken",
      }],
    }))

    await renderWindow()

    expect(document.body.textContent).toContain("1 行解析失败")
    expect(document.body.textContent).toContain("第 2 行")
    expect(document.body.textContent).toContain("Unexpected token")
  })
})

async function renderWindow(): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<CcConversationDetailWindowPage request={{ sessionId: "s1", title: "修登录问题" }} />)
    await Promise.resolve()
  })
}

function createDetail(patch: Partial<CcConversationDetail> = {}): CcConversationDetail {
  return {
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
    ...patch,
  }
}
