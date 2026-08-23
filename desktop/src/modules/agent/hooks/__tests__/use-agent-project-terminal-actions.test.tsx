/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAgentProjectTerminalActions } from "../use-agent-project-terminal-actions"

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  openSystemApp: vi.fn(),
  toastError: vi.fn(),
  loggerWarn: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ warn: mocks.loggerWarn }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

beforeEach(() => {
  mocks.createSession.mockReset().mockResolvedValue({ id: "session-1" })
  mocks.openSystemApp.mockReset().mockResolvedValue(undefined)
  mocks.toastError.mockReset()
  mocks.loggerWarn.mockReset()
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      terminal: { session: { create: mocks.createSession } },
      apps: { openSystemApp: mocks.openSystemApp },
    },
  })
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Driver />))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: unknown }).synapse
})

describe("useAgentProjectTerminalActions", () => {
  it("creates a terminal in the project directory and opens that session", async () => {
    await clickOpenTerminal()

    expect(mocks.createSession).toHaveBeenCalledWith({ cwd: "/work/project-one" })
    expect(mocks.openSystemApp).toHaveBeenCalledWith("terminal", {
      terminalOpenRequest: {
        requestId: expect.any(String),
        sessionId: "session-1",
      },
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it("does not open the Terminal app when session creation fails", async () => {
    const rawError = new Error("invalid cwd /work/project-one")
    mocks.createSession.mockRejectedValueOnce(rawError)

    await clickOpenTerminal()

    expect(mocks.openSystemApp).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith("无法在终端中打开项目。")
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain(rawError.message)
  })

  it("reports when the session exists but the Terminal window cannot open", async () => {
    mocks.openSystemApp.mockRejectedValueOnce(new Error("window failed"))

    await clickOpenTerminal()

    expect(mocks.toastError).toHaveBeenCalledWith("终端已创建，但无法打开终端应用。")
  })
})

function Driver() {
  const { openProjectInTerminal } = useAgentProjectTerminalActions()
  return (
    <button
      type="button"
      onClick={() => void openProjectInTerminal({ id: "project-1", path: "/work/project-one" })}
    >
      open
    </button>
  )
}

async function clickOpenTerminal(): Promise<void> {
  await act(async () => {
    document.querySelector<HTMLButtonElement>("button")?.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}
