import { describe, expect, it } from "vitest"

import type { DataChangeListener, DataNamespace, ScheduledTaskEntryV1 } from "../../../runtime/data-repo"
import { ScheduledTaskRepository } from "../task-repository"

describe("ScheduledTaskRepository", () => {
  it("creates shell tasks with defaults", async () => {
    const repo = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntryV1>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00"),
      idFactory: () => "task:1",
    })

    const task = await repo.create({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "cron", expr: "0 2 * * *" },
      action: { type: "shell_command", mode: "command", content: "pnpm build" },
    })

    expect(task.enabled).toBe(true)
    expect(task.missedRunPolicy).toBe("skip")
    expect(task.overlapPolicy).toBe("skip")
    expect(task.action.timeoutMins).toBe(30)
    expect(task.nextRunAt).toBe(new Date("2026-04-29T02:00:00").toISOString())
  })

  it("rejects invalid triggers and empty actions", async () => {
    const repo = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntryV1>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: () => "task:1",
    })

    await expect(repo.create({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "cron", expr: "bad" },
      action: { type: "shell_command", mode: "command", content: "pnpm build" },
    })).rejects.toThrow(/cron/)
    await expect(repo.create({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "interval", everyMinutes: 0 },
      action: { type: "shell_command", mode: "command", content: "pnpm build" },
    })).rejects.toThrow(/everyMinutes/)
    await expect(repo.create({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "interval", everyMinutes: 5 },
      action: { type: "shell_command", mode: "command", content: " " },
    })).rejects.toThrow(/action content/)
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
