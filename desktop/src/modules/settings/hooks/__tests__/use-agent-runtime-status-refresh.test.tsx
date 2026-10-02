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

  it("keeps one slow background request across polling intervals and applies its result", async () => {
    const pending = deferred<SynapseAgentRuntimeStatus>()
    const getRuntimeStatus = vi.fn()
      .mockResolvedValueOnce(runtimeStatus("initial"))
      .mockReturnValue(pending.promise)
    installRuntimeBridge(getRuntimeStatus)
    const root = mountProbe()
    await act(async () => { root.render(<RuntimeStatusProbe />) })

    await act(async () => { await vi.advanceTimersByTimeAsync(5_300) })
    expect(getRuntimeStatus).toHaveBeenCalledTimes(2)
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
      document.dispatchEvent(new Event("visibilitychange"))
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(getRuntimeStatus).toHaveBeenCalledTimes(2)

    await act(async () => {
      pending.resolve(runtimeStatus("slow result"))
      await pending.promise
    })
    expect(document.body.textContent).toContain("slow result")
    getRuntimeStatus.mockResolvedValue(runtimeStatus("next"))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getRuntimeStatus).toHaveBeenCalledTimes(3)
    expect(document.body.textContent).toContain("next")
  })

  it("releases the polling guard after a background failure", async () => {
    const pending = deferred<SynapseAgentRuntimeStatus>()
    const getRuntimeStatus = vi.fn()
      .mockResolvedValueOnce(runtimeStatus("initial"))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(runtimeStatus("recovered"))
    installRuntimeBridge(getRuntimeStatus)
    const root = mountProbe()
    await act(async () => { root.render(<RuntimeStatusProbe />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_300) })

    await act(async () => {
      pending.reject(new Error("temporary failure"))
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("initial")
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    expect(getRuntimeStatus).toHaveBeenCalledTimes(3)
    expect(document.body.textContent).toContain("recovered")
  })

  it("loads a newly selected project while a previous project request is still pending", async () => {
    const pending = deferred<SynapseAgentRuntimeStatus>()
    const getRuntimeStatus = vi.fn()
      .mockResolvedValueOnce(runtimeStatus("first project"))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(runtimeStatus("second project"))
    installRuntimeBridge(getRuntimeStatus)
    const root = mountProbe()
    await act(async () => { root.render(<RuntimeStatusProbe projectId="first" />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_300) })
    await act(async () => { root.render(<RuntimeStatusProbe projectId="second" />) })

    expect(getRuntimeStatus).toHaveBeenLastCalledWith({ projectId: "second" })
    expect(document.body.textContent).toContain("second project")
    await act(async () => {
      pending.resolve(runtimeStatus("stale first project"))
      await pending.promise
    })
    expect(document.body.textContent).toContain("second project")
  })

  it("lets an explicit refresh supersede a slow background request without losing its guard", async () => {
    const background = deferred<SynapseAgentRuntimeStatus>()
    const explicit = deferred<SynapseAgentRuntimeStatus>()
    const getRuntimeStatus = vi.fn()
      .mockResolvedValueOnce(runtimeStatus("initial"))
      .mockReturnValueOnce(background.promise)
      .mockReturnValueOnce(explicit.promise)
    installRuntimeBridge(getRuntimeStatus)
    const root = mountProbe()
    let refresh!: ReturnType<typeof useAgentRuntimeStatus>["refresh"]
    await act(async () => { root.render(<RuntimeStatusProbe onRefresh={(next) => { refresh = next }} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_300) })
    await act(async () => { refresh() })
    expect(getRuntimeStatus).toHaveBeenCalledTimes(3)

    await act(async () => { background.resolve(runtimeStatus("stale")); await background.promise })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(getRuntimeStatus).toHaveBeenCalledTimes(3)
    expect(document.body.textContent).toContain("initial")

    await act(async () => { explicit.resolve(runtimeStatus("explicit")); await explicit.promise })
    expect(document.body.textContent).toContain("explicit")
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function installRuntimeBridge(getRuntimeStatus: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: { agent: { getRuntimeStatus } },
  })
}

function mountProbe(): Root {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  return root
}

function RuntimeStatusProbe({ projectId, onRefresh }: {
  readonly projectId?: string
  readonly onRefresh?: (refresh: ReturnType<typeof useAgentRuntimeStatus>["refresh"]) => void
}) {
  const { status, refresh } = useAgentRuntimeStatus(projectId)
  onRefresh?.(refresh)
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
