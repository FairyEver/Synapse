/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { SwarmRun, SwarmTask, SwarmWorkerRun } from "../../shared/schema"

const swarmTaskFixtures = vi.hoisted(() => {
  const taskA: SwarmTask = {
    id: "task-1",
    schemaVersion: 1,
    name: "任务 A",
    currentConfig: {
      projectId: "project-1",
      prompt: "Run.",
      presetId: "general",
      promptInjection: {
        sequenceBatch: { enabled: false },
        previousHandoff: { enabled: false },
        summary: { enabled: false, injectRecent: false, recentLimit: 3 },
        fileWrite: {
          enabled: false,
          path: "",
          mode: "append-only",
          lock: { enabled: true },
        },
        customAppendix: "",
      },
      runMode: "batch",
      concurrency: 2,
      maxRounds: 2,
      agent: {},
    },
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    lastRunId: "run-1",
    lastStatus: "running",
  }

  const taskB: SwarmTask = {
    id: "task-2",
    schemaVersion: 1,
    name: "任务 B",
    currentConfig: {
      projectId: "project-2",
      prompt: "Run B.",
      presetId: "general",
      promptInjection: {
        sequenceBatch: { enabled: false },
        previousHandoff: { enabled: false },
        summary: { enabled: false, injectRecent: false, recentLimit: 3 },
        fileWrite: {
          enabled: false,
          path: "",
          mode: "append-only",
          lock: { enabled: true },
        },
        customAppendix: "",
      },
      runMode: "batch",
      concurrency: 2,
      maxRounds: 2,
      agent: {},
    },
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  }

  const run: SwarmRun = {
    id: "run-1",
    schemaVersion: 1,
    taskId: taskA.id,
    status: "running",
    configSnapshot: taskA.currentConfig,
    startedAt: "2026-07-07T00:10:00.000Z",
    totals: { started: 1, success: 0, failed: 0, cancelled: 0, timeout: 0 },
    stopRequested: false,
  }

  const runB: SwarmRun = {
    ...run,
    id: "run-2",
    taskId: taskB.id,
    status: "running",
    configSnapshot: taskB.currentConfig,
  }

  const drainingRun: SwarmRun = {
    ...run,
    status: "draining",
    stopRequested: true,
  }

  const worker: SwarmWorkerRun = {
    id: "worker-1",
    schemaVersion: 1,
    taskId: taskA.id,
    runId: "run-1",
    workerIndex: 1,
    roundIndex: 1,
    status: "running",
    conversationId: "conversation-1",
    sessionKey: "session-1",
    startedAt: "2026-07-07T00:11:00.000Z",
    lastPhase: "thinking",
    lastMessage: "处理中",
  }

  const successRun: SwarmRun = {
    ...run,
    status: "success",
    finishedAt: "2026-07-07T00:20:00.000Z",
    totals: { started: 1, success: 1, failed: 0, cancelled: 0, timeout: 0 },
  }

  const successTask: SwarmTask = {
    ...taskA,
    lastStatus: "success",
  }

  const successWorker: SwarmWorkerRun = {
    ...worker,
    status: "success",
    finishedAt: "2026-07-07T00:20:00.000Z",
    lastPhase: "completed",
    lastMessage: "已完成",
  }

  return { taskA, taskB, run, runB, drainingRun, worker, successRun, successTask, successWorker }
})

const swarmTaskEvents = vi.hoisted(() => ({
  changedListener: undefined as undefined | ((event: {
    taskId?: string
    runId?: string
    workerRunId?: string
    reason: string
  }) => void),
}))

const swarmTaskBridge = vi.hoisted(() => ({
  listTasks: vi.fn(async () => [swarmTaskFixtures.taskA, swarmTaskFixtures.taskB]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  startRun: vi.fn(async () => swarmTaskFixtures.run),
  stopRefill: vi.fn(async () => swarmTaskFixtures.run),
  cancelRun: vi.fn(async () => swarmTaskFixtures.run),
  listRuns: vi.fn(async () => [swarmTaskFixtures.run]),
  getRun: vi.fn(async () => swarmTaskFixtures.run),
  listWorkerRuns: vi.fn(async () => [swarmTaskFixtures.worker]),
  onChanged: vi.fn((listener) => {
    swarmTaskEvents.changedListener = listener
    return () => {
      if (swarmTaskEvents.changedListener === listener) {
        swarmTaskEvents.changedListener = undefined
      }
    }
  }),
}))

const agentBridge = vi.hoisted(() => ({
  openConversation: vi.fn(async () => ({ opened: true as const, conversationId: "conversation-1" })),
}))

const appConfig = vi.hoisted(() => ({
  value: {
    global: {
      projects: [
        { id: "project-1", name: "项目一", path: "/repo" },
        { id: "project-2", name: "项目二", path: "/repo-b" },
      ],
    },
  },
}))

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "swarmTask") return swarmTaskBridge
    if (domain === "agent") return agentBridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({ config: appConfig.value }),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("@/modules/apps/components/system-app-window-shell", () => ({
  SystemAppWindowShell: ({
    tabs,
    actions,
    children,
  }: {
    tabs?: ReadonlyArray<{ id: string; label: string }>
    actions?: ReactNode
    children: ReactNode
  }) => (
    <div>
      <div data-testid="app-actions">{actions}</div>
      {tabs ? <div data-testid="app-tabs">{tabs.map((tab) => tab.label).join(",")}</div> : null}
      <div>{children}</div>
    </div>
  ),
}))

vi.mock("sonner", () => ({ toast }))

import { SwarmTaskModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
HTMLElement.prototype.scrollIntoView = vi.fn()

let roots: Root[] = []

beforeEach(() => {
  vi.useRealTimers()
  swarmTaskEvents.changedListener = undefined
  swarmTaskBridge.listTasks.mockClear()
  swarmTaskBridge.listTasks.mockImplementation(async () => [swarmTaskFixtures.taskA, swarmTaskFixtures.taskB])
  swarmTaskBridge.startRun.mockClear()
  swarmTaskBridge.startRun.mockImplementation(async () => swarmTaskFixtures.run)
  swarmTaskBridge.createTask.mockClear()
  swarmTaskBridge.createTask.mockImplementation(async () => swarmTaskFixtures.taskA)
  swarmTaskBridge.updateTask.mockClear()
  swarmTaskBridge.updateTask.mockImplementation(async (input: { patch: { currentConfig?: SwarmTask["currentConfig"]; name?: string } }) => ({
    ...swarmTaskFixtures.taskA,
    ...(input.patch.name ? { name: input.patch.name } : {}),
    currentConfig: input.patch.currentConfig ?? swarmTaskFixtures.taskA.currentConfig,
  }))
  swarmTaskBridge.listRuns.mockClear()
  swarmTaskBridge.listRuns.mockImplementation(async () => [swarmTaskFixtures.run])
  swarmTaskBridge.getRun.mockClear()
  swarmTaskBridge.getRun.mockImplementation(async () => swarmTaskFixtures.run)
  swarmTaskBridge.listWorkerRuns.mockClear()
  swarmTaskBridge.listWorkerRuns.mockImplementation(async () => [swarmTaskFixtures.worker])
  swarmTaskBridge.onChanged.mockClear()
  swarmTaskBridge.onChanged.mockImplementation((listener) => {
    swarmTaskEvents.changedListener = listener
    return () => {
      if (swarmTaskEvents.changedListener === listener) {
        swarmTaskEvents.changedListener = undefined
      }
    }
  })
  swarmTaskBridge.stopRefill.mockClear()
  swarmTaskBridge.stopRefill.mockImplementation(async () => swarmTaskFixtures.run)
  swarmTaskBridge.cancelRun.mockClear()
  swarmTaskBridge.cancelRun.mockImplementation(async () => swarmTaskFixtures.run)
  swarmTaskBridge.deleteTask.mockClear()
  swarmTaskBridge.deleteTask.mockImplementation(async () => undefined)
  appConfig.value.global.projects = [
    { id: "project-1", name: "项目一", path: "/repo" },
    { id: "project-2", name: "项目二", path: "/repo-b" },
  ]
  agentBridge.openConversation.mockClear()
  agentBridge.openConversation.mockImplementation(async () => ({ opened: true as const, conversationId: "conversation-1" }))
  toast.error.mockClear()
  toast.success.mockClear()
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
})

describe("SwarmTaskModule", () => {
  it("opens the name dialog before creating a task from the empty state", async () => {
    swarmTaskBridge.listTasks.mockResolvedValueOnce([])
    swarmTaskBridge.createTask.mockResolvedValueOnce(swarmTaskFixtures.taskA)

    await renderModule()
    await clickButton("新建任务")

    const nameInput = await waitForInput("任务名称")
    expect(nameInput.value).toMatch(/^任务 [A-Z0-9]{4}$/)
    expect(swarmTaskBridge.createTask).not.toHaveBeenCalled()
  })

  it("creates and selects a task with the default dialog name", async () => {
    swarmTaskBridge.listTasks.mockResolvedValueOnce([])
    swarmTaskBridge.createTask.mockImplementationOnce(async (input) => ({
      ...swarmTaskFixtures.taskA,
      name: input.name,
    }))

    await renderModule()
    await clickButton("新建任务")

    const nameInput = await waitForInput("任务名称")
    const defaultName = nameInput.value
    await clickButton("保存")

    expect(swarmTaskBridge.createTask).toHaveBeenCalledWith({
      name: defaultName,
      config: {
        projectId: "project-1",
        prompt: "填写任务目标",
        presetId: "general",
        promptInjection: {
          sequenceBatch: { enabled: false },
          previousHandoff: { enabled: false },
          summary: { enabled: false, injectRecent: false, recentLimit: 3 },
          fileWrite: {
            enabled: false,
            path: "",
            mode: "append-only",
            lock: { enabled: true },
          },
          customAppendix: "",
        },
        runMode: "batch",
        concurrency: 1,
        maxRounds: 1,
        agent: {},
      },
    })
    expect(toast.success).toHaveBeenCalledWith("已创建")
    await clickTab("配置")
    await waitForTextareaValue("Run.")
  })

  it("creates a task with a custom dialog name", async () => {
    swarmTaskBridge.listTasks.mockResolvedValueOnce([])
    swarmTaskBridge.createTask.mockImplementationOnce(async (input) => ({
      ...swarmTaskFixtures.taskA,
      name: input.name,
    }))

    await renderModule()
    await clickButton("新建任务")
    await setInputValue(await waitForInput("任务名称"), "任务 自定义")
    await clickButton("保存")

    expect(swarmTaskBridge.createTask).toHaveBeenCalledWith(expect.objectContaining({
      name: "任务 自定义",
    }))
    expect(document.body.textContent).toContain("任务 自定义")
  })

  it("renames a task from the task row menu", async () => {
    swarmTaskBridge.updateTask.mockResolvedValueOnce({
      ...swarmTaskFixtures.taskA,
      name: "任务 改名",
    })

    await renderModule()
    await openButtonMenu("任务 A 操作")
    await clickMenuItem("重命名")

    const nameInput = await waitForInput("任务名称")
    expect(nameInput.value).toBe("任务 A")
    await setInputValue(nameInput, "任务 改名")
    await clickButton("保存")

    expect(swarmTaskBridge.updateTask).toHaveBeenCalledWith({
      taskId: "task-1",
      patch: { name: "任务 改名" },
    })
    expect(document.body.textContent).toContain("任务 改名")
  })

  it("deletes a task from the task row menu", async () => {
    swarmTaskBridge.listTasks
      .mockResolvedValueOnce([swarmTaskFixtures.taskA, swarmTaskFixtures.taskB])
      .mockResolvedValueOnce([swarmTaskFixtures.taskA])

    await renderModule()
    await openButtonMenu("任务 B 操作")
    await clickMenuItem("删除")
    await clickButton("删除")

    expect(swarmTaskBridge.deleteTask).toHaveBeenCalledWith("task-2")
    expect(swarmTaskBridge.listTasks).toHaveBeenCalledTimes(2)
    expect(toast.success).toHaveBeenCalledWith("已删除")
  })

  it("does not submit a blank task name", async () => {
    await renderModule()
    await clickButton("新建任务")
    await setInputValue(await waitForInput("任务名称"), "   ")

    const saveButton = await waitForButton("保存")
    expect(saveButton.disabled).toBe(true)
    await clickButton("保存")

    expect(swarmTaskBridge.createTask).not.toHaveBeenCalled()
  })

  it("loads tasks into the overview without app-level tabs", async () => {
    await renderModule()

    expect(swarmTaskBridge.listTasks).toHaveBeenCalled()
    expect(document.querySelector("[data-testid='app-tabs']")).toBeNull()
    expect(document.body.textContent).toContain("任务 A")
    expect(document.body.textContent).toContain("当前任务")
    expect(document.body.textContent).toContain("最近运行")
    expect(document.body.textContent).toContain("项目一")
    expect(document.body.textContent).toContain("并发上限")
    expect(document.body.textContent).toContain("批次数")
    expect(document.body.textContent).toContain("计划 worker")
    expect(document.body.textContent).not.toContain("project-id")
    expect(getTextarea()).toBeNull()
    expect(document.body.textContent).toContain("运行中")
  })

  it("saves and starts the selected task from the config tab", async () => {
    swarmTaskBridge.updateTask.mockResolvedValueOnce({
      ...swarmTaskFixtures.taskA,
      currentConfig: { ...swarmTaskFixtures.taskA.currentConfig, prompt: "Run." },
    })

    await renderModule()
    await clickTab("配置")

    expect(getTextarea()?.value).toBe("Run.")
    await clickButton("保存配置")
    await clickButton("运行任务")

    expect(swarmTaskBridge.updateTask).toHaveBeenCalledWith({
      taskId: "task-1",
      patch: { currentConfig: swarmTaskFixtures.taskA.currentConfig },
    })
    expect(swarmTaskBridge.startRun).toHaveBeenCalledWith({ taskId: "task-1" })
  })

  it("shows project names in the config form instead of internal project ids", async () => {
    await renderModule()
    await clickTab("配置")

    expect(await waitForButton("项目：项目一")).toBeTruthy()
    expect(document.body.textContent).not.toContain("project-id")
  })

  it("selects a project without exposing a run directory", async () => {
    await renderModule()
    await clickTab("配置")

    await selectOption("项目：项目一", "项目二")

    expect(document.body.textContent).not.toContain("运行目录")
    expect(document.querySelector("[aria-label='运行目录']")).toBeNull()
    expect(swarmTaskBridge.updateTask).not.toHaveBeenCalled()
  })

  it("disables task creation when no projects are configured", async () => {
    appConfig.value.global.projects = []
    swarmTaskBridge.listTasks.mockResolvedValueOnce([])

    await renderModule()

    const createButton = await waitForButton("新建任务")
    expect(createButton.disabled).toBe(true)
    expect(document.body.textContent).toContain("请先在设置中添加项目")

    await clickButton("新建任务")

    expect(swarmTaskBridge.createTask).not.toHaveBeenCalled()
  })

  it("requires a valid project before saving or running an existing task", async () => {
    swarmTaskBridge.listTasks.mockResolvedValueOnce([{
      ...swarmTaskFixtures.taskA,
      currentConfig: {
        ...swarmTaskFixtures.taskA.currentConfig,
        projectId: "missing-project",
      },
    }])

    await renderModule()
    await clickTab("配置")

    expect(document.body.textContent).toContain("项目不可用")
    expect((await waitForButton("保存配置")).disabled).toBe(true)
    expect((await waitForButton("运行任务")).disabled).toBe(true)

    await clickButton("保存配置")
    await clickButton("运行任务")

    expect(swarmTaskBridge.updateTask).not.toHaveBeenCalled()
    expect(swarmTaskBridge.startRun).not.toHaveBeenCalled()
  })

  it("keeps the task goal textarea at three rows by default", async () => {
    await renderModule()
    await clickTab("配置")

    const textarea = getTextarea()
    expect(textarea?.rows).toBe(3)
    expect(textarea?.className).toContain("min-h-[calc(3lh+1rem+2px)]")
  })

  it("shows detailed run mode options in a custom menu", async () => {
    await renderModule()
    await clickTab("配置")

    const runModeTrigger = await waitForButton("运行模式：分批运行")
    expect(runModeTrigger.className).toContain("h-8")
    expect(runModeTrigger.className).not.toContain("h-9")

    await openButtonMenu("运行模式：分批运行")

    const item = getOptionItem("continuous")
    expect(item.textContent).toContain("补位运行")
    expect(item.textContent).toContain("完成后补位")
    expect(document.body.textContent).not.toContain("直到手动停止")
    expect(getDropdownContent()?.className).not.toContain("w-[340px]")

    await hoverElement(item)

    expect(document.body.textContent).toContain("continuous")
    expect(document.body.textContent).toContain("会发生什么")
    expect(document.body.textContent).toContain("每个槽位完成一轮后立即进入下一轮")
    expect(getHoverCardContent()?.className).toContain("w-72")

    await clickOptionItem("continuous")

    expect(await waitForButton("运行模式：补位运行")).toBeTruthy()
    expect(await waitForInput("每槽轮次")).toBeTruthy()
    expect(document.body.textContent).toContain("补位运行会保持 2 个 worker 槽位并发")
    expect(document.body.textContent).toContain("每槽最多执行 2 轮")
    expect(document.body.textContent).toContain("最多启动 4 个 worker")
  })

  it("shows grouped config fields and prompt injection controls", async () => {
    await renderModule()
    await clickTab("配置")

    expect(document.body.textContent).toContain("任务")
    expect(document.body.textContent).toContain("运行")
    expect(document.body.textContent).toContain("并发上限")
    expect(document.body.textContent).toContain("批次数")
    expect(document.body.textContent).toContain("注入")
    expect(document.body.textContent).toContain("文件")
    expect(await waitForInput("并发上限")).toBeTruthy()
    expect(await waitForInput("批次数")).toBeTruthy()
    expect(document.body.textContent).toContain("分批运行会每批同时启动 2 个 worker")
    expect(document.body.textContent).toContain("共执行 2 批")
    expect(document.body.textContent).toContain("最多启动 4 个 worker")
    expect(document.body.textContent).toContain("序列和批次")
    expect(document.body.textContent).toContain("上一轮交接")
    expect(document.body.textContent).toContain("记录摘要")
    expect(document.body.textContent).toContain("文件写入")
    expect(document.body.textContent).not.toContain("输出")
    expect(document.body.textContent).not.toContain("Git 上下文")
    expect(document.body.textContent).not.toContain("目录 + 文件")
  })

  it("requires a file path when file write injection is enabled", async () => {
    await renderModule()
    await clickTab("配置")

    await clickSwitch("文件写入")

    expect((await waitForButton("保存配置")).disabled).toBe(true)
    expect((await waitForButton("运行任务")).disabled).toBe(true)

    await setInputValue(await waitForInput("文件路径"), "reports/swarm.md")

    expect((await waitForButton("保存配置")).disabled).toBe(false)
    expect((await waitForButton("运行任务")).disabled).toBe(false)
  })

  it("allows absolute file write paths before saving", async () => {
    await renderModule()
    await clickTab("配置")

    await clickSwitch("文件写入")
    await setInputValue(await waitForInput("文件路径"), "/Users/liyang/Downloads/demo.md")

    expect((await waitForButton("保存配置")).disabled).toBe(false)
    expect((await waitForButton("运行任务")).disabled).toBe(false)
  })

  it("rejects file write paths with parent traversal before saving", async () => {
    await renderModule()
    await clickTab("配置")

    await clickSwitch("文件写入")
    await setInputValue(await waitForInput("文件路径"), "../demo.md")

    expect((await waitForButton("保存配置")).disabled).toBe(true)
    expect((await waitForButton("运行任务")).disabled).toBe(true)
    expect(document.body.textContent).toContain("路径不能包含 ..")

    await clickButton("保存配置")
    await clickButton("运行任务")

    expect(swarmTaskBridge.updateTask).not.toHaveBeenCalled()
    expect(swarmTaskBridge.startRun).not.toHaveBeenCalled()
  })

  it("opens worker conversations from the run tab", async () => {
    await renderModule()
    await clickTab("运行")
    await waitForButton("打开会话")
    await clickButton("打开会话")

    expect(agentBridge.openConversation).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "session-1",
      platform: "swarm",
    })
  })

  it("refreshes the sidebar status and worker table together from the run tab", async () => {
    await renderModule()
    await clickTab("运行")
    await waitForText("处理中")

    swarmTaskBridge.listTasks.mockImplementation(async () => [swarmTaskFixtures.successTask, swarmTaskFixtures.taskB])
    swarmTaskBridge.listRuns.mockImplementation(async () => [swarmTaskFixtures.successRun])
    swarmTaskBridge.getRun.mockImplementation(async () => swarmTaskFixtures.successRun)
    swarmTaskBridge.listWorkerRuns.mockImplementation(async () => [swarmTaskFixtures.successWorker])

    await clickButton("刷新", 0)

    await waitForText("已完成")
    expect(taskStatusIcon("任务 A", "完成")).toBeTruthy()
    expect(taskButtonByText("任务 A")?.textContent).not.toContain("完成")
  })

  it("refreshes the current run when a swarm task change event arrives", async () => {
    await renderModule()
    await clickTab("运行")
    await waitForText("处理中")

    expect(swarmTaskEvents.changedListener).toBeTypeOf("function")
    swarmTaskBridge.listTasks.mockImplementation(async () => [swarmTaskFixtures.successTask, swarmTaskFixtures.taskB])
    swarmTaskBridge.listRuns.mockImplementation(async () => [swarmTaskFixtures.successRun])
    swarmTaskBridge.getRun.mockImplementation(async () => swarmTaskFixtures.successRun)
    swarmTaskBridge.listWorkerRuns.mockImplementation(async () => [swarmTaskFixtures.successWorker])

    await act(async () => {
      swarmTaskEvents.changedListener?.({
        taskId: "task-1",
        runId: "run-1",
        workerRunId: "worker-1",
        reason: "worker-finished",
      })
      await Promise.resolve()
    })

    await waitForText("已完成")
    expect(taskStatusIcon("任务 A", "完成")).toBeTruthy()
    expect(taskButtonByText("任务 A")?.textContent).not.toContain("完成")
  })

  it("polls while the selected run is active and stops after it reaches a terminal state", async () => {
    vi.useFakeTimers()

    await renderModule()
    await clickTab("运行")
    await waitForText("处理中")

    swarmTaskBridge.listTasks.mockImplementation(async () => [swarmTaskFixtures.successTask, swarmTaskFixtures.taskB])
    swarmTaskBridge.listRuns.mockImplementation(async () => [swarmTaskFixtures.successRun])
    swarmTaskBridge.getRun.mockImplementation(async () => swarmTaskFixtures.successRun)
    swarmTaskBridge.listWorkerRuns.mockImplementation(async () => [swarmTaskFixtures.successWorker])

    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await Promise.resolve()
    })

    await waitForText("已完成")
    const callsAfterTerminalRefresh = swarmTaskBridge.getRun.mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(4_000)
      await Promise.resolve()
    })

    expect(swarmTaskBridge.getRun).toHaveBeenCalledTimes(callsAfterTerminalRefresh)
  })

  it("shows errors when stop refill or cancel run fails", async () => {
    swarmTaskBridge.stopRefill.mockRejectedValueOnce(new Error("停止补位失败"))
    swarmTaskBridge.cancelRun.mockRejectedValueOnce(new Error("取消运行失败"))

    await renderModule()
    await clickTab("运行")
    await waitForButton("停止新轮次")
    await waitForButton("取消运行")

    await clickButton("停止新轮次")
    await clickButton("取消运行")

    expect(swarmTaskBridge.stopRefill).toHaveBeenCalledWith("run-1")
    expect(swarmTaskBridge.cancelRun).toHaveBeenCalledWith("run-1")
    expect(toast.error).toHaveBeenCalledWith("停止补位失败")
    expect(toast.error).toHaveBeenCalledWith("取消运行失败")
  })

  it("shows the refill stop action for continuous runs", async () => {
    const continuousRun: SwarmRun = {
      ...swarmTaskFixtures.run,
      configSnapshot: {
        ...swarmTaskFixtures.run.configSnapshot,
        runMode: "continuous",
      },
    }
    swarmTaskBridge.listRuns.mockImplementation(async () => [continuousRun])
    swarmTaskBridge.getRun.mockImplementation(async () => continuousRun)

    await renderModule()
    await clickTab("运行")

    expect(await waitForButton("停止补位")).toBeTruthy()
    expect(waitForButtonSync("停止新轮次")).toBeUndefined()
  })

  it("can cancel a draining run", async () => {
    swarmTaskBridge.listRuns.mockImplementation(async () => [swarmTaskFixtures.drainingRun])
    swarmTaskBridge.getRun.mockImplementation(async () => swarmTaskFixtures.drainingRun)

    await renderModule()
    await clickTab("运行")
    await waitForButton("取消运行")

    await clickButton("取消运行")

    expect(swarmTaskBridge.cancelRun).toHaveBeenCalledWith("run-1")
  })

  it("reruns the selected task from the history tab", async () => {
    await renderModule()
    await clickTab("历史")
    await clickButton("再运行当前任务")

    expect(swarmTaskBridge.startRun).toHaveBeenCalledWith({ taskId: "task-1" })
  })

  it("does not render a toolbar delete action", async () => {
    await renderModule()

    expect(waitForButtonSync("删除任务")).toBeUndefined()
  })

  it("deletes a task from its row menu after confirmation", async () => {
    swarmTaskBridge.listTasks
      .mockResolvedValueOnce([swarmTaskFixtures.taskA, swarmTaskFixtures.taskB])
      .mockResolvedValueOnce([swarmTaskFixtures.taskA])

    await renderModule()
    await openButtonMenu("任务 B 操作")
    await clickMenuItem("删除")
    await clickButton("删除")

    expect(swarmTaskBridge.deleteTask).toHaveBeenCalledWith("task-2")
    expect(swarmTaskBridge.listTasks).toHaveBeenCalledTimes(2)
    expect(toast.success).toHaveBeenCalledWith("已删除")
  })

  it("disables row menu delete for a running task", async () => {
    await renderModule()
    await openButtonMenu("任务 A 操作")

    const deleteItem = await waitForMenuItem("删除")
    expect(deleteItem.getAttribute("aria-disabled")).toBe("true")

    await clickMenuItem("删除")

    expect(swarmTaskBridge.deleteTask).not.toHaveBeenCalled()
  })

  it("does not render task search", async () => {
    await renderModule()

    expect(document.querySelector('input[aria-label="搜索任务"]')).toBeNull()
    expect(document.body.textContent).not.toContain("搜索任务")
  })

  it("does not render workspace paths in the task sidebar", async () => {
    await renderModule()

    expect(taskButtonByText("任务 A")?.textContent).not.toContain("/repo")
    expect(taskButtonByText("任务 B")?.textContent).not.toContain("/repo-b")
  })

  it("keeps overview content padding at the sides and scroll bottom", async () => {
    await renderModule()

    expect(detailTabHeader()?.className).toContain("py-3")
    const contentClassName = overviewContentWrapper()?.className ?? ""
    expect(contentClassName).toContain("px-3")
    expect(contentClassName).toContain("pb-3")
    expect(contentClassName).not.toContain("p-3")
    expect(contentClassName).not.toContain("pt-")

    await clickTab("配置")
    const configClassName = document.querySelector<HTMLElement>("[data-slot='field-group']")?.className ?? ""
    expect(configClassName).toContain("px-3")
    expect(configClassName).toContain("pb-3")
    expect(configClassName).not.toContain("p-3")
    expect(configClassName).not.toContain("pt-")
  })

  it("keeps the detail pane aligned with the selected task", async () => {
    await renderModule()

    await clickTab("配置")
    expect(getTextarea()?.value).toBe("Run.")

    await clickTask("任务 B")

    await waitForTextareaValue("Run B.")
    expect(document.body.textContent).toContain("任务 B")

    await clickButton("运行任务")

    expect(swarmTaskBridge.startRun).toHaveBeenCalledTimes(1)
    expect(swarmTaskBridge.startRun).toHaveBeenCalledWith({ taskId: "task-2" })
  })

  it("does not render stale workers while loading a newly selected task", async () => {
    let resolveTaskBRuns: ((runs: SwarmRun[]) => void) | null = null
    swarmTaskBridge.listRuns.mockImplementation(async ({ taskId }: { taskId: string }) => {
      if (taskId === "task-2") {
        return await new Promise<SwarmRun[]>((resolve) => {
          resolveTaskBRuns = resolve
        })
      }
      return [swarmTaskFixtures.run]
    })

    await renderModule()
    await clickTab("运行")
    await waitForButton("打开会话")

    agentBridge.openConversation.mockClear()

    await clickTask("任务 B")
    await clickButton("打开会话")

    expect(agentBridge.openConversation).not.toHaveBeenCalled()

    await act(async () => {
      resolveTaskBRuns?.([])
      await Promise.resolve()
    })
  })

  it("does not render stale history when an older run request resolves late", async () => {
    let resolveTaskARuns: ((runs: SwarmRun[]) => void) | null = null
    let resolveTaskBRuns: ((runs: SwarmRun[]) => void) | null = null
    swarmTaskBridge.listRuns.mockImplementation(async ({ taskId }: { taskId: string }) => (
      await new Promise<SwarmRun[]>((resolve) => {
        if (taskId === "task-1") {
          resolveTaskARuns = resolve
          return
        }
        resolveTaskBRuns = resolve
      })
    ))

    await renderModule()
    await clickTab("历史")
    await clickTask("任务 B")

    await act(async () => {
      resolveTaskARuns?.([swarmTaskFixtures.run])
      await Promise.resolve()
    })

    expect(document.body.textContent).not.toContain("running")

    await act(async () => {
      resolveTaskBRuns?.([])
      await Promise.resolve()
    })
  })

  it("keeps newer selected task run data when an older request resolves late", async () => {
    let resolveTaskARuns: ((runs: SwarmRun[]) => void) | null = null
    let resolveTaskBRuns: ((runs: SwarmRun[]) => void) | null = null
    swarmTaskBridge.listRuns.mockImplementation(async ({ taskId }: { taskId: string }) => (
      await new Promise<SwarmRun[]>((resolve) => {
        if (taskId === "task-1") {
          resolveTaskARuns = resolve
          return
        }
        resolveTaskBRuns = resolve
      })
    ))
    swarmTaskBridge.getRun.mockImplementation(async (runId: string) => (
      runId === "run-2" ? swarmTaskFixtures.runB : swarmTaskFixtures.run
    ))
    swarmTaskBridge.listWorkerRuns.mockImplementation(async (runId: string) => (
      runId === "run-2"
        ? [{ ...swarmTaskFixtures.worker, id: "worker-2", taskId: "task-2", runId: "run-2", lastMessage: "任务 B worker" }]
        : [swarmTaskFixtures.worker]
    ))

    await renderModule()
    await clickTab("运行")
    await clickTask("任务 B")

    await act(async () => {
      resolveTaskBRuns?.([swarmTaskFixtures.runB])
      await Promise.resolve()
    })
    await waitForButton("打开会话")
    expect(document.body.textContent).toContain("任务 B worker")

    await act(async () => {
      resolveTaskARuns?.([swarmTaskFixtures.run])
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("任务 B worker")
    expect(document.body.textContent).toContain("任务 B")
  })

  it("shows an error when opening a worker conversation is not handled", async () => {
    agentBridge.openConversation.mockResolvedValueOnce({ opened: false, reason: "not-found" })

    await renderModule()
    await clickTab("运行")
    await waitForButton("打开会话")

    await clickButton("打开会话")

    expect(toast.error).toHaveBeenCalledWith("会话不存在")
  })
})

async function renderModule(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => {
    root.render(<SwarmTaskModule />)
    await Promise.resolve()
  })
}

async function clickButton(text: string, index = 0): Promise<void> {
  const buttons = Array.from(document.body.querySelectorAll("button"))
    .filter((button) => button.textContent?.trim() === text || button.getAttribute("aria-label") === text)
  await act(async () => {
    buttons[index]?.click()
    await Promise.resolve()
  })
}

function getTextarea(): HTMLTextAreaElement | null {
  return document.body.querySelector("textarea")
}

async function waitForTextareaValue(value: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (getTextarea()?.value === value) return
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error(`Textarea value not found: ${value}`)
}

async function waitForText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (document.body.textContent?.includes(text)) return
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error(`Text not found: ${text}`)
}

async function clickTab(text: string): Promise<void> {
  const tab = await waitForButton(text)

  await act(async () => {
    tab.click()
    await Promise.resolve()
  })
}

async function clickTask(text: string): Promise<void> {
  const taskButton = taskButtonByText(text)

  await act(async () => {
    taskButton?.click()
    await Promise.resolve()
  })
}

async function clickMenuItem(text: string): Promise<void> {
  const item = await waitForMenuItem(text)
  await act(async () => {
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

async function clickOptionItem(value: string): Promise<void> {
  const item = getOptionItem(value)
  await act(async () => {
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

async function clickSwitch(label: string): Promise<void> {
  let control: HTMLElement | null = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const element = document.querySelector(`[aria-label="${label}"]`)
    if (element instanceof HTMLElement) {
      control = element
      break
    }
    await act(async () => {
      await Promise.resolve()
    })
  }
  if (!control) throw new Error(`Missing switch: ${label}`)
  await act(async () => {
    control.click()
    await Promise.resolve()
  })
}

async function openButtonMenu(label: string): Promise<void> {
  const button = await waitForButton(label)
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

async function selectOption(triggerLabel: string, optionText: string): Promise<void> {
  const trigger = await waitForButton(triggerLabel)
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await Promise.resolve()
  })

  const option = await waitForOption(optionText)
  await act(async () => {
    option.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

function taskButtonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button"))
    .find((button) => button.textContent?.includes(text))
}

function taskStatusIcon(taskName: string, statusLabel: string): HTMLElement | null {
  return taskButtonByText(taskName)?.querySelector(`[aria-label="${statusLabel}"]`) ?? null
}

function getOptionItem(value: string): HTMLElement {
  const item = document.querySelector<HTMLElement>(`[data-option-value="${value}"]`)
  expect(item).toBeTruthy()
  return item
}

function getDropdownContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-slot='dropdown-menu-content']")
}

function getHoverCardContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-slot='hover-card-content']")
}

function detailTabHeader(): HTMLElement | null {
  return waitForButtonSync("概览")?.closest(".bg-background") as HTMLElement | null
}

function overviewContentWrapper(): HTMLElement | null {
  return Array.from(document.body.querySelectorAll("h3"))
    .find((heading) => heading.textContent === "当前任务")
    ?.parentElement
    ?.parentElement ?? null
}

function waitForButtonSync(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent?.trim() === text || item.getAttribute("aria-label") === text)
}

async function waitForButton(text: string): Promise<HTMLButtonElement> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const button = waitForButtonSync(text)
    if (button instanceof HTMLButtonElement) return button
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error(`Button not found: ${text}`)
}

async function waitForInput(label: string): Promise<HTMLInputElement> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
    if (input) return input
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error(`Input not found: ${label}`)
}

async function waitForOption(text: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const option = Array.from(document.body.querySelectorAll<HTMLElement>("[role='option']"))
      .find((element) => element.textContent?.trim() === text)
    if (option) return option
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error(`Option not found: ${text}`)
}

async function waitForMenuItem(text: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const item = Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitem']"))
      .find((element) => element.textContent?.trim() === text)
    if (item) return item
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error(`Menu item not found: ${text}`)
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await Promise.resolve()
  })
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function hoverElement(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    element.dispatchEvent(new MouseEvent("pointerenter", { bubbles: false }))
    element.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }))
    element.focus()
    await wait(120)
  })
}
