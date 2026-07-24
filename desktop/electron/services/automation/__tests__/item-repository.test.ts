import { describe, expect, it } from "vitest"
import { z } from "zod"

import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import { createBuiltinAutomationTriggerRegistry } from "../builtin-triggers"
import { AutomationItemRepository } from "../item-repository"
import type { AutomationItem } from "../types"
import { javascriptRunActionManifest } from "../../../../app-capabilities/javascript-run/automation-action/manifest"
import { nodejsRunActionManifest } from "../../../../app-capabilities/nodejs-run/automation-action/manifest"
import type { ActionManifest } from "../../../../action-packages/types"

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

  it("persists builtin cron next run on the next active day", async () => {
    const repo = new AutomationItemRepository({
      items: new MemoryNamespace<AutomationItem>("automation.items"),
      triggers: createBuiltinAutomationTriggerRegistry(),
      now: () => new Date("2026-06-02T10:00:00.000Z"),
      idFactory: () => "automation:1",
    })

    const item = await repo.create({
      name: "Weekday Cron",
      scope: { type: "global" },
      trigger: {
        type: "builtin.cron",
        config: { expr: "0 9 * * *", timezone: "UTC", activeDays: [1] },
      },
      executor: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
    })

    expect(item.nextRunAt).toBe("2026-06-08T09:00:00.000Z")
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

  it("creates script automations disabled and disables them after execution changes", async () => {
    const repo = newRepo()
    const item = await repo.create({
      ...validCreateInput(),
      enabled: true,
      executor: {
        type: "builtin.javascript-run",
        config: {
          source: "postMessage(null)",
          inputs: [],
          timeoutSeconds: 60,
          saveRunContent: true,
        },
      },
    })
    expect(item.enabled).toBe(false)

    const enabled = await repo.setEnabled(item.id, true)
    expect(enabled.enabled).toBe(true)
    const contentOnly = await repo.update(item.id, {
      executor: {
        ...enabled.executor,
        config: { ...enabled.executor.config, saveRunContent: false },
      },
    })
    expect(contentOnly.enabled).toBe(true)

    const changed = await repo.update(item.id, {
      executor: {
        ...contentOnly.executor,
        config: { ...contentOnly.executor.config, source: "postMessage({ changed: true })" },
      },
    })
    expect(changed.enabled).toBe(false)
    expect(changed.nextRunAt).toBeUndefined()
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

  it("keeps user edit time unchanged when persisting schedule and run metadata", async () => {
    const clock = { now: new Date("2026-06-03T00:00:00.000Z") }
    const repo = new AutomationItemRepository({
      items: new MemoryNamespace<AutomationItem>("automation.items"),
      triggers: createBuiltinAutomationTriggerRegistry(),
      now: () => clock.now,
      idFactory: () => "automation:1",
    })
    const item = await repo.create(validCreateInput())

    clock.now = new Date("2026-06-03T00:10:00.000Z")
    const scheduled = await repo.markScheduled(item.id, "2026-06-03T09:00:00.000Z")
    clock.now = new Date("2026-06-03T00:20:00.000Z")
    const result = await repo.markRunResult(item.id, { status: "success" })

    expect(scheduled?.updatedAt).toBe(item.updatedAt)
    expect(result?.updatedAt).toBe(item.updatedAt)
    expect(result?.lastRunAt).toBe("2026-06-03T00:20:00.000Z")
  })

  it("does not let delayed scheduling overwrite a newer run result", async () => {
    const namespace = new ControlledMemoryNamespace<AutomationItem>("automation.items")
    const repo = new AutomationItemRepository({
      items: namespace,
      triggers: createBuiltinAutomationTriggerRegistry(),
      now: () => new Date("2026-06-03T00:00:00.000Z"),
      idFactory: () => "automation:1",
    })
    const item = await repo.create(validCreateInput())
    await repo.markRunResult(item.id, { status: "failed" })

    const deferred = namespace.deferNextUpsert()
    const scheduledPromise = repo.markScheduled(item.id, "2026-06-03T01:00:00.000Z")
    await deferred.started

    const resultPromise = repo.markRunResult(item.id, { status: "success" })
    await Promise.resolve()
    deferred.release()
    await Promise.all([scheduledPromise, resultPromise])

    await expect(namespace.get(item.id)).resolves.toEqual(expect.objectContaining({
      lastStatus: "success",
      nextRunAt: "2026-06-03T01:00:00.000Z",
      runCount: 2,
    }))
  })

  it("does not let delayed disable overwrite a newer run result", async () => {
    const namespace = new ControlledMemoryNamespace<AutomationItem>("automation.items")
    const repo = new AutomationItemRepository({
      items: namespace,
      triggers: createBuiltinAutomationTriggerRegistry(),
      now: () => new Date("2026-06-03T00:00:00.000Z"),
      idFactory: () => "automation:1",
    })
    const item = await repo.create(validCreateInput())
    await repo.markRunResult(item.id, { status: "failed" })

    const deferred = namespace.deferNextUpsert()
    const disablePromise = repo.setEnabled(item.id, false)
    await deferred.started

    const resultPromise = repo.markRunResult(item.id, { status: "success" })
    await Promise.resolve()
    deferred.release()
    await Promise.all([disablePromise, resultPromise])

    await expect(namespace.get(item.id)).resolves.toEqual(expect.objectContaining({
      enabled: false,
      lastStatus: "success",
      nextRunAt: undefined,
      runCount: 2,
    }))
  })

  it("recomputes next run after completion using trigger reschedule policy", async () => {
    const registry = createBuiltinAutomationTriggerRegistry()
    registry.register({
      manifest: {
        id: "builtin.fake-after-completion",
        title: "Fake After Completion",
        kind: "schedule",
        defaultConfig: { value: "ok" },
        configSchema: z.object({ value: z.string() }),
      },
      summarize: () => "Fake After Completion",
      runtime: {
        computeNextRunAt: () => new Date("2026-06-03T00:15:00.000Z"),
        getReschedulePolicy: () => ({ mode: "after_completion" }),
      },
    })
    const repo = new AutomationItemRepository({
      items: new MemoryNamespace<AutomationItem>("automation.items"),
      triggers: registry,
      now: () => new Date("2026-06-03T00:00:00.000Z"),
      idFactory: () => "automation:1",
    })
    const item = await repo.create({
      name: "Fake",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-after-completion", config: { value: "ok" } },
      executor: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
    })

    const result = await repo.markRunResult(item.id, { status: "success" })

    expect(result?.nextRunAt).toBe("2026-06-03T00:15:00.000Z")
  })
})

function newRepo(): AutomationItemRepository {
  const manifests = new Map<string, ActionManifest>([
    [javascriptRunActionManifest.id, javascriptRunActionManifest as unknown as ActionManifest],
    [nodejsRunActionManifest.id, nodejsRunActionManifest as unknown as ActionManifest],
  ])
  return new AutomationItemRepository({
    items: new MemoryNamespace<AutomationItem>("automation.items"),
    triggers: createBuiltinAutomationTriggerRegistry(),
    now: () => new Date("2026-06-03T00:00:00.000Z"),
    idFactory: () => "automation:1",
    resolveActionManifest: (type) => manifests.get(type),
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

class ControlledMemoryNamespace<T extends { id: string }> extends MemoryNamespace<T> {
  private deferredUpsert: Deferred<void> | null = null
  private deferredStarted: (() => void) | null = null

  deferNextUpsert(): { readonly started: Promise<void>; readonly release: () => void } {
    const deferred = new Deferred<void>()
    const started = new Promise<void>((resolve) => {
      this.deferredStarted = resolve
    })
    this.deferredUpsert = deferred
    return {
      started,
      release: () => deferred.resolve(),
    }
  }

  override async upsert(item: T): Promise<void> {
    const deferred = this.deferredUpsert
    if (deferred) {
      this.deferredUpsert = null
      this.deferredStarted?.()
      this.deferredStarted = null
      await deferred.promise
    }
    await super.upsert(item)
  }
}

class Deferred<T> {
  readonly promise: Promise<T>
  private resolvePromise: ((value: T) => void) | null = null

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolvePromise = resolve
    })
  }

  resolve(value: T): void {
    this.resolvePromise?.(value)
  }
}
