/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ProviderPanel } from "@/modules/settings/components/provider-panel"
import type { SynapseAgentProvider } from "@/types/bridge"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LOCAL_PROVIDER_BASE = {
  id: "local-claude-code",
  name: "CC/Synapse",
  category: "official",
  source: "local",
  readonly: true,
  configured: true,
  configPath: "/Users/test/.claude/settings.json",
  apiKeyField: "ANTHROPIC_AUTH_TOKEN",
  active: true,
  createdAt: "",
  updatedAt: "",
} as const

let roots: Root[] = []

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("ProviderPanel", () => {
  it("refreshes provider rows while settings stays open", async () => {
    const listProviders = vi.fn()
      .mockResolvedValueOnce([localProvider("DeepSeek V4 PRO")])
      .mockResolvedValueOnce([localProvider("DeepSeek V4 PRO")])
      .mockResolvedValue([localProvider("Kimi K2.6")])
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
          listProviderPresets: vi.fn().mockResolvedValue([]),
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<ProviderPanel />)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(listProviders).toHaveBeenCalled()
    expect(document.body.textContent).toContain("Kimi K2.6")
  })
})

function localProvider(model: string): SynapseAgentProvider {
  return {
    ...LOCAL_PROVIDER_BASE,
    model,
  } as unknown as SynapseAgentProvider
}
