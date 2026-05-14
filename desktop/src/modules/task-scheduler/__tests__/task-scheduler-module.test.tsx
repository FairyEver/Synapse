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
  createTaskRequest: vi.fn(),
  exportTasksToFile: vi.fn(),
  importTasksFromFile: vi.fn(),
  notify: vi.fn(),
  runTask: vi.fn(),
  stopRun: vi.fn(),
  cancelWatchNextAgentSession: vi.fn(),
  requestWatchNextAgentSession: vi.fn(),
  rendererLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  useTaskSchedulerTasks: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.rendererLogger,
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
    createTask: mocks.createTaskRequest,
    exportTasksToFile: mocks.exportTasksToFile,
    importTasksFromFile: mocks.importTasksFromFile,
    runTask: mocks.runTask,
    stopRun: mocks.stopRun,
    useTaskSchedulerTasks: mocks.useTaskSchedulerTasks,
  }
})

vi.mock("../components/task-form-dialog", () => ({
  TaskFormDialog: ({
    onCreate,
  }: {
    onCreate: (input: Record<string, unknown>) => Promise<void>
  }) => (
    <button
      type="button"
      onClick={() => onCreate({
        name: "Agent save task",
        scope: { type: "global" },
        trigger: { type: "builtin.interval", config: { everyMinutes: 1, anchor: "created_at" } },
        action: { type: "builtin.agent", config: { prompt: "secret prompt", projectId: "project-1" } },
        enabled: true,
        missedRunPolicy: "skip",
      })}
    >
      submit create
    </button>
  ),
}))

vi.mock("../components/task-runs-dialog", () => ({
  TaskRunsDialog: ({
    onStopRun,
  }: {
    onStopRun: (runId: string) => Promise<void>
  }) => (
    <button type="button" onClick={() => { void onStopRun("run-stale").catch(() => undefined) }}>
      stop stale run
    </button>
  ),
}))

vi.mock("../components/task-export-dialog", () => ({
  TaskExportDialog: ({
    open,
    onExport,
    tasks,
  }: {
    open: boolean
    onExport: (ids: string[]) => void
    tasks: ScheduledTask[]
  }) => open ? (
    <button type="button" onClick={() => onExport(tasks.map((task) => task.id))}>
      export selected tasks
    </button>
  ) : null,
}))

vi.mock("../components/task-import-dialog", () => ({
  TaskImportDialog: ({
    entries,
    onImport,
  }: {
    entries: unknown[]
    onImport: (indices: number[]) => void
  }) => (
    <button type="button" onClick={() => onImport(entries.map((_, index) => index))}>
      confirm import
    </button>
  ),
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

  it("logs mutation failures without exposing raw backend error text", async () => {
    const rawError = "save failed token=sk-secret /Users/example/repo prompt text"
    mocks.createTaskRequest.mockRejectedValueOnce(new Error(rawError))
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [],
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

    const submitButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("submit create"))
    expect(submitButton).toBeTruthy()

    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.rendererLogger.error).toHaveBeenCalledWith("Task scheduler mutation failed.", {
      boundary: "renderer.task-scheduler.mutation",
      errorName: "Error",
      errorLength: rawError.length,
    })
    const details = mocks.rendererLogger.error.mock.calls[0]?.[1] as Record<string, unknown>
    expect(details).not.toHaveProperty("error")
    expect(JSON.stringify(mocks.rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(mocks.rendererLogger.error.mock.calls)).not.toContain("/Users/example")
    expect(JSON.stringify(mocks.rendererLogger.error.mock.calls)).not.toContain("prompt text")
  })

  it("treats stop responses without a stopped run as failures", async () => {
    const refresh = vi.fn()
    mocks.stopRun.mockResolvedValue({ stopped: false })
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [createTask({ name: "Long running task" })],
      loading: false,
      error: null,
      refresh,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<TaskSchedulerModule />)
    })

    const stopButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("stop stale run"))
    expect(stopButton).toBeTruthy()

    await act(async () => {
      stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.stopRun).toHaveBeenCalledWith("run-stale")
    expect(mocks.rendererLogger.error).toHaveBeenCalledWith("Task scheduler mutation failed.", {
      boundary: "renderer.task-scheduler.mutation",
      errorName: "Error",
      errorLength: "Task run was not active".length,
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it("logs sanitized diagnostics when a manual Agent task run fails", async () => {
    mocks.runTask.mockRejectedValue(new Error("scheduler unavailable token=sk-secret /Users/example/repo prompt text"))
    const sensitiveTaskName = "Nightly token=sk-task /Users/example/repo prompt text"
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [
        createTask({
          name: sensitiveTaskName,
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
    expect(mocks.rendererLogger.error).toHaveBeenCalledWith("Failed to run task.", {
      action: "runTask",
      boundary: "renderer.task-scheduler.runTask",
      taskId: "task-1",
      taskNameLength: sensitiveTaskName.length,
      actionType: "builtin.agent",
      errorName: "Error",
      errorLength: "scheduler unavailable token=sk-secret /Users/example/repo prompt text".length,
    })
    const details = mocks.rendererLogger.error.mock.calls[0]?.[1] as Record<string, unknown>
    expect(details).not.toHaveProperty("error")
    expect(JSON.stringify(mocks.rendererLogger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(mocks.rendererLogger.error.mock.calls)).not.toContain("sk-task")
    expect(JSON.stringify(mocks.rendererLogger.error.mock.calls)).not.toContain("/Users/example")
    expect(JSON.stringify(mocks.rendererLogger.error.mock.calls)).not.toContain("prompt text")
  })

  it.each([
    ["missing", null],
    ["skipped", { id: "run-1", status: "skipped" }],
    ["failed", { id: "run-1", status: "failed" }],
    ["cancelled", { id: "run-1", status: "cancelled" }],
    ["timeout", { id: "run-1", status: "timeout" }],
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

  it("logs export failures without exposing task content or raw errors", async () => {
    const rawError = "export failed token=sk-secret /Users/example prompt text"
    mocks.exportTasksToFile.mockRejectedValue(new Error(rawError))
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [
        createTask({
          name: "Agent export token=sk-task",
          action: {
            type: "builtin.agent",
            config: {
              prompt: "secret prompt",
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

    const exportOpenButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("导出"))
    expect(exportOpenButton).toBeTruthy()

    await act(async () => {
      exportOpenButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    const exportSubmitButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("export selected tasks"))
    expect(exportSubmitButton).toBeTruthy()

    await act(async () => {
      exportSubmitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.rendererLogger.warn).toHaveBeenCalledWith("Task export failed.", {
      action: "exportTasks",
      boundary: "renderer.task-scheduler.export",
      selectedCount: 1,
      agentTaskCount: 1,
      actionTypes: ["builtin.agent"],
      triggerTypes: ["builtin.interval"],
      errorName: "Error",
      errorLength: rawError.length,
    })
    expect(mocks.notify).toHaveBeenCalledWith({ message: "导出失败", tone: "destructive" })
    expect(JSON.stringify(mocks.rendererLogger.warn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(mocks.rendererLogger.warn.mock.calls)).not.toContain("sk-task")
    expect(JSON.stringify(mocks.rendererLogger.warn.mock.calls)).not.toContain("/Users/example")
    expect(JSON.stringify(mocks.rendererLogger.warn.mock.calls)).not.toContain("secret prompt")
  })

  it("logs import parse failures without exposing imported file content", async () => {
    const rawContent = "token=sk-secret prompt text"
    mocks.importTasksFromFile.mockResolvedValue({ success: true, content: rawContent })
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [],
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

    const importButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("导入"))
    expect(importButton).toBeTruthy()

    await act(async () => {
      importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.rendererLogger.warn).toHaveBeenCalledWith("Task import parse failed.", {
      action: "importTasks",
      boundary: "renderer.task-scheduler.import.parse",
      contentLength: rawContent.length,
      errorName: "SyntaxError",
      errorLength: expect.any(Number),
    })
    expect(JSON.stringify(mocks.rendererLogger.warn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(mocks.rendererLogger.warn.mock.calls)).not.toContain("prompt text")
  })

  it("logs import create failures without exposing raw error text", async () => {
    const rawError = "create failed token=sk-secret /Users/example prompt text"
    const refresh = vi.fn()
    mocks.importTasksFromFile.mockResolvedValue({
      success: true,
      content: JSON.stringify({
        version: 1,
        exportedAt: "2026-05-14T00:00:00.000Z",
        tasks: [{
          name: "Secret import task",
          scope: { type: "global" },
          trigger: { type: "builtin.interval", config: { everyMinutes: 1, anchor: "created_at" } },
          action: { type: "builtin.agent", config: { prompt: "secret prompt", projectId: "project-1" } },
          missedRunPolicy: "skip",
        }],
      }),
    })
    mocks.createTaskRequest.mockRejectedValue(new Error(rawError))
    mocks.useTaskSchedulerTasks.mockReturnValue({
      tasks: [],
      loading: false,
      error: null,
      refresh,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<TaskSchedulerModule />)
    })

    const importButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("导入"))
    expect(importButton).toBeTruthy()

    await act(async () => {
      importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    const confirmButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("confirm import"))
    expect(confirmButton).toBeTruthy()

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.rendererLogger.warn).toHaveBeenCalledWith("Task import entry create failed.", {
      action: "importTasks",
      boundary: "renderer.task-scheduler.import.create",
      selectedCount: 1,
      entryIndex: 0,
      actionType: "builtin.agent",
      taskNameLength: "Secret import task".length,
      errorName: "Error",
      errorLength: rawError.length,
    })
    expect(refresh).toHaveBeenCalled()
    expect(JSON.stringify(mocks.rendererLogger.warn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(mocks.rendererLogger.warn.mock.calls)).not.toContain("/Users/example")
    expect(JSON.stringify(mocks.rendererLogger.warn.mock.calls)).not.toContain("secret prompt")
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
