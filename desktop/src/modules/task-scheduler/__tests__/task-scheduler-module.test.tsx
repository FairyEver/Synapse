/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TaskSchedulerModule } from "../index"
import type { ScheduledTask } from "@/types/task-scheduler"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  runTask: vi.fn(),
  cancelWatchNextAgentSession: vi.fn(),
  requestWatchNextAgentSession: vi.fn(),
  useTaskSchedulerTasks: vi.fn(),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: [
          {
            id: "project-1",
            name: "Synapse",
            path: "/Users/liyang/Documents/code/github/Synapse",
          },
        ],
      },
    },
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    notify: mocks.notify,
    promise: async <T,>(operation: () => Promise<T>) => operation(),
  }),
}))

vi.mock("@/app-shell/navigation", () => ({
  cancelWatchNextAgentSession: mocks.cancelWatchNextAgentSession,
  requestWatchNextAgentSession: mocks.requestWatchNextAgentSession,
}))

vi.mock("../hooks/use-task-scheduler", async () => {
  const actual = await vi.importActual<typeof import("../hooks/use-task-scheduler")>(
    "../hooks/use-task-scheduler",
  )

  return {
    ...actual,
    runTask: mocks.runTask,
    useTaskSchedulerTasks: mocks.useTaskSchedulerTasks,
  }
})

vi.mock("../components/task-form-dialog", () => ({
  TaskFormDialog: () => null,
}))

vi.mock("../components/task-runs-dialog", () => ({
  TaskRunsDialog: () => null,
}))

vi.mock("../components/task-export-dialog", () => ({
  TaskExportDialog: () => null,
}))

vi.mock("../components/task-import-dialog", () => ({
  TaskImportDialog: () => null,
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

describe("TaskSchedulerModule", () => {
  it("renders empty state when there are no tasks", () => {
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("暂无任务")
  })

  it("renders task names in cards", () => {
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [createTask({ name: "Backup" })],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("Backup")
  })

  it("contains scroll chaining inside the task list", () => {
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [createTask({ name: "Backup" })],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("overflow-y-auto overscroll-contain")
  })

  it("renders trigger info for interval tasks", () => {
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [createTask()],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("每 1 分钟")
  })

  it("renders enabled task card status, next run, description, and primary run action", () => {
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [
        createTask({
          name: "同步项目工作日志",
          description: "Codex 工作日志汇总",
          scope: { type: "project", projectId: "project-1" },
          nextRunAt: "2026-05-13T10:30:00.000Z",
          lastRunAt: "2026-05-13T01:00:00.000Z",
          lastStatus: "success",
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("已启用")
    expect(html).toContain("同步项目工作日志")
    expect(html).toContain("Codex 工作日志汇总")
    expect(html).toContain("下次执行")
    expect(html).toContain("运行")
    expect(html).toContain("上次")
    expect(html).toContain("成功")
    expect(html).toContain("范围")
    expect(html).toContain("Synapse")
  })

  it("renders failed task card as retryable", () => {
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [
        createTask({
          name: "仓库健康检查",
          lastStatus: "failed",
          lastRunAt: "2026-05-13T02:12:00.000Z",
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("上次失败")
    expect(html).toContain("重试")
    expect(html).toContain("失败")
  })

  it("renders disabled task card with stopped schedule state", () => {
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [
        createTask({
          name: "夜间归档",
          enabled: false,
          nextRunAt: "2026-05-13T18:00:00.000Z",
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("已停用")
    expect(html).toContain("停用中")
  })

  it("renders secondary actions behind the task card more-actions trigger", () => {
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [createTask({ name: "Backup" })],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("更多操作")
  })

  it("does not report success when a manual Agent task run fails", async () => {
    mocks.runTask.mockRejectedValue(new Error("scheduler unavailable"))
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [
        createTask({
          action: {
            type: "builtin.agent",
            config: {
              prompt: "run",
              projectId: "project-1",
            },
          },
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<TaskSchedulerModule />)
    })

    const runButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("运行"))
    expect(runButton).toBeTruthy()

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.runTask).toHaveBeenCalledWith("task-1")
    expect(mocks.requestWatchNextAgentSession).toHaveBeenCalledWith({ projectId: "project-1" })
    expect(mocks.cancelWatchNextAgentSession).toHaveBeenCalledWith({ projectId: "project-1" })
    expect(mocks.notify).toHaveBeenCalledWith({ message: "触发失败", tone: "destructive" })
    expect(mocks.notify).not.toHaveBeenCalledWith({ message: "任务已触发", tone: "success" })
  })

  it.each([
    ["missing", null],
    ["skipped", { id: "run-1", status: "skipped" }],
  ])(
    "cancels the next Agent session watch when a manual Agent task run is %s",
    async (_label, runResult) => {
      mocks.runTask.mockResolvedValue(runResult)
      mocks.useTaskSchedulerTasks.mockReturnValue({
        tasks: [
          createTask({
            action: {
              type: "builtin.agent",
              config: {
                prompt: "run",
                projectId: "project-1",
              },
            },
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      })

      const container = document.createElement("div")
      document.body.appendChild(container)
      const root = createRoot(container)
      roots.push(root)

      await act(async () => {
        root.render(<TaskSchedulerModule />)
      })

      const runButton = Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("运行"))
      expect(runButton).toBeTruthy()

      await act(async () => {
        runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(mocks.requestWatchNextAgentSession).toHaveBeenCalledWith({ projectId: "project-1" })
      expect(mocks.cancelWatchNextAgentSession).toHaveBeenCalledWith({ projectId: "project-1" })
      expect(mocks.notify).toHaveBeenCalledWith({ message: "触发失败", tone: "destructive" })
      expect(mocks.notify).not.toHaveBeenCalledWith({ message: "任务已触发", tone: "success" })
    },
  )

  it("watches the next Agent session after a manual Agent task run is accepted", async () => {
    mocks.runTask.mockResolvedValue({ id: "run-1", status: "running" })
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [
        createTask({
          action: {
            type: "builtin.agent",
            config: {
              prompt: "run",
              projectId: "project-1",
            },
          },
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<TaskSchedulerModule />)
    })

    const runButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("运行"))
    expect(runButton).toBeTruthy()

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.requestWatchNextAgentSession).toHaveBeenCalledWith({ projectId: "project-1" })
    expect(mocks.notify).toHaveBeenCalledWith({ message: "任务已触发", tone: "success" })
  })

  it("starts watching the next Agent session before the manual Agent run finishes", async () => {
    let resolveRun: (value: { id: string; status: "running" }) => void = () => {}
    mocks.runTask.mockReturnValue(new Promise((resolve) => {
      resolveRun = resolve
    }))
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [
        createTask({
          action: {
            type: "builtin.agent",
            config: {
              prompt: "run",
              projectId: "project-1",
            },
          },
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<TaskSchedulerModule />)
    })

    const runButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("运行"))
    expect(runButton).toBeTruthy()

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.requestWatchNextAgentSession).toHaveBeenCalledWith({ projectId: "project-1" })
    expect(mocks.notify).not.toHaveBeenCalledWith({ message: "任务已触发", tone: "success" })

    await act(async () => {
      resolveRun({ id: "run-1", status: "running" })
      await Promise.resolve()
    })

    expect(mocks.notify).toHaveBeenCalledWith({ message: "任务已触发", tone: "success" })
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
