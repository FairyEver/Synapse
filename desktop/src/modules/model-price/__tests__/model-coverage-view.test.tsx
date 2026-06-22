/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ModelCoverageView } from "../components/model-coverage-view"
import type { ModelPriceCoverageRow, ModelPriceState } from "../types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/lib/ui-tracking", () => ({
  track: vi.fn(),
  extractLabel: () => "button",
  mergeRefs: (...refs: unknown[]) => (value: unknown) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value)
      if (typeof ref === "object" && ref !== null && "current" in ref) {
        ;(ref as { current: unknown }).current = value
      }
    }
  },
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("ModelCoverageView", () => {
  it("groups model coverage into model, pricing, and multi-line usage columns", async () => {
    await renderCoverage(
      [
        coverageRow({
          model: "claude-sonnet-4.6-thinking-long-name",
          sources: ["cc", "codex"],
          priceKnown: true,
          matchedRulePattern: "claude-*",
        }),
      ],
    )

    const headers = [...document.querySelectorAll("th")].map((header) => header.textContent)
    expect(headers).toEqual(["模型", "当前规则", "用量"])
    expect(headers).not.toContain("来源")
    expect(headers).not.toContain("规则")
    expect(document.body.textContent).toContain("claude-sonnet-4.6-thinking-long-name")
    expect(document.body.textContent).toContain("CC")
    expect(document.body.textContent).toContain("Codex")
    expect(document.body.textContent).toContain("规则已匹配")
    expect(document.body.textContent).toContain("claude-*")
    expect(document.body.textContent).toContain("Tokens")
    expect(document.body.textContent).toContain("请求")
    expect(document.body.textContent).toContain("未计价")
    expect(document.body.textContent).toContain("已计费用")
    expect(document.querySelector("table")?.className).not.toContain("min-w-")
    expect(document.querySelector("[data-slot='table-container']")?.className).toContain("overflow-x-hidden")
  })

  it("renders empty state inside the coverage table surface", async () => {
    await renderCoverage([])

    expect(document.body.textContent).toContain("暂无覆盖数据")
    expect(document.body.textContent).toContain("刷新后查看 CC 或 Codex 使用记录。")
    expect(document.querySelector("[data-slot='empty']")).toBeTruthy()
  })
})

async function renderCoverage(data: ModelPriceCoverageRow[]): Promise<void> {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)

  await act(async () => {
    root.render(<ModelCoverageView state={state(data)} />)
  })
}

function state(data: ModelPriceCoverageRow[]): ModelPriceState<ModelPriceCoverageRow[]> {
  return {
    data,
    loading: false,
    error: null,
    reload: vi.fn(),
  }
}

function coverageRow(overrides: Partial<ModelPriceCoverageRow> = {}): ModelPriceCoverageRow {
  return {
    model: "gpt-5.5",
    sources: ["codex"],
    tokens: 16895657105,
    requests: 142785,
    pricedTokens: 16895657105,
    unpricedTokens: 0,
    estimatedCost: 39471.834403,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    priceKnown: false,
    ...overrides,
  }
}
