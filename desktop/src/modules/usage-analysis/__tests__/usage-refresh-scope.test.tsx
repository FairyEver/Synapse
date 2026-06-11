/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CcUsageAnalysisModule, CodexUsageAnalysisModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const refreshResult = {
  scannedFiles: 0,
  parsedFiles: 0,
  skippedFiles: 0,
  failedFiles: 0,
  usageEvents: 0,
  toolEvents: 0,
  elapsedMs: 1,
}

const overviewReport = {
  generatedAt: "2026-06-12T00:00:00.000Z",
  totals: {
    tokens: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
    estimatedCost: 0,
    requests: 0,
    conversations: 0,
    toolCalls: 0,
    activeDays: 0,
  },
  tokenBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  costBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  topModels: [],
  topProjects: [],
  topTools: [],
  trend: [],
}

const mocks = vi.hoisted(() => ({
  ccRefresh: vi.fn(async () => refreshResult),
  codexRefresh: vi.fn(async () => refreshResult),
  getOverview: vi.fn(async () => overviewReport),
  getTime: vi.fn(async () => []),
  getModels: vi.fn(async () => []),
  getProjects: vi.fn(async () => []),
  getTools: vi.fn(async () => []),
  getDetails: vi.fn(async () => []),
  listRecords: vi.fn(async () => ({ rows: [], total: 0, nextCursor: undefined })),
  warning: vi.fn(),
  error: vi.fn(),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    error: mocks.error,
    warning: mocks.warning,
  }),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    usageAnalysis: {
      cc: {
        refresh: mocks.ccRefresh,
        getOverview: mocks.getOverview,
        getTime: mocks.getTime,
        getModels: mocks.getModels,
        getProjects: mocks.getProjects,
        getTools: mocks.getTools,
        getDetails: mocks.getDetails,
        listRecords: mocks.listRecords,
      },
      codex: {
        refresh: mocks.codexRefresh,
        getOverview: mocks.getOverview,
        getTime: mocks.getTime,
        getModels: mocks.getModels,
        getProjects: mocks.getProjects,
        getTools: mocks.getTools,
        getDetails: mocks.getDetails,
      },
    },
  }),
}))

let roots: Root[] = []

beforeEach(() => {
  vi.clearAllMocks()
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

describe("usage analysis refresh scope", () => {
  it("runs CC auto refresh and today button refresh with today scope", async () => {
    await renderUsagePage(<CcUsageAnalysisModule />)
    expect(mocks.ccRefresh).toHaveBeenCalledWith({ preset: "today" })

    mocks.ccRefresh.mockClear()
    await clickButton("刷新今日")

    expect(mocks.ccRefresh).toHaveBeenCalledWith({ preset: "today" })
  })

  it("runs CC non-today button refresh without a scope", async () => {
    await renderUsagePage(<CcUsageAnalysisModule />)
    mocks.ccRefresh.mockClear()

    await clickButton("概览")
    await clickButton("刷新")

    expect(mocks.ccRefresh).toHaveBeenCalledWith()
  })

  it("runs Codex auto refresh and today button refresh with today scope", async () => {
    await renderUsagePage(<CodexUsageAnalysisModule />)
    expect(mocks.codexRefresh).toHaveBeenCalledWith({ preset: "today" })

    mocks.codexRefresh.mockClear()
    await clickButton("刷新今日")

    expect(mocks.codexRefresh).toHaveBeenCalledWith({ preset: "today" })
  })

  it("runs Codex non-today button refresh without a scope", async () => {
    await renderUsagePage(<CodexUsageAnalysisModule />)
    mocks.codexRefresh.mockClear()

    await clickButton("概览")
    await clickButton("刷新")

    expect(mocks.codexRefresh).toHaveBeenCalledWith()
  })
})

async function renderUsagePage(node: React.ReactElement) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)

  await act(async () => {
    root.render(node)
    await Promise.resolve()
  })
}

async function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")]
    .find((item) => item.textContent?.trim() === label)
  if (!button) throw new Error(`Button not found: ${label}`)

  await act(async () => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    button.click()
    await Promise.resolve()
  })
}
