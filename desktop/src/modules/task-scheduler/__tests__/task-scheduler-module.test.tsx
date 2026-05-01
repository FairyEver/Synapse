import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { TaskSchedulerModule } from "../index"
import type { ScheduledTask } from "@/types/task-scheduler"

const useTaskSchedulerTasksMock = vi.hoisted(() => vi.fn())

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: [],
      },
    },
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    promise: async <T,>(operation: () => Promise<T>) => operation(),
  }),
}))

vi.mock("../hooks/use-task-scheduler", async () => {
  const actual = await vi.importActual<typeof import("../hooks/use-task-scheduler")>(
    "../hooks/use-task-scheduler",
  )

  return {
    ...actual,
    useTaskSchedulerTasks: useTaskSchedulerTasksMock,
  }
})

vi.mock("../components/task-form-dialog", () => ({
  TaskFormDialog: () => null,
}))

vi.mock("../components/task-runs-dialog", () => ({
  TaskRunsDialog: () => null,
}))

describe("TaskSchedulerModule", () => {
  it("does not render a duplicate module heading", () => {
    useTaskSchedulerTasksMock.mockReturnValue({
      tasks: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).not.toContain(">定时任务</h2>")
  })

  it("does not render a pause action when tasks already have an enable switch", () => {
    useTaskSchedulerTasksMock.mockReturnValue({
      tasks: [createTask({ enabled: true })],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).not.toContain(">暂停</span>")
    expect(html).not.toContain("lucide-pause")
  })

  it("renders action summaries", () => {
    useTaskSchedulerTasksMock.mockReturnValue({
      tasks: [createTask()],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("命令 · echo ok")
  })
})

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
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
    runCount: 0,
    ...overrides,
  }
}
