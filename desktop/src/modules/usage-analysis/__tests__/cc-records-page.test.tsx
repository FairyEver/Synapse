/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
    pricedTokens: 15,
    unpricedTokens: 0,
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
let roots: Root[] = []

vi.mock("../cc/hooks", () => ({
  useCcRecordDetails: () => detailState,
  useCcRecords: () => recordsState,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("CcRecordsPage", () => {
  beforeEach(() => {
    recordsState = createRecordState()
    detailState = createDetailState()
    window.IntersectionObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return []
      }
      unobserve() {}
    } as unknown as typeof IntersectionObserver
  })

  afterEach(() => {
    for (const root of roots) {
      act(() => {
        root.unmount()
      })
    }
    roots = []
    document.body.innerHTML = ""
  })

  it("renders record filters, progress status, and session summary actions", () => {
    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("原文")
    expect(html).toContain("搜标题 / 项目 / 模型 / Session ID；打开原文后搜对话内容")
    expect(html).toContain("请求")
    expect(html).toContain("打开对话")
    expect(html).toContain("已显示 1 / 128")
    expect(html).not.toContain("加载更多")
  })

  it("shows a plain centered loading state while initial records load", () => {
    recordsState = { ...recordsState, data: null, loading: true }

    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("正在加载")
    expect(html).not.toContain("data-slot=\"skeleton\"")
    expect(html).not.toContain("时间")
  })

  it("keeps existing records visible while refreshing without a separate loading row", () => {
    recordsState = { ...recordsState, loading: true }

    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("打开对话")
    expect(html).not.toContain("正在读取记录")
  })

  it("shows when raw text search results are partial", () => {
    recordsState = {
      ...recordsState,
      data: {
        ...recordData,
        partial: true,
      },
    }

    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("结果可能不完整")
  })

  it("shows the next loading range while loading another record batch", () => {
    recordsState = { ...recordsState, loading: true }

    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("正在加载 2-51 / 128")
    expect(html).not.toContain("加载更多")
    expect(html).not.toContain("加载中")
  })

  it("shows an all-loaded footer when every matching record is visible", () => {
    recordsState = {
      ...recordsState,
      data: {
        ...recordData,
        total: 1,
      },
    }

    const html = renderToStaticMarkup(<CcRecordsPage range="30d" refreshKey={0} />)

    expect(html).toContain("已显示全部 1 条")
    expect(html).not.toContain("加载更多")
  })

  it("keeps raw text search scanning when the first candidate page has no matches", async () => {
    recordsState = {
      ...recordsState,
      data: {
        ...recordData,
        items: [],
        nextCursor: "50",
        partial: true,
      },
    }

    await renderRecordsPage()
    await clickRawTextSwitch()

    expect(document.body.textContent).toContain("结果可能不完整")
    expect(document.body.textContent).toContain("已显示 0 / 128")
    expect(document.body.textContent).not.toContain("暂无数据")
  })
})

async function renderRecordsPage() {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<CcRecordsPage range="30d" refreshKey={0} />)
  })
}

async function clickRawTextSwitch() {
  const control = document.querySelector<HTMLElement>("#cc-conversation-raw-text")
  expect(control).not.toBeNull()
  await act(async () => {
    control?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}
