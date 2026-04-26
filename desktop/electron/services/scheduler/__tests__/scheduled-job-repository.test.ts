import { describe, expect, it } from "vitest"

import type { DataChangeListener, DataNamespace, ScheduledJobEntryV1 } from "../../../runtime/data-repo"
import { ScheduledJobRepository } from "../scheduled-job-repository"

describe("ScheduledJobRepository", () => {
  it("creates prompt and exec jobs, validates mutual exclusion, and records runs", async () => {
    const repo = new ScheduledJobRepository({
      jobs: new MemoryNamespace<ScheduledJobEntryV1>("scheduled.jobs"),
      now: () => new Date("2026-04-26T00:00:00Z"),
      idFactory: () => "scheduled:1",
    })

    const prompt = await repo.create({
      projectId: "project-1",
      platform: "feishu",
      connectorId: "feishu:project-1",
      sessionKey: "feishu:oc_group:ou_user",
      kind: "prompt",
      cronExpr: "*/30 * * * *",
      prompt: "check",
      timeoutMins: 0,
    })

    expect(prompt.nextRunAt).toBe("2026-04-26T00:30:00.000Z")
    expect(prompt.timeoutMins).toBe(0)
    await expect(repo.create({
      projectId: "project-1",
      platform: "feishu",
      connectorId: "feishu:project-1",
      sessionKey: "feishu:oc_group:ou_user",
      kind: "prompt",
      cronExpr: "bad",
      prompt: "check",
    })).rejects.toThrow(/cron/)
    await expect(repo.create({
      projectId: "project-1",
      platform: "feishu",
      connectorId: "feishu:project-1",
      sessionKey: "feishu:oc_group:ou_user",
      kind: "prompt",
      cronExpr: "* * * * *",
      prompt: "check",
      exec: "echo nope",
    })).rejects.toThrow(/mutually exclusive/)

    const updated = await repo.update(prompt.id, { description: "daily check" })
    expect(updated.id).toBe(prompt.id)
    expect(updated.createdAt).toBe(prompt.createdAt)

    const marked = await repo.markRun(prompt.id, { status: "failed", error: "boom" })
    expect(marked?.runCount).toBe(1)
    expect(marked?.lastStatus).toBe("failed")
    expect(marked?.lastError).toBe("boom")
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
