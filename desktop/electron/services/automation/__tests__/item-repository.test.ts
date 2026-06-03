import { describe, expect, it } from "vitest"

import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import { createBuiltinAutomationTriggerRegistry } from "../builtin-triggers"
import { AutomationItemRepository } from "../item-repository"
import type { AutomationItem } from "../types"

describe("AutomationItemRepository", () => {
  it("creates automation items with defaults", async () => {
    const repo = new AutomationItemRepository({
      items: new MemoryNamespace<AutomationItem>("automation.items"),
      triggers: createBuiltinAutomationTriggerRegistry(),
      now: () => new Date("2026-06-03T00:00:00.000Z"),
      idFactory: () => "automation:1",
    })

    const item = await repo.create({
      name: "Daily",
      scope: { type: "global" },
      trigger: {
        type: "builtin.cron",
        config: { expr: "0 9 * * *", activeDays: [0, 1, 2, 3, 4, 5, 6] },
      },
      executor: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
    })

    expect(item).toEqual(expect.objectContaining({
      id: "automation:1",
      schemaVersion: 1,
      enabled: true,
      policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
      runCount: 0,
      configVersion: 0,
    }))
    expect(item.nextRunAt).toBeDefined()
  })

  it("increments configVersion on update but not enable toggles", async () => {
    const repo = newRepo()
    const item = await repo.create(validCreateInput())

    const updated = await repo.update(item.id, { name: "Renamed" })
    expect(updated.configVersion).toBe(1)

    const disabled = await repo.setEnabled(item.id, false)
    expect(disabled.enabled).toBe(false)
    expect(disabled.nextRunAt).toBeUndefined()
    expect(disabled.configVersion).toBe(1)

    const enabled = await repo.setEnabled(item.id, true)
    expect(enabled.enabled).toBe(true)
    expect(enabled.nextRunAt).toBeDefined()
    expect(enabled.configVersion).toBe(1)
  })

  it("marks scheduled and run result", async () => {
    const repo = newRepo()
    const item = await repo.create(validCreateInput())

    const scheduled = await repo.markScheduled(item.id, "2026-06-03T09:00:00.000Z")
    expect(scheduled?.nextRunAt).toBe("2026-06-03T09:00:00.000Z")

    const result = await repo.markRunResult(item.id, { status: "success" })
    expect(result?.lastStatus).toBe("success")
    expect(result?.runCount).toBe(1)
  })
})

function newRepo(): AutomationItemRepository {
  return new AutomationItemRepository({
    items: new MemoryNamespace<AutomationItem>("automation.items"),
    triggers: createBuiltinAutomationTriggerRegistry(),
    now: () => new Date("2026-06-03T00:00:00.000Z"),
    idFactory: () => "automation:1",
  })
}

function validCreateInput() {
  return {
    name: "Daily",
    scope: { type: "global" as const },
    trigger: {
      type: "builtin.interval",
      config: { everyMinutes: 30, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
    },
    executor: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
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
