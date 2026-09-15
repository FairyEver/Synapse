/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { SynapseAgentContextUsage } from "@/types/agent"
import { AgentContextUsageIndicator } from "../agent-context-usage-indicator"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
})

async function renderIndicator(contextUsage?: SynapseAgentContextUsage): Promise<HTMLDivElement> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <AgentContextUsageIndicator contextUsage={contextUsage} />
      </TooltipProvider>,
    )
  })
  return container
}

async function openTooltip(container: HTMLDivElement): Promise<void> {
  const trigger = container.querySelector<HTMLElement>("[data-agent-context-usage]")
  if (!trigger) throw new Error("Missing context usage trigger")
  await act(async () => {
    trigger.dispatchEvent(new Event("pointermove", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

describe("AgentContextUsageIndicator", () => {
  it("renders exact occupancy, percentage and a responsive progress bar", async () => {
    const container = await renderIndicator({
      usedTokens: 58_000,
      contextWindowTokens: 200_000,
      model: "claude",
    })

    expect(container.textContent).toContain("上下文 58K / 200K · 29%")
    expect(container.textContent).toContain("上下文 29%")
    const progress = container.querySelector('[role="progressbar"]')
    expect(progress?.getAttribute("aria-label")).toBe("上下文占用 29%")
    expect(container.querySelector('[data-slot="progress-indicator"]')?.getAttribute("style"))
      .toContain("translateX(-71%)")
    expect(container.querySelector("[data-agent-context-usage]")?.className).toContain("text-muted-foreground")
  })

  it("only renders used tokens while the context window is unknown", async () => {
    const container = await renderIndicator({ usedTokens: 12_400, model: "custom-model" })

    expect(container.textContent).toBe("上下文 12.4K")
    expect(container.querySelector('[role="progressbar"]')).toBeNull()
  })

  it("lets keyboard users focus the usage summary and open its details", async () => {
    const container = await renderIndicator({ usedTokens: 12_400, contextWindowTokens: 200_000 })
    const trigger = container.querySelector<HTMLElement>("[data-agent-context-usage]")

    await act(async () => {
      trigger?.focus()
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    expect(document.activeElement).toBe(trigger)
    expect(document.body.textContent).toContain("已用 12,400 token")
  })

  it("does not render without a snapshot", async () => {
    const container = await renderIndicator()
    expect(container.innerHTML).toBe("")
  })

  it("keeps raw percentage text while clamping progress to 100", async () => {
    const container = await renderIndicator({ usedTokens: 210_000, contextWindowTokens: 200_000 })

    expect(container.textContent).toContain("上下文 210K / 200K · 105%")
    const progress = container.querySelector('[role="progressbar"]')
    expect(progress?.getAttribute("aria-label")).toBe("上下文占用 105%")
    expect(container.querySelector('[data-slot="progress-indicator"]')?.getAttribute("style"))
      .toContain("translateX(-0%)")
  })

  it("never shows a negative remaining token count", async () => {
    const container = await renderIndicator({ usedTokens: 210_000, contextWindowTokens: 200_000 })
    await openTooltip(container)

    expect(document.body.textContent).toContain("剩余 0 token")
  })

  it("uses the SDK compact threshold when it is available", async () => {
    const container = await renderIndicator({
      usedTokens: 150_000,
      contextWindowTokens: 200_000,
      autoCompactThresholdTokens: 167_000,
    })

    expect(container.textContent).toContain("占用 150K · 整理 167K")
    await openTooltip(container)
    expect(document.body.textContent).toContain("自动整理触发 167,000 token")
    expect(document.body.textContent).toContain("模型窗口 200,000 token")
  })
})
