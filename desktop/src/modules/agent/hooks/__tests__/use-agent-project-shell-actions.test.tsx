/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAgentProjectShellActions } from "../use-agent-project-shell-actions"

const mocks = vi.hoisted(() => ({
  showItemInFolder: vi.fn(),
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
  mocks.showItemInFolder.mockReset().mockResolvedValue(undefined)
  mocks.toastError.mockReset()
  mocks.loggerWarn.mockReset()
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: { shell: { showItemInFolder: mocks.showItemInFolder } },
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

describe("useAgentProjectShellActions", () => {
  it("shows the project path in the system file manager", async () => {
    await clickShowInFolder()

    expect(mocks.showItemInFolder).toHaveBeenCalledWith("/work/project-one")
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it("reports a sanitized error when the project cannot be shown", async () => {
    const rawError = new Error("permission denied /work/project-one")
    mocks.showItemInFolder.mockRejectedValueOnce(rawError)

    await clickShowInFolder()

    expect(mocks.loggerWarn).toHaveBeenCalledWith("Agent project show in folder failed.", {
      boundary: "renderer.agent.project-show-in-folder",
      projectId: "project-1",
      errorName: "Error",
      errorLength: rawError.message.length,
    })
    expect(JSON.stringify(mocks.loggerWarn.mock.calls)).not.toContain(rawError.message)
    expect(mocks.toastError).toHaveBeenCalledWith("无法在文件夹中显示项目。")
  })
})

function Driver() {
  const { showProjectInFolder } = useAgentProjectShellActions()
  return (
    <button
      type="button"
      onClick={() => void showProjectInFolder({ id: "project-1", path: "/work/project-one" })}
    >
      show
    </button>
  )
}

async function clickShowInFolder(): Promise<void> {
  await act(async () => {
    document.querySelector<HTMLButtonElement>("button")?.click()
    await Promise.resolve()
  })
}
