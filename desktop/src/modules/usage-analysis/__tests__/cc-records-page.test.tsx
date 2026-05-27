import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { CcRecordsPage } from "../cc/pages/records"
import type { CcRecordDetailsResult, CcRecordListResult } from "@/types/usage-analysis-conversations"
import type { ReportState } from "../shared/types"

const recordData: CcRecordListResult = {
  total: 128,
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
    requestCount: 2,
    lastUsedAt: "2026-05-27T01:00:01.000Z",
    sourceFilePath: "/tmp/session-1.jsonl",
  }],
}

const detailData: CcRecordDetailsResult = {
  sessionId: "",
  rows: [],
  total: 0,
}

function createRecordState(): ReportState<CcRecordListResult> {
  return {
    data: recordData,
    loading: false,
    error: null,
    reload: async () => undefined,
  }
}

function createDetailState(): ReportState<CcRecordDetailsResult> {
  return {
    data: detailData,
    loading: false,
    error: null,
    reload: async () => undefined,
  }
}

let recordsState = createRecordState()
let detailState = createDetailState()

vi.mock("../cc/hooks", () => ({
  useCcRecordDetails: () => detailState,
  useCcRecords: () => recordsState,
}))

describe("CcRecordsPage", () => {
  beforeEach(() => {
    recordsState = createRecordState()
    detailState = createDetailState()
  })

  it("renders record filters, batch footer, and session summary actions", () => {
    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("原文")
    expect(html).toContain("请求")
    expect(html).toContain("打开对话")
    expect(html).toContain("已显示 1 / 128 条记录")
    expect(html).toContain("加载更多")
  })

  it("shows table-shaped placeholders while records load", () => {
    recordsState = { ...recordsState, data: null, loading: true }

    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("data-slot=\"skeleton\"")
    expect(html).toContain("时间")
    expect(html).not.toContain("正在读取记录")
  })

  it("keeps existing records visible while refreshing without a separate loading row", () => {
    recordsState = { ...recordsState, loading: true }

    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("打开对话")
    expect(html).not.toContain("正在读取记录")
  })

  it("disables the load more button while loading the next record batch", () => {
    recordsState = { ...recordsState, loading: true }

    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("加载中")
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*加载中/)
  })
})
