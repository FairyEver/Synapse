import { describe, expect, it } from "vitest"

import type {
  DataChangeListener,
  DataNamespace,
  ScheduledTaskEntryV1,
  ScheduledTaskRunEntryV1,
} from "../../../runtime/data-repo"
import type { PermissionGuard } from "../../../runtime/security"
import { TaskActionRegistry } from "../action-registry"
import { TaskSchedulerExecutionService } from "../execution-service"
import { ScheduledTaskRunRepository } from "../run-repository"
import { ScheduledTaskRepository } from "../task-repository"
import { TaskSchedulerService } from "../task-scheduler-service"
import type { ScheduledTaskCreateInput, TaskActionExecutor, TaskActionExecutionInput } from "../types"

describe("TaskSchedulerService", () => {
  it("schedules enabled tasks on start", async () => {
    const harness = createHarness()
    await harness.taskItems.upsert(createTask({ id: "task:1", nextRunAt: "2026-04-29T10:01:00.000Z" }))

    await harness.service.start()

    expect(harness.service.inspect().timers).toContain("task:1")
    harness.service.stop()
  })

  it("skips overlapping scheduled runs", async () => {
    const harness = createHarness({ executor: longRunningExecutor() })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))

    const runPromise = harness.service.runNow("task:1")
    await waitFor(async () => harness.service.inspect().runningTaskIds.includes("task:1"))
    await harness.service.triggerForTest("task:1", "schedule")

    expect(await harness.runs.listByTask("task:1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "skipped", error: "task is already running" }),
    ]))
    const running = (await harness.runs.listByTask("task:1")).find((run) => run.status === "running")
    expect(running).toBeDefined()
    await harness.service.stopRun(running!.id)
    await runPromise
  })

  it("stops running task by run id", async () => {
    const harness = createHarness({ executor: longRunningExecutor() })
    await harness.taskItems.upsert(createTask({ id: "task:1" }))

    const runPromise = harness.service.runNow("task:1")
    await waitFor(async () => (await harness.runs.listByTask("task:1")).some((run) => run.status === "running"))
    const running = (await harness.runs.listByTask("task:1")).find((run) => run.status === "running")
    expect(running).toBeDefined()

    await harness.service.stopRun(running!.id)
    await runPromise

    expect(await harness.runs.get(running!.id)).toEqual(expect.objectContaining({ status: "cancelled" }))
  })

  it("denies shell task creation when permission check fails", async () => {
    const harness = createHarness({
      permissionGuard: permissionGuard({ allowed: false, reason: "denied by test" }),
    })

    await expect(harness.service.createTask(createTaskInput())).rejects.toThrow(/denied by test/)
  })
})

function createHarness(options: {
  readonly executor?: TaskActionExecutor
  readonly permissionGuard?: PermissionGuard
} = {}) {
  const taskItems = new MemoryNamespace<ScheduledTaskEntryV1>("task-scheduler.tasks")
  const runItems = new MemoryNamespace<ScheduledTaskRunEntryV1>("task-scheduler.runs")
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
  const actions = new TaskActionRegistry()
  actions.register(options.executor ?? {
    type: "shell_command",
    execute: async () => ({
      status: "success",
      process: {
        exitCode: 0,
        signal: null,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        durationMs: 1,
      },
    }),
  } satisfies TaskActionExecutor)
  const execution = new TaskSchedulerExecutionService({
    tasks,
    runs,
    actions,
    defaultCwd: "/tmp",
  })
  return {
    service: new TaskSchedulerService({
      tasks,
      runs,
      execution,
      permissionGuard: options.permissionGuard ?? permissionGuard({ allowed: true }),
      defaultCwd: "/tmp",
      now: () => new Date("2026-04-29T10:00:00.000Z"),
    }),
    taskItems,
    runs,
  }
}

function longRunningExecutor(): TaskActionExecutor {
  return {
    type: "shell_command",
    execute: (input: TaskActionExecutionInput) =>
      new Promise((resolve) => {
        input.abortSignal.addEventListener("abort", () => {
          resolve({ status: "cancelled", error: "shell command cancelled" })
        }, { once: true })
      }),
  }
}

function createTaskInput(): ScheduledTaskCreateInput {
  return {
    name: "Build",
    scope: { type: "global" },
    trigger: { type: "interval", everyMinutes: 10 },
    action: { type: "shell_command", mode: "command", content: "echo ok" },
  }
}

function createTask(overrides: Partial<ScheduledTaskEntryV1> = {}): ScheduledTaskEntryV1 {
  return {
    id: "task:1",
    schemaVersion: 1,
    name: "Build",
    scope: { type: "global" },
    trigger: { type: "interval", everyMinutes: 10 },
    action: { type: "shell_command", mode: "command", content: "echo ok", timeoutMins: 30 },
    enabled: true,
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-04-29T10:00:00.000Z",
    updatedAt: "2026-04-29T10:00:00.000Z",
    runCount: 0,
    ...overrides,
  }
}

function permissionGuard(result: Awaited<ReturnType<PermissionGuard["check"]>>): PermissionGuard {
  return {
    registerPolicy: () => () => {},
    check: async () => result,
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error("condition was not met")
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
