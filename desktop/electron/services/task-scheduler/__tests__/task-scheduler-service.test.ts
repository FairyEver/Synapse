import { z } from "zod"
import { describe, expect, it } from "vitest"

import {
  MainActionRegistry,
  type ActionExecutionInput,
  type MainActionDefinition,
} from "../../../action-runtime/action-registry"
import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
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

    expect(harness.service.inspect().timers).toContain("task:1")
    harness.service.stop()
  })

  it("skips overlapping scheduled runs", async () => {
    const harness = createHarness({ action: longRunningAction() })
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
})

function createHarness(options: {
  readonly action?: MainActionDefinition
  readonly permissionGuard?: PermissionGuard
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
  return {
    service: new TaskSchedulerService({
      tasks,
      runs,
      execution,
      defaultCwd: "/tmp",
      now: () => new Date("2026-04-29T10:00:00.000Z"),
    }),
    taskItems,
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

function auditSink(): AuditSink {
  return {
    record: () => {},
    list: () => [],
    clearForTests: () => {},
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
