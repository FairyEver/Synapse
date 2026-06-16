/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ModelPriceModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const hooks = vi.hoisted(() => ({
  useModelPriceCoverage: vi.fn(),
  useModelPriceRules: vi.fn(),
  useModelPricePresets: vi.fn(),
}))

vi.mock("../hooks", () => hooks)

vi.mock("../components/model-coverage-view", () => ({
  ModelCoverageView: () => <div data-view="coverage">coverage-view</div>,
}))

vi.mock("../components/price-rules-view", () => ({
  PriceRulesView: ({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) => (
    <div data-view="rules">
      rules-view
      <button type="button" onClick={() => onBusyChange?.(true)}>set-rules-busy</button>
    </div>
  ),
}))

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

beforeEach(() => {
  const emptyState = {
    data: [],
    loading: false,
    error: null,
    reload: vi.fn(),
  }
  hooks.useModelPriceCoverage.mockReturnValue(emptyState)
  hooks.useModelPriceRules.mockReturnValue(emptyState)
  hooks.useModelPricePresets.mockReturnValue(emptyState)
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

describe("ModelPriceModule", () => {
  it("shows rules view by default and keeps rules tab first", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(<ModelPriceModule />)
    })

    const tabs = [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)
    expect(tabs).toEqual(["价格规则", "模型覆盖"])
    expect(document.querySelector('[data-view="rules"]')).toBeTruthy()
    expect(document.querySelector('[data-view="coverage"]')).toBeNull()
    expect(document.querySelector("h2")?.textContent).not.toBe("价格")
  })

  it("disables refresh while rules view is busy", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(<ModelPriceModule />)
    })

    expect(refreshButton().disabled).toBe(false)

    await act(async () => {
      clickButton("set-rules-busy")
    })

    expect(refreshButton().disabled).toBe(true)
    expect(tabButton("模型覆盖").disabled).toBe(true)

    await act(async () => {
      tabButton("模型覆盖").dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(document.querySelector('[data-view="rules"]')).toBeTruthy()
    expect(document.querySelector('[data-view="coverage"]')).toBeNull()
  })

  it("keeps module content constrained to the window width", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(<ModelPriceModule />)
    })

    expect(document.querySelector("[data-model-price-scroll-area]")?.className).toContain("min-w-0")
    expect(document.querySelector("[data-model-price-scroll-area]")?.className).toContain("max-w-full")
    expect(document.querySelector("[data-slot='scroll-area-viewport']")?.className).toContain("min-w-0")
    expect(document.querySelector("[data-model-price-content]")?.className).toContain("overflow-x-hidden")
  })
})

function clickButton(label: string): void {
  const button = [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!button) throw new Error(`Button not found: ${label}`)
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

function refreshButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes("刷新"))
  if (!button) throw new Error("Refresh button not found")
  return button
}

function tabButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((candidate) => candidate.textContent?.includes(label))
  if (!button) throw new Error(`Tab not found: ${label}`)
  return button
}
