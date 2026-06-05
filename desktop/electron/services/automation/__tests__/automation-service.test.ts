import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../log-store", () => ({
  createMainLogger: () => ({ warn: vi.fn() }),
}))

import {
  MainActionRegistry,
  type MainActionDefinition,
} from "../../../action-runtime/action-registry"
import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import type { EventBus } from "../../../runtime/event-bus"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import type { StructuredLogger } from "../../../runtime/service-registry"
import { AutomationService } from "../automation-service"
import { createBuiltinAutomationTriggerRegistry } from "../builtin-triggers"
import { AutomationExecutionService } from "../execution-service"
import { AutomationItemRepository } from "../item-repository"
import { AutomationRunRepository } from "../run-repository"
import type { AutomationTriggerRegistry } from "../trigger-registry"
import type { AutomationItem, AutomationRun } from "../types"

const testActionSchema = z.object({ message: z.string().min(1) })
type TestActionConfig = z.infer<typeof testActionSchema>

describe("AutomationService", () => {
  it("schedules enabled automations on start", async () => {
    const harness = createHarness()
    await harness.items.create(createAutomationInput())

    await harness.service.start()

    expect(harness.service.automationRuntimeInspect().timers).toContain("automation:1")
    await harness.service.stop()
  })

  it("runs an automation manually", async () => {
    const harness = createHarness()
    const item = await harness.service.automationCreate(createAutomationInput())

    const run = await harness.service.runNow(item.id)

    expect(run?.status).toBe("success")
    expect(await harness.runs.listByAutomation(item.id)).toEqual([
      expect.objectContaining({
        automationId: item.id,
        status: "success",
        triggeredBy: "manual",
      }),
    ])
  })

  it("reports already finished runs when stop finds a stored but inactive run", async () => {
    const harness = createHarness()
    const item = await harness.service.automationCreate(createAutomationInput())
    const run = await harness.service.runNow(item.id)

    expect(run?.status).toBe("success")

    await expect(harness.service.stopRun(run!.id)).resolves.toEqual({
      stopped: false,
      alreadyFinished: true,
    })
  })

  it("skips overlapping scheduled runs", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ action: longRunningAction(), logger })
    const item = await harness.service.automationCreate(createAutomationInput())

    const runPromise = harness.service.runNow(item.id)
    await waitFor(async () => harness.service.automationRuntimeInspect().runningItemIds.includes(item.id))
    const skipped = await harness.service.triggerForTest(item.id, "trigger")

    expect(skipped?.status).toBe("skipped")
    expect(skipped?.error).toBe("automation is already running")
    expect(logger.info).toHaveBeenCalledWith("Automation run skipped.", {
      automationId: item.id,
      runId: skipped?.id,
      triggeredBy: "trigger",
      status: "skipped",
      boundary: "automation-skip-run",
      reason: "automation is already running",
    })
    const running = (await harness.runs.listByAutomation(item.id)).find((run) => run.status === "running")
    expect(running).toBeDefined()
    await harness.service.stopRun(running!.id)
    await runPromise
  })

  it("marks listed automations that are currently running", async () => {
    const harness = createHarness({ action: longRunningAction() })
    const item = await harness.service.automationCreate(createAutomationInput())

    const runPromise = harness.service.runNow(item.id)
    await waitFor(async () => harness.service.automationRuntimeInspect().runningItemIds.includes(item.id))

    expect(await harness.service.automationList()).toEqual([
      expect.objectContaining({
        id: item.id,
        activeRun: expect.objectContaining({ status: "running" }),
      }),
    ])

    const running = (await harness.runs.listByAutomation(item.id)).find((run) => run.status === "running")
    expect(running).toBeDefined()
    await harness.service.stopRun(running!.id)
    await runPromise
  })

  it("emits automation change events when a run finishes", async () => {
    const emit = vi.fn()
    const eventBus: Pick<EventBus, "emit"> = { emit: emit as unknown as EventBus["emit"] }
    const harness = createHarness({ eventBus })
    const item = await harness.service.automationCreate(createAutomationInput())

    const run = await harness.service.triggerForTest(item.id, "trigger")

    expect(run?.status).toBe("success")
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "automation",
        type: "automation.itemChanged",
        payload: expect.objectContaining({
          automationId: item.id,
          runId: run?.id,
          reason: "run-finished",
        }),
      }),
      { backpressure: "coalesce" },
    )
  })

  it("keeps the successful run status after scheduling the next cron trigger", async () => {
    const harness = createHarness()
    const item = await harness.service.automationCreate(createCronAutomationInput())

    const run = await harness.service.triggerForTest(item.id, "trigger")
    const stored = await harness.items.get(item.id)

    expect(run?.status).toBe("success")
    expect(stored).toEqual(expect.objectContaining({
      lastStatus: "success",
      runCount: 1,
      nextRunAt: "2026-06-03T00:01:00.000Z",
    }))
    await harness.service.stop()
  })

  it("rejects deleting an automation while it has an active run", async () => {
    const harness = createHarness({ action: longRunningAction() })
    const item = await harness.service.automationCreate(createAutomationInput())

    const runPromise = harness.service.runNow(item.id)
    await waitFor(async () => harness.service.automationRuntimeInspect().runningItemIds.includes(item.id))

    await expect(harness.service.automationDelete(item.id)).rejects.toThrow(/running/i)

    const running = (await harness.runs.listByAutomation(item.id)).find((run) => run.status === "running")
    expect(running).toBeDefined()
    await harness.service.stopRun(running!.id)
    await runPromise
  })

  it("deletes stored run history when deleting an automation", async () => {
    const harness = createHarness()
    const item = await harness.service.automationCreate(createAutomationInput())
    await harness.service.runNow(item.id)

    await expect(harness.service.automationDelete(item.id)).resolves.toEqual({ deleted: true })

    expect(await harness.items.get(item.id)).toBeNull()
    expect(await harness.runs.listByAutomation(item.id)).toEqual([])
  })

  it("recovers interrupted running runs on start", async () => {
    const emit = vi.fn()
    const eventBus: Pick<EventBus, "emit"> = { emit: emit as unknown as EventBus["emit"] }
    const logger = structuredLogger()
    const harness = createHarness({ eventBus, logger })
    const item = await harness.service.automationCreate(createAutomationInput())
    const interrupted = await harness.runs.start(item.id, "manual", {
      triggerType: item.trigger.type,
      executorType: item.executor.type,
    })

    await harness.service.start()

    await expect(harness.runs.get(interrupted.id)).resolves.toEqual(expect.objectContaining({
      status: "failed",
      error: "应用异常退出，运行已在启动恢复时标记为失败。",
      result: expect.objectContaining({
        status: "failed",
        summary: "应用异常退出",
      }),
    }))
    await expect(harness.items.get(item.id)).resolves.toEqual(expect.objectContaining({
      lastStatus: "failed",
      runCount: 1,
    }))
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "automation",
        type: "automation.itemChanged",
        payload: expect.objectContaining({
          automationId: item.id,
          runId: interrupted.id,
          reason: "run-finished",
        }),
      }),
      { backpressure: "coalesce" },
    )
    expect(logger.info).toHaveBeenCalledWith("Recovered interrupted automation runs.", {
      boundary: "automation-startup-run-recovery",
      recoveredCount: 1,
    })
    await harness.service.stop()
  })

  it("schedules a package-defined trigger without core type branches", async () => {
    const harness = createHarness({ triggers: fakeScheduleTriggerRegistry() })
    const item = await harness.service.automationCreate({
      name: "Fake schedule",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-schedule", config: { enabled: true } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })

    await harness.service.start()

    expect(item.nextRunAt).toBe("2026-06-03T00:05:00.000Z")
    expect(harness.service.automationRuntimeInspect().timers).toContain(item.id)
    await harness.service.stop()
  })

  it("uses trigger runtime guard instead of activeDays from core", async () => {
    const harness = createHarness({ triggers: fakeScheduleTriggerRegistry() })
    const item = await harness.service.automationCreate({
      name: "Guarded fake schedule",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-schedule", config: { enabled: false } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })

    const run = await harness.service.triggerForTest(item.id, "trigger")

    expect(run?.status).toBe("skipped")
    expect(run?.error).toBe("trigger runtime guard skipped run")
  })

  it("reschedules after completion when trigger policy requests it", async () => {
    const harness = createHarness({ triggers: fakeScheduleTriggerRegistry() })
    const item = await harness.service.automationCreate({
      name: "Completion anchored fake schedule",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-schedule", config: { enabled: true } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })

    const run = await harness.service.triggerForTest(item.id, "trigger")
    const stored = await harness.items.get(item.id)

    expect(run?.status).toBe("success")
    expect(stored?.nextRunAt).toBe("2026-06-03T00:05:00.000Z")
  })

  it("manual runs cancel stale completion-anchored timers and reschedule from completion time", async () => {
    vi.useFakeTimers()
    try {
      const clock = { now: new Date("2026-06-03T00:00:00.000Z") }
      const harness = createHarness({ now: () => clock.now })
      const item = await harness.service.automationCreate(createCompletionAnchoredIntervalInput())
      await harness.service.start()

      expect((await harness.items.get(item.id))?.nextRunAt).toBe("2026-06-03T00:10:00.000Z")

      await vi.advanceTimersByTimeAsync(5 * 60_000)
      clock.now = new Date("2026-06-03T00:05:00.000Z")
      const run = await harness.service.runNow(item.id)

      expect(run?.status).toBe("success")
      expect((await harness.items.get(item.id))?.nextRunAt).toBe("2026-06-03T00:15:00.000Z")

      clock.now = new Date("2026-06-03T00:10:00.000Z")
      await vi.advanceTimersByTimeAsync(5 * 60_000)

      expect(await harness.runs.listByAutomation(item.id)).toEqual([
        expect.objectContaining({ triggeredBy: "manual", status: "success" }),
      ])

      clock.now = new Date("2026-06-03T00:15:00.000Z")
      await vi.advanceTimersByTimeAsync(5 * 60_000)

      expect(await harness.runs.listByAutomation(item.id)).toEqual([
        expect.objectContaining({ triggeredBy: "manual", status: "success" }),
        expect.objectContaining({ triggeredBy: "trigger", status: "success" }),
      ])
      await harness.service.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not run disabled automations after cancelling a scheduled timer", async () => {
    vi.useFakeTimers()
    try {
      const clock = { now: new Date("2026-06-03T00:00:00.000Z") }
      const harness = createHarness({ now: () => clock.now })
      const item = await harness.service.automationCreate(createCompletionAnchoredIntervalInput())
      await harness.service.start()

      expect(harness.service.automationRuntimeInspect().timers).toContain(item.id)

      await harness.service.automationDisable(item.id)
      clock.now = new Date("2026-06-03T00:10:00.000Z")
      await vi.advanceTimersByTimeAsync(10 * 60_000)

      expect(harness.service.automationRuntimeInspect().timers).not.toContain(item.id)
      expect(await harness.runs.listByAutomation(item.id)).toEqual([])
      await harness.service.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("accepts events through trigger runtime matching", async () => {
    const harness = createHarness({ triggers: fakeEventTriggerRegistry() })
    const item = await harness.service.automationCreate({
      name: "Event automation",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })

    const runs = await harness.service.acceptEvent({
      source: "test",
      type: "demo.created",
      payload: { id: "1" },
      receivedAt: "2026-06-03T00:00:00.000Z",
    })

    expect(runs).toHaveLength(1)
    expect(runs[0]).toEqual(expect.objectContaining({
      automationId: item.id,
      status: "success",
      triggeredBy: "trigger",
    }))
  })

  it("ignores events that trigger runtime rejects", async () => {
    const harness = createHarness({ triggers: fakeEventTriggerRegistry() })
    await harness.service.automationCreate({
      name: "Event automation",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })

    const runs = await harness.service.acceptEvent({
      source: "test",
      type: "demo.deleted",
      payload: { id: "1" },
      receivedAt: "2026-06-03T00:00:00.000Z",
    })

    expect(runs).toEqual([])
  })

  it("logs invalid event trigger config and continues matching later automations", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ triggers: fakeEventTriggerRegistry(), logger })
    await harness.itemStore.upsert({
      id: "automation:broken",
      schemaVersion: 1,
      name: "Broken event automation",
      enabled: true,
      scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: {} },
      executor: { type: "builtin.test", config: { message: "ok" } },
      policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      runCount: 0,
      configVersion: 0,
    })
    const item = await harness.service.automationCreate({
      name: "Event automation",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })

    const runs = await harness.service.acceptEvent({
      source: "test",
      type: "demo.created",
      payload: { id: "1" },
      receivedAt: "2026-06-03T00:00:00.000Z",
    })

    expect(runs).toEqual([
      expect.objectContaining({
        automationId: item.id,
        status: "success",
        triggeredBy: "trigger",
      }),
    ])
    expect(logger.warn).toHaveBeenCalledWith("Automation event trigger config invalid, skipping item.", {
      automationId: "automation:broken",
      triggerType: "builtin.fake-event",
      boundary: "automation-event-trigger",
      errorName: "ZodError",
      errorLength: expect.any(Number),
    })
  })

  it("skips event trigger runtime errors and continues matching later automations", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ triggers: throwingEventTriggerRegistry(), logger })
    await harness.service.automationCreate({
      name: "Broken event automation",
      scope: { type: "global" },
      trigger: { type: "builtin.throwing-event", config: { eventType: "demo.created" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })
    const item = await harness.service.automationCreate({
      name: "Event automation",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })

    const runs = await harness.service.acceptEvent({
      source: "test",
      type: "demo.created",
      payload: { id: "1" },
      receivedAt: "2026-06-03T00:00:00.000Z",
    })

    expect(runs).toEqual([
      expect.objectContaining({
        automationId: item.id,
        status: "success",
        triggeredBy: "trigger",
      }),
    ])
    expect(logger.warn).toHaveBeenCalledWith("Automation event trigger failed, skipping item.", {
      automationId: "automation:1",
      triggerType: "builtin.throwing-event",
      boundary: "automation-event-trigger",
      errorName: "Error",
      errorLength: expect.any(Number),
    })
  })
})

function createHarness(options: {
  readonly action?: MainActionDefinition<TestActionConfig>
  readonly logger?: StructuredLogger
  readonly eventBus?: Pick<EventBus, "emit">
  readonly triggers?: AutomationTriggerRegistry
  readonly now?: () => Date
} = {}) {
  const triggers = options.triggers ?? createBuiltinAutomationTriggerRegistry()
  let automationIndex = 0
  const itemStore = new MemoryNamespace<AutomationItem>("automation.items")
  const items = new AutomationItemRepository({
    items: itemStore,
    triggers,
    now: options.now ?? (() => new Date("2026-06-03T00:00:00.000Z")),
    idFactory: () => `automation:${++automationIndex}`,
  })
  const runs = new AutomationRunRepository({
    runs: new MemoryNamespace<AutomationRun>("automation.runs"),
    now: () => new Date("2026-06-03T00:01:00.000Z"),
    idFactory: (_automationId, index) => `automation-run:${index}`,
  })
  const actions = new MainActionRegistry()
  actions.register(options.action ?? testAction)
  const execution = new AutomationExecutionService({
    items,
    runs,
    actions,
    permissionGuard: permissionGuard({ allowed: true }),
    auditSink: {
      record: () => {},
      list: () => [],
      clearForTests: () => {},
    },
    defaultCwd: "/tmp",
    logger: { warn: () => {} },
  })
  const service = new AutomationService({
    items,
    runs,
    triggers,
    actions,
    execution,
    defaultCwd: "/tmp",
    eventBus: options.eventBus,
    logger: options.logger,
    now: options.now ?? (() => new Date("2026-06-03T00:00:00.000Z")),
  })
  return { service, items, itemStore, runs, execution }
}

function fakeScheduleTriggerRegistry(): AutomationTriggerRegistry {
  const registry = createBuiltinAutomationTriggerRegistry()
  registry.register({
    manifest: {
      id: "builtin.fake-schedule",
      title: "Fake Schedule",
      kind: "schedule",
      defaultConfig: { enabled: true },
      configSchema: z.object({ enabled: z.boolean() }),
    },
    summarize: () => "Fake Schedule",
    runtime: {
      computeNextRunAt: () => new Date("2026-06-03T00:05:00.000Z"),
      shouldRunNow: ({ config }) => config.enabled,
      getReschedulePolicy: () => ({ mode: "after_completion" }),
    },
  })
  return registry
}

function fakeEventTriggerRegistry(): AutomationTriggerRegistry {
  const registry = createBuiltinAutomationTriggerRegistry()
  registry.register({
    manifest: {
      id: "builtin.fake-event",
      title: "Fake Event",
      kind: "event",
      defaultConfig: { eventType: "demo.created" },
      configSchema: z.object({ eventType: z.string().min(1) }),
    },
    summarize: (config) => `Event · ${config.eventType}`,
    runtime: {
      shouldAcceptEvent: ({ config, event }) => event.type === config.eventType,
    },
  })
  return registry
}

function throwingEventTriggerRegistry(): AutomationTriggerRegistry {
  const registry = fakeEventTriggerRegistry()
  registry.register({
    manifest: {
      id: "builtin.throwing-event",
      title: "Throwing Event",
      kind: "event",
      defaultConfig: { eventType: "demo.created" },
      configSchema: z.object({ eventType: z.string().min(1) }),
    },
    summarize: (config) => `Throwing event · ${config.eventType}`,
    runtime: {
      shouldAcceptEvent: () => {
        throw new Error("matcher failed")
      },
    },
  })
  return registry
}

function createAutomationInput() {
  return {
    name: "Daily report",
    scope: { type: "global" as const },
    trigger: {
      type: "builtin.interval",
      config: {
        everyMinutes: 10,
        anchor: "created_at",
        activeDays: [0, 1, 2, 3, 4, 5, 6],
      },
    },
    executor: { type: "builtin.test", config: { message: "ok" } },
  }
}

function createCronAutomationInput() {
  return {
    name: "Every minute",
    scope: { type: "global" as const },
    trigger: {
      type: "builtin.cron",
      config: {
        expr: "* * * * *",
        activeDays: [0, 1, 2, 3, 4, 5, 6],
      },
    },
    executor: { type: "builtin.test", config: { message: "ok" } },
  }
}

function createCompletionAnchoredIntervalInput() {
  return {
    name: "After completion interval",
    scope: { type: "global" as const },
    trigger: {
      type: "builtin.interval",
      config: {
        everyMinutes: 10,
        anchor: "last_completed_at",
        activeDays: [0, 1, 2, 3, 4, 5, 6],
      },
    },
    executor: { type: "builtin.test", config: { message: "ok" } },
  }
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

function longRunningAction(): MainActionDefinition<TestActionConfig> {
  return {
    ...testAction,
    execute: async ({ context }) => new Promise((resolve) => {
      context.abortSignal.addEventListener("abort", () => {
        resolve({ status: "cancelled", summary: "已停止" })
      }, { once: true })
    }),
  }
}

function permissionGuard(result: Awaited<ReturnType<PermissionGuard["check"]>>): PermissionGuard {
  return {
    registerPolicy: () => () => {},
    check: async () => result,
  }
}

function structuredLogger(): StructuredLogger {
  const logger: StructuredLogger = {
    trace: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  }
  return logger
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const startedAt = Date.now()
  while (!(await predicate())) {
    if (Date.now() - startedAt > 1_000) {
      throw new Error("Timed out waiting for condition")
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
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
