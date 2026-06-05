import { describe, expect, it } from "vitest"

import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import { AutomationRunRepository } from "../run-repository"
import type { AutomationRun } from "../types"

describe("AutomationRunRepository", () => {
  it("starts, finishes, and lists automation runs", async () => {
    const repo = new AutomationRunRepository({
      runs: new MemoryNamespace<AutomationRun>("automation.runs"),
      now: () => new Date("2026-06-03T00:00:00.000Z"),
      idFactory: () => "automation-run:1",
    })

    const run = await repo.start("automation:1", "manual", {
      triggerType: "builtin.cron",
      executorType: "builtin.command",
    })
    const finished = await repo.finish(run.id, {
      status: "success",
      result: { status: "success", summary: "ok" },
    })

    expect(finished.status).toBe("success")
    expect(await repo.listByAutomation("automation:1")).toHaveLength(1)
  })

  it("keeps only the latest 100 runs per automation", async () => {
    let nextMinute = 0
    const repo = new AutomationRunRepository({
      runs: new MemoryNamespace<AutomationRun>("automation.runs"),
      now: () => new Date(Date.UTC(2026, 5, 3, 0, nextMinute, 0)),
      idFactory: (automationId, index) => `automation-run:${automationId}:${index}`,
    })

    for (let i = 0; i < 101; i += 1) {
      nextMinute = i
      await repo.start("automation:1", "manual", {
        triggerType: "builtin.cron",
        executorType: "builtin.command",
      })
      await repo.finish(`automation-run:automation:1:${i + 1}`, { status: "success" })
    }

    expect(await repo.listByAutomation("automation:1")).toHaveLength(100)
    expect(await repo.get("automation-run:automation:1:1")).toBeNull()
  })

  it("deletes all runs for one automation", async () => {
    const repo = new AutomationRunRepository({
      runs: new MemoryNamespace<AutomationRun>("automation.runs"),
      now: () => new Date("2026-06-03T00:00:00.000Z"),
      idFactory: (automationId, index) => `automation-run:${automationId}:${index}`,
    })

    await repo.start("automation:1", "manual", {
      triggerType: "builtin.cron",
      executorType: "builtin.command",
    })
    await repo.start("automation:1", "manual", {
      triggerType: "builtin.cron",
      executorType: "builtin.command",
    })
    await repo.start("automation:2", "manual", {
      triggerType: "builtin.cron",
      executorType: "builtin.command",
    })

    await expect(repo.deleteByAutomation("automation:1")).resolves.toBe(2)

    expect(await repo.listByAutomation("automation:1")).toEqual([])
    expect(await repo.listByAutomation("automation:2")).toHaveLength(1)
  })

  it("lists running runs across automations", async () => {
    let nextMinute = 0
    const repo = new AutomationRunRepository({
      runs: new MemoryNamespace<AutomationRun>("automation.runs"),
      now: () => new Date(Date.UTC(2026, 5, 3, 0, nextMinute, 0)),
      idFactory: (automationId, index) => `automation-run:${automationId}:${index}`,
    })

    nextMinute = 0
    await repo.start("automation:1", "manual", {
      triggerType: "builtin.cron",
      executorType: "builtin.command",
    })
    nextMinute = 1
    await repo.start("automation:2", "manual", {
      triggerType: "builtin.cron",
      executorType: "builtin.command",
    })
    nextMinute = 2
    const finished = await repo.start("automation:3", "manual", {
      triggerType: "builtin.cron",
      executorType: "builtin.command",
    })
    await repo.finish(finished.id, { status: "success" })

    expect(await repo.listRunning()).toEqual([
      expect.objectContaining({ id: "automation-run:automation:2:2" }),
      expect.objectContaining({ id: "automation-run:automation:1:1" }),
    ])
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
