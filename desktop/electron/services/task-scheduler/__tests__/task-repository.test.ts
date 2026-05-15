import { describe, expect, it } from "vitest"

import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import { ScheduledTaskRepository } from "../task-repository"
import type { ScheduledTaskEntry } from "../types"

describe("ScheduledTaskRepository", () => {
  it("creates shell tasks with defaults", async () => {
    const repo = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00"),
      idFactory: () => "task:1",
    })

    const task = await repo.create({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "builtin.cron", config: { expr: "0 2 * * *" } },
      action: {
        type: "builtin.command",
        config: {
          command: "pnpm build",
          shell: "posix",
          timeoutMins: 30,
        },
      },
    })

    expect(task.schemaVersion).toBe(2)
    expect(task.enabled).toBe(true)
    expect(task.missedRunPolicy).toBe("skip")
    expect(task.overlapPolicy).toBe("skip")
    expect(task.action).toEqual({
      type: "builtin.command",
      config: {
        command: "pnpm build",
        shell: "posix",
        timeoutMins: 30,
      },
    })
    expect(task.nextRunAt).toBe(new Date("2026-04-29T02:00:00").toISOString())
  })

  it("rejects invalid triggers and empty actions", async () => {
    const repo = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: () => "task:1",
    })

    await expect(repo.create({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "builtin.cron", config: { expr: "bad" } },
      action: { type: "builtin.command", config: { command: "pnpm build" } },
    })).rejects.toThrow(/cron/)
    await expect(repo.create({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 0 } },
      action: { type: "builtin.command", config: { command: "pnpm build" } },
    })).rejects.toThrow(/everyMinutes/)
    await expect(repo.create({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 5 } },
      action: { type: " ", config: {} },
    })).rejects.toThrow(/action type/)
  })

  it("validates interval updates before recomputing the next run time", async () => {
    const repo = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: () => "task:1",
    })
    const task = await repo.create({
      name: "Agent digest",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 5 } },
      action: { type: "builtin.agent", config: { prompt: "summarize" } },
    })

    await expect(repo.update(task.id, {
      trigger: { type: "builtin.interval", config: { everyMinutes: 0 } },
    })).rejects.toThrow(/everyMinutes/)
  })

  it("increments configVersion on update", async () => {
    const repo = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: () => "task:1",
    })
    const task = await repo.create({
      name: "Agent digest",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 5 } },
      action: { type: "builtin.agent", config: { prompt: "summarize" } },
    })

    expect(task.configVersion).toBe(0)

    const updated1 = await repo.update(task.id, { name: "Renamed" })
    expect(updated1.configVersion).toBe(1)

    const updated2 = await repo.update(task.id, {
      action: { type: "builtin.agent", config: { prompt: "changed" } },
    })
    expect(updated2.configVersion).toBe(2)
  })

  it("does not increment configVersion when toggling enabled", async () => {
    const repo = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: () => "task:1",
    })
    const task = await repo.create({
      name: "Agent digest",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 5 } },
      action: { type: "builtin.agent", config: { prompt: "summarize" } },
    })

    expect(task.configVersion).toBe(0)

    const disabled = await repo.setEnabled(task.id, false)
    expect(disabled.configVersion).toBe(0)
    expect(disabled.enabled).toBe(false)

    const enabled = await repo.setEnabled(task.id, true)
    expect(enabled.configVersion).toBe(0)
    expect(enabled.enabled).toBe(true)
  })

  it("creates tasks with configVersion 0", async () => {
    const repo = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: () => "task:1",
    })
    const task = await repo.create({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "builtin.cron", config: { expr: "0 2 * * *" } },
      action: { type: "builtin.command", config: { command: "echo hi" } },
    })

    expect(task.configVersion).toBe(0)
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
