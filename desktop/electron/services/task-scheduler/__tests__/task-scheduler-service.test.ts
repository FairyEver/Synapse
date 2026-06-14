import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

import {
  MainActionRegistry,
  type ActionExecutionInput,
  type MainActionDefinition,
} from "../../../action-runtime/action-registry"
import type { EventBus } from "../../../runtime/event-bus"
import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import type { StructuredLogger } from "../../../runtime/service-registry"
import { TaskSchedulerExecutionService } from "../execution-service"
import { ScheduledTaskRunRepository } from "../run-repository"
import { ScheduledTaskRepository } from "../task-repository"
import { TaskSchedulerService } from "../task-scheduler-service"
import type {
  ScheduledTaskEntry,
  ScheduledTaskRunEntry,
} from "../types"

const testActionSchema = z.object({ message: z.string().min(1) })
type TestActionConfig = z.infer<typeof testActionSchema>

describe("TaskSchedulerService", () => {
  it("schedules enabled tasks on start", async () => {
    const harness = createHarness()
    await harness.taskItems.upsert(createTask({ id: "task:1", nextRunAt: "2026-04-29T10:01:00.000Z" }))

    await harness.service.start()

    expect(harness.service.schedulerRuntimeInspect().timers).toContain("task:1")
    await harness.service.stop()
  })

  it("marks persisted running runs as failed on startup recovery", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ logger })
    await harness.taskItems.upsert(createTask({
      id: "task:1",
      enabled: false,
      runCount: 1,
    }))
    await harness.runItems.upsert({
      id: "run:stale",
      schemaVersion: 2,
      taskId: "task:1",
      startedAt: "2026-04-29T09:59:00.000Z",
      status: "running",
      triggeredBy: "schedule",
    })

    await harness.service.start()

    expect(await harness.runs.get("run:stale")).toEqual(expect.objectContaining({
      status: "failed",
      finishedAt: "2026-04-29T10:00:00.000Z",
      error: "应用异常退出，运行已在启动恢复时标记为失败。",
      result: {
        status: "failed",
        summary: "应用异常退出",
        error: "应用异常退出，运行已在启动恢复时标记为失败。",
      },
    }))
    expect(await harness.tasks.get("task:1")).toEqual(expect.objectContaining({
      lastStatus: "failed",
      runCount: 2,
    }))
    expect(logger.info).toHaveBeenCalledWith("Recovered interrupted scheduled task runs.", {
      boundary: "task-scheduler-startup-run-recovery",
      recoveredCount: 1,
    })
  })

  it("skips overlapping scheduled runs", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ action: longRunningAction(), logger })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))

    const runPromise = harness.service.runNow("task:1")
    await waitFor(async () => harness.service.schedulerRuntimeInspect().runningTaskIds.includes("task:1"))
    const skipped = await harness.service.triggerForTest("task:1", "schedule")

    expect(await harness.runs.listByTask("task:1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "skipped", error: "task is already running" }),
    ]))
    expect(skipped?.status).toBe("skipped")
    expect(logger.info).toHaveBeenCalledWith("Scheduled task run skipped.", {
      taskId: "task:1",
      runId: skipped?.id,
      triggeredBy: "schedule",
      status: "skipped",
      boundary: "task-scheduler-skip-run",
      reason: "task is already running",
    })
    const running = (await harness.runs.listByTask("task:1")).find((run) => run.status === "running")
    expect(running).toBeDefined()
    await harness.service.stopRun(running!.id)
    await runPromise
  })

  it("marks listed tasks that are currently running", async () => {
    const harness = createHarness({ action: longRunningAction() })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))

    const runPromise = harness.service.runNow("task:1")
    await waitFor(async () => harness.service.schedulerRuntimeInspect().runningTaskIds.includes("task:1"))

    expect(await harness.service.schedulerTaskList()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "task:1",
        activeRun: expect.objectContaining({ status: "running" }),
      }),
    ]))

    const running = (await harness.runs.listByTask("task:1")).find((run) => run.status === "running")
    expect(running).toBeDefined()
    await harness.service.stopRun(running!.id)
    await runPromise
  })

  it("does not expose an activeRun id before the run repository returns one", async () => {
    const harness = createHarness({ action: longRunningAction() })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))
    const start = harness.runs.start.bind(harness.runs)
    let releaseStart: (() => void) | undefined
    harness.runs.start = vi.fn((taskId, triggeredBy) =>
      new Promise<ScheduledTaskRunEntry>((resolve) => {
        releaseStart = () => {
          void start(taskId, triggeredBy).then(resolve)
        }
      }))

    const runPromise = harness.service.runNow("task:1")
    await waitFor(async () => harness.service.schedulerRuntimeInspect().runningTaskIds.includes("task:1"))

    const [task] = await harness.service.schedulerTaskList()
    expect(task).toEqual(expect.objectContaining({ id: "task:1" }))
    expect(task).not.toHaveProperty("activeRun")

    releaseStart?.()
    await waitFor(async () => (await harness.runs.listByTask("task:1")).some((run) => run.status === "running"))
    const running = (await harness.runs.listByTask("task:1")).find((run) => run.status === "running")
    expect(running).toBeDefined()
    await harness.service.stopRun(running!.id)
    await runPromise
  })

  it("emits scheduler change events when a scheduled run finishes", async () => {
    const emit = vi.fn()
    const eventBus: Pick<EventBus, "emit"> = { emit: emit as unknown as EventBus["emit"] }
    const harness = createHarness({ eventBus })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))

    const result = await harness.service.triggerForTest("task:1", "schedule")

    expect(result?.status).toBe("success")
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "scheduler",
        type: "scheduler.taskChanged",
        payload: expect.objectContaining({
          taskId: "task:1",
          runId: result?.id,
          reason: "run-finished",
        }),
      }),
      { backpressure: "coalesce" },
    )
  })

  it("stops running task by run id", async () => {
    const harness = createHarness({ action: longRunningAction() })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))

    const runPromise = harness.service.runNow("task:1")
    await waitFor(async () => (await harness.runs.listByTask("task:1")).some((run) => run.status === "running"))
    const running = (await harness.runs.listByTask("task:1")).find((run) => run.status === "running")
    expect(running).toBeDefined()

    await harness.service.stopRun(running!.id)
    await runPromise

    expect(await harness.runs.get(running!.id)).toEqual(expect.objectContaining({ status: "cancelled" }))
  })

  it("rejects deleting a task while it has an active run", async () => {
    const harness = createHarness({ action: longRunningAction() })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))

    const runPromise = harness.service.runNow("task:1")
    await waitFor(async () => harness.service.schedulerRuntimeInspect().runningTaskIds.includes("task:1"))

    await expect(harness.service.deleteTask("task:1")).rejects.toThrow(/running/i)
    expect(await harness.tasks.get("task:1")).toEqual(expect.objectContaining({ id: "task:1" }))

    const running = (await harness.runs.listByTask("task:1")).find((run) => run.status === "running")
    expect(running).toBeDefined()
    await harness.service.stopRun(running!.id)
    await runPromise
  })

  it("deletes stored run history when deleting a task", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ logger })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))
    await harness.service.runNow("task:1")
    expect(await harness.runs.listByTask("task:1")).toHaveLength(1)

    await expect(harness.service.deleteTask("task:1")).resolves.toEqual({ deleted: true })

    expect(await harness.tasks.get("task:1")).toBeNull()
    expect(await harness.runs.listByTask("task:1")).toEqual([])
    expect(logger.info).toHaveBeenCalledWith("Scheduled task deleted.", expect.objectContaining({
      boundary: "task-scheduler.task-delete",
      taskId: "task:1",
      deleted: true,
      deletedRunCount: 1,
    }))
  })

  it("settles runtime state before reporting a stop as complete", async () => {
    const harness = createHarness({ action: longRunningAction() })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))

    const runPromise = harness.service.runNow("task:1")
    await waitFor(async () => harness.service.schedulerRuntimeInspect().runningTaskIds.includes("task:1"))
    const running = (await harness.runs.listByTask("task:1")).find((run) => run.status === "running")
    expect(running).toBeDefined()

    await expect(harness.service.stopRun(running!.id)).resolves.toEqual({ stopped: true })

    const task = (await harness.service.schedulerTaskList()).find((item) => item.id === "task:1")
    expect(task).toBeDefined()
    expect(task).not.toHaveProperty("activeRun")
    await runPromise
  })

  it("logs stopRun requests with the run id and result", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ action: longRunningAction(), logger })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))

    const runPromise = harness.service.runNow("task:1")
    await waitFor(async () => (await harness.runs.listByTask("task:1")).some((run) => run.status === "running"))
    const running = (await harness.runs.listByTask("task:1")).find((run) => run.status === "running")
    expect(running).toBeDefined()

    await expect(harness.service.stopRun(running!.id)).resolves.toEqual({ stopped: true })
    await runPromise

    expect(logger.info).toHaveBeenCalledWith("Scheduled task stop requested.", {
      taskId: "task:1",
      runId: running!.id,
      stopped: true,
      runFound: true,
      boundary: "task-scheduler-stop-run",
    })
  })

  it("logs task CRUD operations with structured service context", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ logger })

    const created = await harness.service.schedulerTaskCreate({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
      action: { type: "builtin.test", config: { message: "ok" } },
    })
    await harness.service.schedulerTaskUpdate(created.id, { enabled: false })
    await harness.service.schedulerTaskEnable(created.id)
    await harness.service.schedulerTaskDisable(created.id)
    await harness.service.deleteTask(created.id)

    expect(logger.info).toHaveBeenCalledWith("Scheduled task created.", expect.objectContaining({
      boundary: "task-scheduler.task-create",
      taskId: created.id,
      actionType: "builtin.test",
      triggerType: "builtin.interval",
      enabled: true,
    }))
    expect(logger.info).toHaveBeenCalledWith("Scheduled task updated.", expect.objectContaining({
      boundary: "task-scheduler.task-update",
      taskId: created.id,
      patchKeys: ["enabled"],
      enabled: false,
    }))
    expect(logger.info).toHaveBeenCalledWith("Scheduled task enabled state changed.", expect.objectContaining({
      boundary: "task-scheduler.task-set-enabled",
      taskId: created.id,
      enabled: true,
    }))
    expect(logger.info).toHaveBeenCalledWith("Scheduled task enabled state changed.", expect.objectContaining({
      boundary: "task-scheduler.task-set-enabled",
      taskId: created.id,
      enabled: false,
    }))
    expect(logger.info).toHaveBeenCalledWith("Scheduled task deleted.", expect.objectContaining({
      boundary: "task-scheduler.task-delete",
      taskId: created.id,
      deleted: true,
    }))
  })

  it("cancels stale timers after manual last-completed interval runs", async () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness()
      await harness.taskItems.upsert(createTask({
        id: "task:1",
        trigger: { type: "builtin.interval", config: { everyMinutes: 10, anchor: "last_completed_at" } },
        nextRunAt: "2026-04-29T10:01:00.000Z",
      }))
      await harness.service.start()

      await harness.service.runNow("task:1")
      expect(await harness.runs.listByTask("task:1")).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(60_000)

      expect(await harness.runs.listByTask("task:1")).toHaveLength(1)
      await harness.service.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("cancels pending timers before manual runs can overlap", async () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness({ action: longRunningAction() })
      await harness.taskItems.upsert(createTask({
        id: "task:1",
        nextRunAt: "2026-04-29T10:01:00.000Z",
      }))
      await harness.service.start()

      const runPromise = harness.service.runNow("task:1")
      await flushPromises()
      expect(harness.service.schedulerRuntimeInspect().runningTaskIds).toContain("task:1")

      await vi.advanceTimersByTimeAsync(60_000)
      await flushPromises()

      const runs = await harness.runs.listByTask("task:1")
      expect(runs).toHaveLength(1)
      expect(runs).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ status: "skipped", error: "task is already running" }),
      ]))

      await harness.service.stopRun(runs[0].id)
      await runPromise
      await harness.service.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops active runs when the scheduler service stops", async () => {
    const harness = createHarness({ action: longRunningAction() })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))

    const runPromise = harness.service.runNow("task:1")
    await waitFor(async () => harness.service.schedulerRuntimeInspect().runningTaskIds.includes("task:1"))
    const running = (await harness.runs.listByTask("task:1")).find((run) => run.status === "running")
    expect(running).toBeDefined()

    await harness.service.stop()
    await runPromise

    expect(await harness.runs.get(running!.id)).toEqual(expect.objectContaining({ status: "cancelled" }))
    expect(harness.service.schedulerRuntimeInspect().runningTaskIds).toEqual([])
  })

  it("clears runtime state when stopping active runs reports a failure", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ action: longRunningAction(), logger })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))
    await harness.taskItems.upsert(createTask({ id: "task:2" }))
    await harness.service.start()

    const firstRun = harness.service.runNow("task:1")
    const secondRun = harness.service.runNow("task:2")
    await waitFor(async () => harness.service.schedulerRuntimeInspect().runningTaskIds.length === 2)
    const runningRuns = [
      ...await harness.runs.listByTask("task:1"),
      ...await harness.runs.listByTask("task:2"),
    ].filter((run) => run.status === "running")
    const failedRun = runningRuns.find((run) => run.taskId === "task:1")
    const otherRun = runningRuns.find((run) => run.taskId === "task:2")
    expect(failedRun).toBeDefined()
    expect(otherRun).toBeDefined()

    const stopRunSpy = vi.spyOn(harness.execution, "stopRun")
    const waitForRunToSettle = harness.execution.waitForRunToSettle.bind(harness.execution)
    vi.spyOn(harness.execution, "waitForRunToSettle").mockImplementation((runId) => {
      if (runId === failedRun!.id) return Promise.reject(new Error("settle failed"))
      return waitForRunToSettle(runId)
    })

    await expect(harness.service.stop()).resolves.toBeUndefined()
    await Promise.allSettled([firstRun, secondRun])

    expect(stopRunSpy).toHaveBeenCalledWith(failedRun!.id)
    expect(stopRunSpy).toHaveBeenCalledWith(otherRun!.id)
    expect(harness.service.schedulerRuntimeInspect().runningTaskIds).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith("Scheduled active run stop failed.", expect.objectContaining({
      runId: failedRun!.id,
      boundary: "task-scheduler-stop-active-runs",
      errorName: "Error",
      errorLength: "settle failed".length,
    }))

    await harness.service.schedulerTaskDisable("task:1")
    await harness.service.schedulerTaskEnable("task:1")
    expect(harness.service.schedulerRuntimeInspect().timers).toEqual([])
  })

  it("skips scheduled run when current day is not in activeDays", async () => {
    // 2026-04-29 is a Wednesday (day 3). activeDays excludes Wednesday.
    const harness = createHarness()
    await harness.taskItems.upsert(createTask({
      id: "task:1",
      activeDays: [1, 2, 4, 5], // Mon, Tue, Thu, Fri — no Wednesday
    }))

    await harness.service.start()
    const result = await harness.service.triggerForTest("task:1", "schedule")
    expect(result!.status).toBe("skipped")
    expect(result!.error).toBe("day not in activeDays")
    await harness.service.stop()
  })

  it("logs missed-run background failures with sanitized task context", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ logger })
    await harness.taskItems.upsert(createTask({
      id: "task:1",
      missedRunPolicy: "run_once",
      nextRunAt: "2026-04-29T09:59:00.000Z",
    }))
    harness.tasks.get = async () => {
      throw new Error("background failed")
    }

    await harness.service.start()
    await waitFor(() => logger.warn.mock.calls.length > 0)

    expect(logger.warn).toHaveBeenCalledWith("Scheduled task background run failed.", {
      taskId: "task:1",
      triggeredBy: "missed_run",
      boundary: "task-scheduler-background-run",
      errorName: "Error",
      errorLength: "background failed".length,
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("background failed")
  })

  it("persists disabled state when listing invalid stored tasks", async () => {
    const emit = vi.fn()
    const eventBus: Pick<EventBus, "emit"> = { emit: emit as unknown as EventBus["emit"] }
    const harness = createHarness({ eventBus })
    await harness.taskItems.upsert(createTask({
      id: "task:1",
      enabled: true,
      action: { type: "builtin.test", config: {} },
    }))

    const [task] = await harness.service.schedulerTaskList()

    expect(task).toEqual(expect.objectContaining({
      id: "task:1",
      enabled: false,
      validation: {
        status: "needs_update",
        issues: [{ field: "action.config", message: "检查执行内容" }],
      },
    }))
    expect(await harness.taskItems.get("task:1")).toEqual(expect.objectContaining({
      enabled: false,
      action: { type: "builtin.test", config: {} },
    }))
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "scheduler",
        type: "scheduler.taskChanged",
        payload: { taskId: "task:1", reason: "disabled" },
      }),
      { backpressure: "coalesce" },
    )

    await harness.service.start()
    expect(harness.service.schedulerRuntimeInspect().timers).not.toContain("task:1")
  })

  it("persists disabled state when getting an invalid stored task", async () => {
    const harness = createHarness()
    await harness.taskItems.upsert(createTask({
      id: "task:1",
      enabled: true,
      action: { type: "builtin.test", config: {} },
    }))

    const task = await harness.service.schedulerTaskGet("task:1")

    expect(task).toEqual(expect.objectContaining({
      id: "task:1",
      enabled: false,
      validation: {
        status: "needs_update",
        issues: [{ field: "action.config", message: "检查执行内容" }],
      },
    }))
    expect(await harness.taskItems.get("task:1")).toEqual(expect.objectContaining({ enabled: false }))
  })

  it("blocks manual runs for invalid stored tasks", async () => {
    const harness = createHarness()
    await harness.taskItems.upsert(createTask({
      id: "task:1",
      action: { type: "builtin.test", config: {} },
    }))

    await expect(harness.service.runNow("task:1")).rejects.toThrow("任务配置需要更新")
    expect(await harness.runs.listByTask("task:1")).toEqual([])
  })

  it("records scheduled invalid tasks as skipped", async () => {
    const harness = createHarness()
    await harness.taskItems.upsert(createTask({
      id: "task:1",
      action: { type: "builtin.test", config: {} },
    }))

    const result = await harness.service.triggerForTest("task:1", "schedule")

    expect(result).toEqual(expect.objectContaining({
      status: "skipped",
      error: "任务配置需要更新",
    }))
  })

  it("logs skipped run markRunResult failures without hiding the skipped run", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ logger })
    await harness.taskItems.upsert(createTask({
      id: "task:1",
      action: { type: "builtin.test", config: {} },
    }))
    harness.tasks.markRunResult = vi.fn(async () => {
      throw new Error("task status write failed secret=hidden")
    })

    const result = await harness.service.triggerForTest("task:1", "schedule")

    expect(result).toEqual(expect.objectContaining({
      status: "skipped",
      error: "任务配置需要更新",
    }))
    expect(logger.warn).toHaveBeenCalledWith("markRunResult failed after skipped task run.", {
      source: "task-scheduler",
      taskId: "task:1",
      runId: result?.id,
      triggeredBy: "schedule",
      status: "skipped",
      boundary: "task-scheduler-mark-run-result",
      errorName: "Error",
      errorLength: "task status write failed secret=hidden".length,
    })
    expect(logger.info).toHaveBeenCalledWith("Scheduled task run skipped.", {
      taskId: "task:1",
      runId: result?.id,
      triggeredBy: "schedule",
      status: "skipped",
      boundary: "task-scheduler-skip-run",
      reason: "任务配置需要更新",
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret=hidden")
  })

  it("rejects enabling invalid stored tasks", async () => {
    const harness = createHarness()
    await harness.taskItems.upsert(createTask({
      id: "task:1",
      enabled: false,
      action: { type: "builtin.test", config: {} },
    }))

    await expect(harness.service.schedulerTaskEnable("task:1")).rejects.toThrow("任务配置需要更新")
    expect(await harness.taskItems.get("task:1")).toEqual(expect.objectContaining({ enabled: false }))
  })

  it("rejects creating tasks with unknown actions", async () => {
    const harness = createHarness()

    await expect(harness.service.schedulerTaskCreate({
      name: "Imported task",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
      action: { type: "builtin.missing", config: {} },
    })).rejects.toThrow(/not registered/)
    expect(await harness.tasks.list()).toEqual([])
  })

  it("rejects creating and updating tasks with invalid action config", async () => {
    const harness = createHarness()

    await expect(harness.service.schedulerTaskCreate({
      name: "Imported task",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
      action: { type: "builtin.test", config: {} },
    })).rejects.toThrow()
    expect(await harness.tasks.list()).toEqual([])

    await harness.taskItems.upsert(createTask({ id: "task:1" }))
    await expect(harness.service.schedulerTaskUpdate("task:1", {
      action: { type: "builtin.test", config: {} },
    })).rejects.toThrow()
    expect(await harness.tasks.get("task:1")).toEqual(expect.objectContaining({
      action: { type: "builtin.test", config: { message: "ok" } },
    }))
  })

  it("marks tasks with unknown actions as needing update", async () => {
    const harness = createHarness()
    await harness.taskItems.upsert(createTask({
      id: "task:1",
      action: { type: "builtin.removed", config: {} },
    }))

    await expect(harness.service.schedulerTaskList()).resolves.toEqual([
      expect.objectContaining({
        id: "task:1",
        enabled: false,
        validation: {
          status: "needs_update",
          issues: [{ field: "action.type", message: "选择执行动作" }],
        },
      }),
    ])
  })
})

function createHarness(options: {
  readonly action?: MainActionDefinition
  readonly eventBus?: Pick<EventBus, "emit">
  readonly permissionGuard?: PermissionGuard
  readonly logger?: StructuredLogger
} = {}) {
  const taskItems = new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks")
  const runItems = new MemoryNamespace<ScheduledTaskRunEntry>("task-scheduler.runs")
  const tasks = new ScheduledTaskRepository({
    tasks: taskItems,
    now: () => new Date("2026-04-29T10:00:00.000Z"),
    idFactory: () => "task:1",
  })
  const runs = new ScheduledTaskRunRepository({
    runs: runItems,
    now: () => new Date("2026-04-29T10:00:00.000Z"),
    idFactory: (taskId, index) => `run:${taskId}:${index}`,
  })
  const actions = new MainActionRegistry()
  actions.register(options.action ?? successAction())
  const execution = new TaskSchedulerExecutionService({
    tasks,
    runs,
    actions,
    permissionGuard: options.permissionGuard ?? permissionGuard({ allowed: true }),
    auditSink: auditSink(),
    defaultCwd: "/tmp",
  })
  const serviceDeps = {
    tasks,
    runs,
    actions,
    execution,
    defaultCwd: "/tmp",
    now: () => new Date("2026-04-29T10:00:00.000Z"),
    eventBus: options.eventBus,
    logger: options.logger,
  }
  return {
    service: new TaskSchedulerService(serviceDeps),
    execution,
    taskItems,
    runItems,
    tasks,
    runs,
  }
}

function successAction(): MainActionDefinition<TestActionConfig> {
  return {
    manifest: {
      id: "builtin.test",
      title: "Test",
      permissions: ["shell.exec"],
      defaultConfig: { message: "ok" },
      configFields: [
        { name: "message", kind: "string", required: true, defaultValue: "ok" },
      ],
      configSchema: testActionSchema,
    },
    buildPermissionRequest: ({ config, context }) => ({
      action: "shell.exec",
      actor: context.actor,
      resource: config.message,
      context: { taskId: context.taskId, runId: context.runId },
    }),
    execute: async () => ({
      status: "success",
      summary: "ok",
    }),
  }
}

function longRunningAction(): MainActionDefinition<TestActionConfig> {
  return {
    ...successAction(),
    execute: (input: ActionExecutionInput<TestActionConfig>) =>
      new Promise((resolve) => {
        input.context.abortSignal.addEventListener("abort", () => {
          resolve({ status: "cancelled", error: "shell command cancelled" })
        }, { once: true })
      }),
  }
}

function createTask(overrides: Partial<ScheduledTaskEntry> = {}): ScheduledTaskEntry {
  return {
    id: "task:1",
    schemaVersion: 2,
    name: "Build",
    scope: { type: "global" },
    trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
    action: { type: "builtin.test", config: { message: "ok" } },
    enabled: true,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-04-29T10:00:00.000Z",
    updatedAt: "2026-04-29T10:00:00.000Z",
    runCount: 0,
    configVersion: 0,
    ...overrides,
  }
}

function permissionGuard(result: Awaited<ReturnType<PermissionGuard["check"]>>): PermissionGuard {
  return {
    registerPolicy: () => () => {},
    check: async () => result,
  }
}

function auditSink(): AuditSink {
  return {
    record: () => {},
    list: () => [],
    clearForTests: () => {},
  }
}

function structuredLogger(): StructuredLogger & { warn: ReturnType<typeof vi.fn> } {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return logger
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error("condition was not met")
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  private readonly items = new Map<string, T>()

  constructor(readonly name: string) {}

  async getSingleton(): Promise<T | null> {
    return this.items.values().next().value ?? null
  }

  async setSingleton(value: T): Promise<void> {
    this.items.set(value.id, value)
  }

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.items.values()]
    if (!filter) return values
    return values.filter((item) =>
      Object.entries(filter).every(([key, value]) => item[key as keyof T] === value))
  }

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    this.items.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id)
  }

  onChange(_listener: DataChangeListener<T>): () => void {
    return () => {}
  }
}
