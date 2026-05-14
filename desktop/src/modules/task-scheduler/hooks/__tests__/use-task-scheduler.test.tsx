/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useTaskSchedulerTasks } from "../use-task-scheduler"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

const bridge = vi.hoisted(() => ({
  taskScheduler: {
    listTasks: vi.fn(),
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("useTaskSchedulerTasks", () => {
  it("logs list refresh failures without exposing the backend error message", async () => {
    const rawError = "secret scheduler database failure"
    const snapshots: Array<ReturnType<typeof useTaskSchedulerTasks>> = []
    bridge.taskScheduler.listTasks.mockRejectedValue(new Error(rawError))

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<Probe onSnapshot={(state) => snapshots.push(state)} />)
    })

    expect(rendererLogger.warn).toHaveBeenCalledWith("Task scheduler list refresh failed.", {
      action: "listTasks",
      boundary: "renderer.task-scheduler.list",
      errorType: "Error",
      errorLength: rawError.length,
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("secret scheduler database failure")
    expect(snapshots.at(-1)?.error).toBe("读取任务失败")
  })
})

function Probe({ onSnapshot }: { readonly onSnapshot?: (state: ReturnType<typeof useTaskSchedulerTasks>) => void }) {
  const state = useTaskSchedulerTasks()
  onSnapshot?.(state)
  return null
}
