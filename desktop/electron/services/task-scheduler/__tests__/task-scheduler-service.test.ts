import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

import {
  MainActionRegistry,
  type ActionExecutionInput,
  type MainActionDefinition,
} from "../../../action-runtime/action-registry"
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
    harness.service.stop()
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
        activeRun: { status: "running" },
      }),
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

  it("logs missed-run background failures with sanitized task context", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ logger })
    await harness.taskItems.upsert(createTask({
      id: "task:1",
      missedRunPolicy: "run_once",
      nextRunAt: "2026-04-29T09:59:00.000Z",
    }))
    harness.tasks.markScheduled = async () => {
      throw new Error("mark schedule failed")
    }

    await harness.service.start()
    await waitFor(() => logger.warn.mock.calls.length > 0)

    expect(logger.warn).toHaveBeenCalledWith("Scheduled task background run failed.", {
      taskId: "task:1",
      triggeredBy: "missed_run",
      boundary: "task-scheduler-background-run",
      errorName: "Error",
      errorLength: "mark schedule failed".length,
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("mark schedule failed")
  })
})

function createHarness(options: {
  readonly action?: MainActionDefinition
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
    execution,
    defaultCwd: "/tmp",
    now: () => new Date("2026-04-29T10:00:00.000Z"),
    logger: options.logger,
  }
  return {
    service: new TaskSchedulerService(serviceDeps),
    taskItems,
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
