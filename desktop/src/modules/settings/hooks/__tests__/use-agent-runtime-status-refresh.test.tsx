/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAgentRuntimeStatus } from "@/modules/settings/hooks/use-agent-runtime-status"
import type { SynapseAgentRuntimeStatus } from "@/types/agent"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

describe("useAgentRuntimeStatus", () => {
  it("refreshes runtime status while settings stays open", async () => {
    const getRuntimeStatus = vi.fn()
      .mockResolvedValueOnce(runtimeStatus("DeepSeek V4 PRO"))
      .mockResolvedValueOnce(runtimeStatus("Kimi K2.6"))
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          getRuntimeStatus,
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<RuntimeStatusProbe />)
    })

    expect(document.body.textContent).toContain("DeepSeek V4 PRO")

    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await Promise.resolve()
    })

    expect(getRuntimeStatus).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("Kimi K2.6")
  })
})

function RuntimeStatusProbe() {
  const { status } = useAgentRuntimeStatus()
  return <div>{status?.agents[0]?.provider?.activeModel ?? "pending"}</div>
}

function runtimeStatus(model: string): SynapseAgentRuntimeStatus {
  return {
    agents: [{
      id: "claude-code",
      label: "Claude Code",
      ready: true,
      cli: {
        required: false,
        installed: true,
        path: null,
      },
      provider: {
        configured: true,
        activeProviderId: "local-claude-code",
        activeModel: model,
      },
      issues: [],
    }],
  }
}
