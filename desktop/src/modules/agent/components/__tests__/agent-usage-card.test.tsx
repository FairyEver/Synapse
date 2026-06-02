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
    expect(container.textContent).toContain("最近 5 轮")
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
})
