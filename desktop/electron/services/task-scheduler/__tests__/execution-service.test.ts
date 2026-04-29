import { describe, expect, it } from "vitest"

import type {
  DataChangeListener,
  DataNamespace,
  ScheduledTaskEntryV1,
  ScheduledTaskRunEntryV1,
} from "../../../runtime/data-repo"
import { TaskActionRegistry } from "../action-registry"
import { TaskSchedulerExecutionService } from "../execution-service"
import { ScheduledTaskRunRepository } from "../run-repository"
import { ScheduledTaskRepository } from "../task-repository"
import type { TaskActionExecutor } from "../types"

describe("TaskSchedulerExecutionService", () => {
  it("records action output and updates task run metadata", async () => {
    const tasks = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntryV1>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: () => "task:1",
    })
    const runs = new ScheduledTaskRunRepository({
      runs: new MemoryNamespace<ScheduledTaskRunEntryV1>("task-scheduler.runs"),
      now: () => new Date("2026-04-29T00:01:00.000Z"),
      idFactory: () => "run:1",
    })
    const task = await tasks.create({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "interval", everyMinutes: 10 },
      action: { type: "shell_command", mode: "command", content: "echo ok" },
    })
    const actions = new TaskActionRegistry()
    actions.register({
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
    const service = new TaskSchedulerExecutionService({
      tasks,
      runs,
      actions,
      defaultCwd: "/tmp",
    })

    const run = await service.runTask(task, "manual")

    expect(run.status).toBe("success")
    expect(run.stdout).toBe("ok")
    expect(await tasks.get("task:1")).toEqual(expect.objectContaining({
      runCount: 1,
      lastStatus: "success",
    }))
  })
})

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
