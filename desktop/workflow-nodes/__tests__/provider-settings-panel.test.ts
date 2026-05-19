/**
 * @vitest-environment jsdom
 */
import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PromptNodePanel } from "../prompt/panel"
import { SwitchNodePanel } from "../switch/panel"
import { ProviderLookupContext } from "../provider-lookup-context"
import type { ProviderLookup } from "../provider-lookup-context"

vi.mock("@/lib/ui-tracking", () => ({
  track: vi.fn(),
}))

vi.mock("../prompt-editor", () => ({
  PromptEditor: ({ value }: { value: string }) => React.createElement("textarea", { readOnly: true, value }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const providerLookup: ProviderLookup = {
  getProviderName: (providerId) => providerId === "provider-1" ? "Bailian 公司" : undefined,
  getModelName: (providerId, modelTier) => providerId === "provider-1" && modelTier === "sonnet" ? "deepseek-v4-pro" : undefined,
  isProviderAvailable: () => true,
}

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

function renderPanel(element: React.ReactNode) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(React.createElement(ProviderLookupContext.Provider, { value: providerLookup }, element))
  })
  return container
}

describe("workflow node provider settings", () => {
  it("keeps prompt nodes inheriting the workflow provider until custom provider is enabled", () => {
    const onChange = vi.fn()
    const container = renderPanel(
      React.createElement(PromptNodePanel, {
        config: { providerId: undefined, modelTier: undefined, variables: [], prompt: "run" },
        onChange,
        upstreamNodes: [],
        workflowParams: [],
        projects: [],
        defaultProviderId: "provider-1",
        defaultModelTier: "sonnet",
      }),
    )

    expect(container.textContent).toContain("单独设置供应商")
    expect(container.textContent).toContain("使用工作流默认：Bailian 公司 · deepseek-v4-pro")
    expect(container.textContent).not.toContain("选择供应商 + 模型")

    const checkbox = container.querySelector<HTMLButtonElement>("[role='checkbox']")
    expect(checkbox?.getAttribute("aria-checked")).toBe("false")

    act(() => {
      checkbox?.click()
    })

    expect(container.textContent).toContain("选择供应商 + 模型")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("clears switch node provider overrides when custom provider is disabled", () => {
    const onChange = vi.fn()
    const container = renderPanel(
      React.createElement(SwitchNodePanel, {
        config: {
          providerId: "provider-1",
          modelTier: "sonnet",
          variables: [],
          prompt: "route",
          branches: [{ id: "branch1", label: "分支 1" }],
        },
        onChange,
        upstreamNodes: [],
        workflowParams: [],
        projects: [],
        defaultProviderId: "provider-1",
        defaultModelTier: "sonnet",
      }),
    )

    const checkbox = container.querySelector<HTMLButtonElement>("[role='checkbox']")
    expect(checkbox?.getAttribute("aria-checked")).toBe("true")
    expect(container.textContent).toContain("Bailian 公司 · deepseek-v4-pro")

    act(() => {
      checkbox?.click()
    })

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      providerId: undefined,
      modelTier: undefined,
    }))
    expect(container.textContent).toContain("使用工作流默认：Bailian 公司 · deepseek-v4-pro")
  })
})
