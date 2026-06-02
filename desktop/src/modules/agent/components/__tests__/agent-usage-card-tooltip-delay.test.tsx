/**
 * @vitest-environment jsdom
 */
import { type ReactNode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({
  toast: vi.fn(),
}))

vi.mock("@/lib/ui-tracking", () => ({
  track: vi.fn(),
  extractLabel: vi.fn(() => "button"),
}))

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ delayDuration, children }: { delayDuration?: number; children: ReactNode }) => (
    <div data-testid="tooltip-provider" data-delay-duration={delayDuration}>
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

import { AgentUsageCard } from "../agent-usage-card"

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

describe("AgentUsageCard tooltip delay", () => {
  it("delays usage tooltips for one second", async () => {
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
        />
      )
    })

    expect(container.querySelector("[data-testid='tooltip-provider']")?.getAttribute("data-delay-duration")).toBe("1000")
  })
})
