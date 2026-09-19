/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const bridgeMock = vi.hoisted(() => ({ requireSynapseBridge: vi.fn() }))
const toastMock = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock("@/lib/electron-bridge", () => bridgeMock)
vi.mock("sonner", () => ({ toast: toastMock }))
vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { useAgentProjectTerminalActions } from "../use-agent-project-terminal-actions"
import { subscribeOpenTerminalSession } from "@/app-shell/terminal-navigation"
import type { SynapseSystemAppTerminalOpenRequest } from "@/modules/apps/types"
import type { ProviderModelSelection } from "@/types/provider-model"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
const terminalOpenSubscriptions: Array<() => void> = []
const selection: ProviderModelSelection = { providerId: "bailian", modelTier: "default" }

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, "", "/")
})

afterEach(async () => {
  for (const unsubscribe of terminalOpenSubscriptions.splice(0)) unsubscribe()
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
})

async function renderHook(): Promise<{ readonly current: ReturnType<typeof useAgentProjectTerminalActions> }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const result: { current: ReturnType<typeof useAgentProjectTerminalActions> | null } = { current: null }
  function Probe() {
    result.current = useAgentProjectTerminalActions()
    return null
  }
  await act(async () => { root.render(<Probe />) })
  return result as { readonly current: ReturnType<typeof useAgentProjectTerminalActions> }
}

function collectTerminalOpenRequests(): SynapseSystemAppTerminalOpenRequest[] {
  const requests: SynapseSystemAppTerminalOpenRequest[] = []
  terminalOpenSubscriptions.push(subscribeOpenTerminalSession((request) => {
    requests.push(request)
  }))
  return requests
}

function detachSidebarWindow(): void {
  window.history.replaceState({}, "", "/?window=system-app&appId=agent")
}

describe("useAgentProjectTerminalActions", () => {
  it("creates a Claude Code terminal with the selected provider and opens it inside the app", async () => {
    const createClaudeCodeTerminal = vi.fn(async () => ({ sessionId: "session-1" }))
    const openSystemApp = vi.fn(async () => undefined)
    bridgeMock.requireSynapseBridge.mockReturnValue({
      agent: { createClaudeCodeTerminal },
      apps: { openSystemApp },
    })
    const requests = collectTerminalOpenRequests()
    const hook = await renderHook()

    let created = false
    await act(async () => {
      created = await hook.current.startClaudeCodeTerminal({ id: "project-1", selection })
    })

    expect(created).toBe(true)
    expect(createClaudeCodeTerminal).toHaveBeenCalledWith({
      projectId: "project-1",
      providerId: "bailian",
      modelTier: "default",
    })
    expect(requests).toEqual([{ requestId: expect.any(String), sessionId: "session-1" }])
    expect(openSystemApp).not.toHaveBeenCalled()
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it("opens a Terminal window when the sidebar runs in a detached app window", async () => {
    detachSidebarWindow()
    const createClaudeCodeTerminal = vi.fn(async () => ({ sessionId: "session-3" }))
    const openSystemApp = vi.fn(async () => undefined)
    bridgeMock.requireSynapseBridge.mockReturnValue({
      agent: { createClaudeCodeTerminal },
      apps: { openSystemApp },
    })
    const requests = collectTerminalOpenRequests()
    const hook = await renderHook()

    await act(async () => {
      await hook.current.startClaudeCodeTerminal({ id: "project-1", selection })
    })

    expect(openSystemApp).toHaveBeenCalledWith("terminal", {
      terminalOpenRequest: { requestId: expect.any(String), sessionId: "session-3" },
    })
    expect(requests).toEqual([])
  })

  it("reports a creation failure without opening the terminal", async () => {
    const createClaudeCodeTerminal = vi.fn(async () => {
      throw new Error("boom")
    })
    const openSystemApp = vi.fn(async () => undefined)
    bridgeMock.requireSynapseBridge.mockReturnValue({
      agent: { createClaudeCodeTerminal },
      apps: { openSystemApp },
    })
    const requests = collectTerminalOpenRequests()
    const hook = await renderHook()

    let created = true
    await act(async () => {
      created = await hook.current.startClaudeCodeTerminal({ id: "project-1", selection })
    })

    expect(created).toBe(false)
    expect(openSystemApp).not.toHaveBeenCalled()
    expect(requests).toEqual([])
    expect(toastMock.error).toHaveBeenCalledWith("无法在终端中启动 Claude Code。")
  })

  it("surfaces the missing bundled runtime explicitly", async () => {
    const createClaudeCodeTerminal = vi.fn(async () => {
      throw new Error("内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。")
    })
    bridgeMock.requireSynapseBridge.mockReturnValue({
      agent: { createClaudeCodeTerminal },
      apps: { openSystemApp: vi.fn() },
    })
    const hook = await renderHook()

    await act(async () => {
      await hook.current.startClaudeCodeTerminal({ id: "project-1", selection })
    })

    expect(toastMock.error).toHaveBeenCalledWith("内置 Claude Code runtime 缺失，请更新或重新安装 Synapse。")
  })

  it("keeps the created session when the terminal window fails to open", async () => {
    detachSidebarWindow()
    const createClaudeCodeTerminal = vi.fn(async () => ({ sessionId: "session-2" }))
    const openSystemApp = vi.fn(async () => {
      throw new Error("window failed")
    })
    bridgeMock.requireSynapseBridge.mockReturnValue({
      agent: { createClaudeCodeTerminal },
      apps: { openSystemApp },
    })
    const hook = await renderHook()

    let created = false
    await act(async () => {
      created = await hook.current.startClaudeCodeTerminal({ id: "project-1", selection })
    })

    expect(created).toBe(true)
    expect(toastMock.error).toHaveBeenCalledWith("Claude Code 已启动，但无法打开终端应用。")
  })
})
