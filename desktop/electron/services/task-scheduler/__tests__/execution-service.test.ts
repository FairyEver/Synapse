import { z } from "zod"
import { describe, expect, it } from "vitest"

import { MainActionRegistry, type MainActionDefinition } from "../../../action-runtime/action-registry"
import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { TaskSchedulerExecutionService } from "../execution-service"
import { ScheduledTaskRunRepository } from "../run-repository"
import { ScheduledTaskRepository } from "../task-repository"
import type {
  ScheduledTaskEntry,
  ScheduledTaskRunEntry,
} from "../types"

const testActionSchema = z.object({ message: z.string().min(1) })
type TestActionConfig = z.infer<typeof testActionSchema>

describe("TaskSchedulerExecutionService", () => {
  it("records action output and updates task run metadata", async () => {
    const harness = await createExecutionHarness()

    const run = await harness.service.runTask(harness.task, "manual")

    expect(run.status).toBe("success")
    expect(run.result).toEqual({
      status: "success",
      summary: "ok",
      outputs: { stdout: "ok" },
    })
    expect(await harness.tasks.get("task:1")).toEqual(expect.objectContaining({
      runCount: 1,
      lastStatus: "success",
    }))
    expect(harness.auditEvents).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        outcome: "allowed",
      }),
    ])
  })

  it("records failed run when action permission is denied", async () => {
    const harness = await createExecutionHarness({
      permissionGuard: permissionGuard({ allowed: false, reason: "denied by test" }),
    })

    const run = await harness.service.runTask(harness.task, "manual")

    expect(run.status).toBe("failed")
    expect(run.error).toBe("denied by test")
    expect(run.result).toEqual({
      status: "failed",
      error: "denied by test",
      summary: "执行失败",
    })
    expect(harness.auditEvents).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        outcome: "denied",
      }),
    ])
  })
})

async function createExecutionHarness(options: {
  readonly permissionGuard?: PermissionGuard
} = {}) {
  const tasks = new ScheduledTaskRepository({
    tasks: new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks"),
    now: () => new Date("2026-04-29T00:00:00.000Z"),
    idFactory: () => "task:1",
  })
  const runs = new ScheduledTaskRunRepository({
    runs: new MemoryNamespace<ScheduledTaskRunEntry>("task-scheduler.runs"),
    now: () => new Date("2026-04-29T00:01:00.000Z"),
    idFactory: () => "run:1",
  })
  const task = await tasks.create({
    name: "Build",
    scope: { type: "global" },
    trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
    action: { type: "builtin.test", config: { message: "ok" } },
  })
  const actions = new MainActionRegistry()
  actions.register(testAction)
  const auditEvents: Parameters<AuditSink["record"]>[0][] = []
  const service = new TaskSchedulerExecutionService({
    tasks,
    runs,
    actions,
    permissionGuard: options.permissionGuard ?? permissionGuard({ allowed: true }),
    auditSink: {
      record: (event) => {
        auditEvents.push(event)
      },
      list: () => [],
      clearForTests: () => {},
    },
    defaultCwd: "/tmp",
  })
  return { service, task, tasks, runs, auditEvents }
}

const testAction: MainActionDefinition<TestActionConfig> = {
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
    outputs: { stdout: "ok" },
  }),
}

function permissionGuard(result: Awaited<ReturnType<PermissionGuard["check"]>>): PermissionGuard {
  return {
    registerPolicy: () => () => {},
    check: async () => result,
  }
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
