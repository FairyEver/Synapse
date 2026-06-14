import { describe, expect, it } from "vitest"

import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import { ScheduledTaskRunRepository } from "../run-repository"
import type { ScheduledTaskRunEntry } from "../types"

describe("ScheduledTaskRunRepository", () => {
  it("starts and finishes runs", async () => {
    const repo = new ScheduledTaskRunRepository({
      runs: new MemoryNamespace<ScheduledTaskRunEntry>("task-scheduler.runs"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: () => "run:1",
    })

    const run = await repo.start("task:1", "manual")
    expect(run.schemaVersion).toBe(2)
    expect(run.status).toBe("running")
    expect(run.triggeredBy).toBe("manual")

    const finished = await repo.finish("run:1", {
      status: "success",
      result: {
        status: "success",
        summary: "退出码 0",
        outputs: { stdout: "ok" },
      },
    })
    expect(finished.status).toBe("success")
    expect(finished.result).toEqual({
      status: "success",
      summary: "退出码 0",
      outputs: { stdout: "ok" },
    })
    expect(finished.finishedAt).toBe("2026-04-29T00:00:00.000Z")
  })

  it("keeps only the latest 100 runs for a task", async () => {
    let nextMinute = 0
    const repo = new ScheduledTaskRunRepository({
      runs: new MemoryNamespace<ScheduledTaskRunEntry>("task-scheduler.runs"),
      now: () => new Date(Date.UTC(2026, 3, 29, 0, nextMinute, 0)),
      idFactory: (taskId, index) => `run:${taskId}:${index}`,
    })

    for (let i = 0; i < 101; i += 1) {
      nextMinute = i
      await repo.start("task:1", "manual")
      await repo.finish(`run:task:1:${i + 1}`, {
        status: "success",
        result: {
          status: "success",
          summary: String(i),
        },
      })
    }

    expect(await repo.listByTask("task:1")).toHaveLength(100)
    expect(await repo.get("run:task:1:1")).toBeNull()
  })

  it("keeps the just-finished run when rapid runs share a timestamp", async () => {
    const repo = new ScheduledTaskRunRepository({
      runs: new MemoryNamespace<ScheduledTaskRunEntry>("task-scheduler.runs"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: (taskId, index) => `run:${taskId}:${index}`,
    })

    for (let i = 0; i < 101; i += 1) {
      await repo.start("task:1", "manual")
      await repo.finish(`run:task:1:${i + 1}`, {
        status: "success",
        result: {
          status: "success",
          summary: String(i),
        },
      })
    }

    expect(await repo.listByTask("task:1")).toHaveLength(100)
    expect(await repo.get("run:task:1:101")).toEqual(expect.objectContaining({
      id: "run:task:1:101",
      status: "success",
    }))
  })

  it("deletes all runs for a task without touching other task histories", async () => {
    const repo = new ScheduledTaskRunRepository({
      runs: new MemoryNamespace<ScheduledTaskRunEntry>("task-scheduler.runs"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: (taskId, index) => `run:${taskId}:${index}`,
    })
    await repo.start("task:1", "manual")
    await repo.finish("run:task:1:1", { status: "success", result: { status: "success", summary: "ok" } })
    await repo.start("task:1", "schedule")
    await repo.finish("run:task:1:2", { status: "failed", error: "failed" })
    await repo.start("task:2", "manual")

    await expect(repo.deleteByTask("task:1")).resolves.toBe(2)

    expect(await repo.listByTask("task:1")).toEqual([])
    expect(await repo.listByTask("task:2")).toHaveLength(1)
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
