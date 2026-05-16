/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useTaskSchedulerTasks } from "../use-task-scheduler"
import type { ScheduledTask } from "@/types/task-scheduler"

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
  it("keeps loaded tasks visible while a refresh is in flight", async () => {
    const task = createTask()
    let resolveRefresh: (tasks: ScheduledTask[]) => void = () => {}
    const pendingRefresh = new Promise<ScheduledTask[]>((resolve) => {
      resolveRefresh = resolve
    })
    const snapshots: Array<ReturnType<typeof useTaskSchedulerTasks>> = []
    bridge.taskScheduler.listTasks
      .mockResolvedValueOnce([task])
      .mockReturnValueOnce(pendingRefresh)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<Probe onSnapshot={(state) => snapshots.push(state)} />)
    })
    expect(snapshots.at(-1)?.tasks).toEqual([task])
    expect(snapshots.at(-1)?.loading).toBe(false)

    await act(async () => {
      void snapshots.at(-1)?.refresh()
      await Promise.resolve()
    })

    expect(snapshots.at(-1)?.tasks).toEqual([task])
    expect(snapshots.at(-1)?.loading).toBe(false)

    await act(async () => {
      resolveRefresh([task])
      await pendingRefresh
    })
  })

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

function createTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    schemaVersion: 2,
    name: "Backup",
    scope: { type: "global" },
    trigger: {
      type: "builtin.interval",
      config: { everyMinutes: 1, anchor: "created_at" },
    },
    action: {
      type: "builtin.command",
      config: {
        command: "echo ok",
        shell: "posix",
        timeoutMins: 30,
      },
    },
    enabled: true,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
    runCount: 0,
    ...overrides,
  }
}
