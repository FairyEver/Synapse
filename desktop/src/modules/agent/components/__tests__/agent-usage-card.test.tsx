/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentUsageCard } from "../agent-usage-card"

vi.mock("sonner", () => ({
  toast: vi.fn(),
}))

vi.mock("@/lib/ui-tracking", () => ({
  track: vi.fn(),
  extractLabel: vi.fn(() => "button"),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("AgentUsageCard", () => {
  it("renders compact usage rows and costs", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          timestamp="2026-06-02T06:32:00.000Z"
          totalUsage={{
            inputTokens: 10248,
            outputTokens: 3812,
            cacheReadInputTokens: 42180,
            cacheCreationInputTokens: 1216,
            reasoningOutputTokens: 680,
            totalTokens: 58136,
          }}
          turnUsage={{
            input_tokens: 2104,
            output_tokens: 846,
            cache_read_input_tokens: 9640,
            cache_creation_input_tokens: 0,
            reasoning_output_tokens: 180,
          }}
          turnCostCny={0.18}
          totalCostCny={1.42}
          estimatedCost
        />
      )
    })

    expect(container.textContent).toContain("用量统计")
    expect(container.textContent).toContain("本轮")
    expect(container.textContent).toContain("¥0.18")
    expect(container.textContent).toContain("累计")
    expect(container.textContent).toContain("¥1.42")
    expect(container.textContent).toContain("输入")
    expect(container.textContent).toContain("10,248")
    expect(container.textContent).toContain("+2,104")
    expect(container.textContent).toContain("21%")
    expect(container.textContent).not.toContain("最近 5 轮")
  })

  it("renders per-type total and delta CNY costs", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          totalUsage={{
            inputTokens: 25611,
            outputTokens: 616,
            cacheReadInputTokens: 163840,
            cacheCreationInputTokens: 0,
            totalTokens: 190067,
          }}
          turnUsage={{
            input_tokens: 3661,
            output_tokens: 677,
            cache_read_input_tokens: 205678,
            cache_creation_input_tokens: 0,
          }}
          turnCostBreakdownCny={{
            input: 0.03,
            output: 0.02,
            cacheRead: 0.01,
            cacheWrite: 0,
          }}
          totalCostBreakdownCny={{
            input: 0.21,
            output: 0.08,
            cacheRead: 0.35,
            cacheWrite: 0,
          }}
        />
      )
    })

    expect(container.textContent).toContain("25,611¥0.21")
    expect(container.textContent).toContain("+3,661（¥0.03）")
    expect(container.textContent).toContain("616¥0.08")
    expect(container.textContent).toContain("+677（¥0.02）")
    expect(container.textContent).toContain("0¥0.00")
    expect(container.textContent).toContain("+0（¥0.00）")
    const inputTotal = container.querySelector<HTMLElement>("[aria-label='累计输入 token：25,611']")
    const inputDelta = container.querySelector<HTMLElement>("[aria-label='本轮新增输入 token：3,661']")
    const cacheWriteTotal = container.querySelector<HTMLElement>("[aria-label='累计缓存写 token：0']")
    const cacheWriteDelta = container.querySelector<HTMLElement>("[aria-label='本轮新增缓存写 token：0']")
    expect(inputTotal).not.toBeNull()
    expect(inputTotal?.textContent).toBe("25,611")
    expect(inputDelta).not.toBeNull()
    expect(inputDelta?.textContent).toBe("+3,661")
    expect(cacheWriteTotal).not.toBeNull()
    expect(cacheWriteTotal?.textContent).toBe("0")
    expect(cacheWriteDelta).not.toBeNull()
    expect(cacheWriteDelta?.textContent).toBe("+0")
    expect(container.querySelector("[aria-label*='费用']")).toBeNull()
  })

  it("uses a quiet filled usage card surface without outer or header borders", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          totalUsage={{
            inputTokens: 25611,
            outputTokens: 616,
            cacheReadInputTokens: 163840,
            cacheCreationInputTokens: 0,
            totalTokens: 190067,
          }}
        />
      )
    })

    const card = container.querySelector<HTMLElement>("[aria-label='用量统计']")
    expect(card?.className).toContain("bg-muted/60")
    expect(card?.className).not.toContain("border border-border")
    expect(card?.firstElementChild?.className).not.toContain("border-b")
  })

  it("uses the selected semantic high contrast usage colors", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          totalUsage={{
            inputTokens: 25611,
            outputTokens: 616,
            cacheReadInputTokens: 163840,
            cacheCreationInputTokens: 0,
            totalTokens: 190067,
          }}
        />
      )
    })

    expect(container.querySelector(".bg-slate-900")).not.toBeNull()
    expect(container.querySelector(".bg-red-600")).not.toBeNull()
    expect(container.querySelector(".bg-emerald-600")).not.toBeNull()
    expect(container.querySelector(".bg-amber-500")).not.toBeNull()
    expect(container.querySelector(".bg-chart-1")).toBeNull()
    expect(container.querySelector(".bg-chart-3")).toBeNull()
    expect(container.querySelector(".bg-chart-5")).toBeNull()
    expect(container.querySelector(".bg-chart-4")).toBeNull()
  })

  it("keeps adjacent distribution segments visually separated", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          totalUsage={{
            inputTokens: 25611,
            outputTokens: 616,
            cacheReadInputTokens: 163840,
            cacheCreationInputTokens: 1,
            totalTokens: 190068,
          }}
        />
      )
    })

    const distribution = container.querySelector<HTMLElement>("[aria-label='Token 分类占比']")
    expect(distribution?.className).toContain("h-2")
    const segments = container.querySelectorAll<HTMLElement>("[data-usage-segment]")
    expect(segments).toHaveLength(4)
    expect(segments[0]?.className).not.toContain("border-l-2")
    expect(segments[1]?.className).toContain("border-l-2")
    expect(segments[1]?.className).toContain("border-card")
  })

  it("copies a human readable usage summary", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          totalUsage={{
            inputTokens: 10248,
            outputTokens: 3812,
            cacheReadInputTokens: 42180,
            cacheCreationInputTokens: 1216,
            reasoningOutputTokens: 680,
            totalTokens: 58136,
          }}
          turnUsage={{ input_tokens: 2104 }}
          turnCostCny={0.18}
          totalCostCny={1.42}
          estimatedCost
        />
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[aria-label='复制用量统计']")?.click()
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("用量统计"))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Token 累计"))
    expect(writeText.mock.calls[0]?.[0]).not.toContain("undefined")
    expect(writeText.mock.calls[0]?.[0]).not.toContain("NaN")
  })

  it("renders token rows without cost labels when no CNY cost is available", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          totalUsage={{
            inputTokens: 1000,
            outputTokens: 100,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            totalTokens: 1100,
          }}
          estimatedCost
        />
      )
    })

    expect(container.textContent).toContain("用量统计")
    expect(container.textContent).toContain("输入")
    expect(container.textContent).toContain("1,000")
    expect(container.textContent).not.toContain("本轮")
    expect(container.textContent).not.toContain("累计 ¥")
    expect(container.textContent).not.toContain("估算")
  })

  it("does not render a recent rounds chart without real round data", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          totalUsage={{
            inputTokens: 3192,
            outputTokens: 41,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 53289,
            totalTokens: 56522,
          }}
          turnUsage={{
            input_tokens: 3192,
            output_tokens: 41,
            cache_creation_input_tokens: 53289,
          }}
          turnCostCny={2.52}
          estimatedCost
        />
      )
    })

    expect(container.textContent).not.toContain("最近 5 轮")
  })

  it("does not force a fixed width wider than the message column", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          totalUsage={{
            inputTokens: 12997,
            outputTokens: 776,
            cacheReadInputTokens: 147943,
            cacheCreationInputTokens: 53631,
            totalTokens: 213347,
          }}
          turnCostCny={3.553562}
          estimatedCost
        />
      )
    })

    const card = container.querySelector<HTMLElement>("[aria-label='用量统计']")
    expect(card?.className).toContain("w-full")
    expect(card?.className).toContain("max-w-full")
    expect(card?.className).not.toContain("w-[76ch]")
    expect(card?.className).not.toContain("min-w-[760px]")
    expect(container.textContent).toContain("¥3.55")
    expect(container.textContent).not.toContain("3.553562")
  })

  it("switches usage stats to two columns from its own narrow container", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentUsageCard
          totalUsage={{
            inputTokens: 12997,
            outputTokens: 776,
            cacheReadInputTokens: 147943,
            cacheCreationInputTokens: 53631,
            totalTokens: 213347,
          }}
        />
      )
    })

    const card = container.querySelector<HTMLElement>("[aria-label='用量统计']")
    const statsGrid = card?.querySelector<HTMLElement>("[data-usage-stats-grid]")
    expect(card?.className).toContain("@container/usage-card")
    expect(statsGrid?.className).toContain("grid-cols-4")
    expect(statsGrid?.className).toContain("@max-[499px]/usage-card:grid-cols-2")
    expect(statsGrid?.className).toContain("@max-[499px]/usage-card:gap-y-3")
    const statsItems = card?.querySelectorAll<HTMLElement>("[data-usage-stat-item]")
    expect(statsItems?.[2]?.className).toContain("@max-[499px]/usage-card:odd:border-l-0")
    expect(statsItems?.[2]?.className).toContain("@max-[499px]/usage-card:odd:pl-0")
  })
})
