import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"

import { SwitchNodePanel } from "../panel"

vi.mock("@/components/provider-model-select-dialog", () => ({
  ProviderModelSelectDialog: () => null,
}))

vi.mock("../../provider-lookup-context", () => ({
  useProviderLookup: () => ({
    getProviderName: () => undefined,
    getModelName: () => undefined,
    getModelDisplayName: () => undefined,
    isProviderAvailable: () => true,
  }),
}))

describe("SwitchNodePanel", () => {
  it("renders while a branch key is temporarily empty", () => {
    expect(() => renderToStaticMarkup(
      createElement(SwitchNodePanel, {
        config: {
          variables: [],
          prompt: "route",
          branches: [{ id: "", label: "Empty" }],
        },
        onChange: vi.fn(),
        upstreamNodes: [],
        workflowParams: [],
        projects: [],
      }),
    )).not.toThrow()
  })
})
