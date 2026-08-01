/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

import { useAgentRuntimeStatus } from "@/modules/settings/hooks/use-agent-runtime-status"
import type { SynapseAgentRuntimeStatus } from "@/types/agent"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  vi.useFakeTimers()
  rendererLogger.error.mockClear()
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
      vi.advanceTimersByTime(300)
      await Promise.resolve()
    })

    expect(getRuntimeStatus).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("Kimi K2.6")
  })

  it("logs runtime status refresh failures without raw backend error text", async () => {
    const getRuntimeStatus = vi.fn()
      .mockRejectedValue(new Error("secret SDK prompt detail"))
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
      root.render(<RuntimeStatusProbe projectId="project-1" />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rendererLogger.error).toHaveBeenCalledWith("Failed to load agent runtime status.", {
      boundary: "settings.agent-runtime.status-refresh",
      errorLength: 24,
      errorName: "Error",
      projectId: "project-1",
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret SDK prompt detail")
  })
})

function RuntimeStatusProbe({ projectId }: { readonly projectId?: string }) {
  const { status } = useAgentRuntimeStatus(projectId)
  return <div>{status?.agents[0]?.provider?.activeModel ?? "pending"}</div>
}

function runtimeStatus(model: string): SynapseAgentRuntimeStatus {
  return {
    agents: [{
      id: "claude-code",
      label: "CC/Synapse",
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
