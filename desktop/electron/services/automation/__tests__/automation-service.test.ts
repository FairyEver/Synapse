import { z } from "zod"
import { LIVE_MESSAGE_TYPES } from "@synapse/shared"
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
  it("requires the saved webhook run binding instead of trusting caller identifiers", async () => {
    const h = createHarness()
    const run = await h.runs.start("automation:1", "trigger", { triggerType: "builtin.webhook", executorType: "builtin.claude-code",
      webhookDelivery: { deliveryId: "delivery-1", webhookPublicId: "wh_public", triggeredAt: "2026-11-06T12:00:00Z" } })
    await expect(h.service.automationWebhookRunContext(run.id, "delivery-1")).resolves.toMatchObject({ runId: run.id, deliveryId: "delivery-1" })
    await expect(h.service.automationWebhookRunContext(run.id, "other")).rejects.toThrow("不匹配")
    await expect(h.service.automationWebhookRunContext("missing", "delivery-1")).rejects.toThrow("不匹配")
  })
  it("keeps known invalid scope editable and validates it before scheduling", async () => {
    const harness = createHarness()
    const item = createStoredAutomation({ scope: { type: "project", projectId: "" } })
    await harness.itemStore.upsert(item)
    expect(await harness.service.automationGet(item.id)).toMatchObject({ readOnly: false, enabled: false, validation: { status: "needs_update" } })
    const repaired = await harness.service.automationUpdate(item.id, { scope: { type: "global" } })
    expect(repaired.readOnly).toBe(false)
    expect(repaired.validation?.status).not.toBe("needs_update")
  })
  it("keeps unknown top-level metadata when renaming a historical V2 task", async () => {
    const harness = createHarness()
    const item = { ...createStoredAutomation(), metadata: { futureLabel: "保留" } }
    await harness.itemStore.upsert(item)
    await harness.service.automationUpdate(item.id, { name: "Renamed" })
    expect(await harness.items.get(item.id)).toMatchObject({ metadata: item.metadata, name: "Renamed", configVersion: 1 })
  })

  it("does not accept an event or commit a durable claim for future revisions", async () => {
    const harness = createHarness({ triggers: fakeEventTriggerRegistry() })
    const item = { ...createStoredAutomation(), formatRevision: 2, mailSubscription: { id: "sub" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } } }
    await harness.itemStore.upsert(item)
    const event = { source: "test", type: "demo.created", payload: {}, receivedAt: "2026-06-03T00:00:00Z" }
    const commitStart = vi.fn(async () => true)
    expect(await harness.service.acceptEvent(event)).toEqual([])
    expect(await harness.service.runDurableEvent({ automationId: item.id, subscriptionId: "sub", runId: "reserved", event, identitySignal: new AbortController().signal, commitStart })).toEqual({ kind: "obsolete" })
    expect(commitStart).not.toHaveBeenCalled()
    expect(await harness.runs.listByAutomation(item.id)).toEqual([])
    expect(await harness.items.get(item.id)).toEqual(item)
  })

  it("rejects unknown root input through the service boundary used by MCP", async () => {
    const harness = createHarness()
    await expect(harness.service.automationCreate({ ...createAutomationInput(), futureOption: true } as Parameters<AutomationService["automationCreate"]>[0])).rejects.toThrow()
    expect(await harness.items.list()).toEqual([])
  })
  it.each([
    ["future revision", { formatRevision: 2 }],
    ["null revision", { formatRevision: null }],
    ["zero revision", { formatRevision: 0 }],
    ["invalid trigger with unknown config", { trigger: { type: "builtin.interval", config: { everyMinutes: 0, anchor: "created_at", futureLimit: 3 } } }],
    ["invalid executor with unknown config", { executor: { type: "builtin.test", config: { message: "", futureLimit: 3 } } }],
    ["unknown trigger config", { trigger: { type: "builtin.interval", config: { everyMinutes: 10, anchor: "created_at", futureLimit: 3 } } }],
    ["unknown executor config", { executor: { type: "builtin.test", config: { message: "ok", futureLimit: 3 } } }],
    ["unknown policy", { policy: { missedRunPolicy: "skip", overlapPolicy: "queue" } }],
    ["unknown condition", { conditions: { operator: "and", items: [{ type: "future-condition" }] } }],
  ])("isolates %s without executing, overwriting or blocking a compatible task", async (_label, patch) => {
    const harness = createHarness()
    const incompatible = Object.assign(createStoredAutomation(), patch) as AutomationItem
    await harness.itemStore.upsert(incompatible)
    const compatible = await harness.service.automationCreate(createAutomationInput())
    await harness.service.start()
    try {
      expect(harness.service.automationRuntimeInspect().timers).toEqual([compatible.id])
      const listed = await harness.service.automationList()
      expect(listed.find(item => item.id === incompatible.id)).toMatchObject({
        enabled: false, readOnly: true, nextRunAt: undefined,
        validation: { status: "needs_update" },
      })
      await expect(harness.service.runNow(incompatible.id)).rejects.toThrow("配置需要更新")
      await expect(harness.service.automationEnable(incompatible.id)).rejects.toThrow("配置需要更新")
      await expect(harness.service.automationUpdate(incompatible.id, { name: "do not overwrite" })).rejects.toThrow()
      expect(await harness.items.get(incompatible.id)).toEqual(incompatible)
      expect(await harness.runs.listByAutomation(incompatible.id)).toEqual([])
    } finally { await harness.service.stop() }
  })

  it("rejects unknown execution fields on create rather than silently stripping them", async () => {
    const harness = createHarness()
    await expect(harness.service.automationCreate({
      ...createAutomationInput(),
      trigger: { type: "builtin.interval", config: { everyMinutes: 10, anchor: "created_at", futureLimit: 3 } },
    })).rejects.toThrow()
    expect(await harness.items.list()).toEqual([])
  })

  it("writes the current format revision without changing V2 or the edit counter", async () => {
    const harness = createHarness()
    const item = await harness.service.automationCreate(createAutomationInput())
    expect(item).toMatchObject({ schemaVersion: 2, formatRevision: 1, configVersion: 0 })
    const updated = await harness.service.automationUpdate(item.id, { name: "Renamed" })
    expect(updated).toMatchObject({ schemaVersion: 2, formatRevision: 1, configVersion: 1 })
  })

  it.each([
    ["cron", () => ({ ...createCronAutomationInput(), trigger: { type: "builtin.cron", config: { expr: "* * * * *", timezone: "UTC" } } }), 60_000],
    ["interval", createCompletionAnchoredIntervalInput, 600_000],
  ] as const)("preserves the planned %s time when its timer fires late", async (_name, input, delay) => {
    vi.useFakeTimers()
    const clock = { now: new Date("2026-06-03T00:00:00.000Z") }
    const execute = vi.fn(testAction.execute)
    const harness = createHarness({ now: () => clock.now, action: { ...testAction, execute } })
    try {
      const item = await harness.service.automationCreate(input())
      await harness.service.start()
      clock.now = new Date(Date.parse(item.nextRunAt!) + 90_000)
      await vi.advanceTimersByTimeAsync(delay)
      expect(execute).toHaveBeenCalledOnce()
      const variables = execute.mock.calls[0]![0].context.templateVariables
      expect(variables?.["trigger.scheduledAt"]).toBe(item.nextRunAt)
      expect(variables?.["trigger.triggeredAt"]).toBe(clock.now.toISOString())
      expect((await harness.items.get(item.id))?.nextRunAt).not.toBe(item.nextRunAt)
    } finally { await harness.service.stop(); vi.useRealTimers() }
  })

  it("preserves the missed plan time during startup catchup", async () => {
    const now = new Date("2026-06-03T00:15:00.000Z")
    const execute = vi.fn(testAction.execute)
    const harness = createHarness({ now: () => now, action: { ...testAction, execute } })
    const item = createStoredAutomation({
      nextRunAt: "2026-06-03T00:10:00.000Z",
      policy: { missedRunPolicy: "run_once", overlapPolicy: "skip" },
    })
    await harness.itemStore.upsert(item)
    await harness.service.start()
    try {
      await waitFor(async () => (await harness.runs.listByAutomation(item.id)).some(run => run.status === "success"))
      expect(execute.mock.calls[0]![0].context.templateVariables).toEqual(expect.objectContaining({
        "trigger.scheduledAt": item.nextRunAt,
        "trigger.triggeredAt": now.toISOString(),
        "trigger.triggeredBy": "missed_run",
      }))
    } finally { await harness.service.stop() }
  })

  it("enables an out-of-range interval without an invalid timer or unintended run", async () => {
    const harness = createHarness()
    await harness.service.start()
    try {
      const item = await harness.service.automationCreate({
        ...createAutomationInput(),
        enabled: false,
        trigger: { type: "builtin.interval", config: { everyMinutes: Number.MAX_SAFE_INTEGER, anchor: "created_at" } },
      })
      const enabled = await harness.service.automationEnable(item.id)
      expect(enabled.enabled).toBe(true)
      expect(enabled.nextRunAt).toBeUndefined()
      expect(harness.service.automationRuntimeInspect().timers).toEqual([])
      expect(await harness.runs.listByAutomation(item.id)).toEqual([])
    } finally { await harness.service.stop() }
  })

  it("schedules enabled automations on start", async () => {
    const harness = createHarness()
    await harness.items.create(createAutomationInput())

    await harness.service.start()

    expect(harness.service.automationRuntimeInspect().timers).toContain("automation:1")
    await harness.service.stop()
  })

  it("disables every legacy automation before scheduling without changing its configuration", async () => {
    const harness = createHarness()
    const legacy = createStoredAutomation({
      id: "automation:legacy",
      schemaVersion: 1,
      name: "旧版自动化",
      trigger: {
        type: "builtin.cron",
        config: {
          expr: "0 9 * * *",
          timezone: "Asia/Shanghai",
          activeDays: [1, 2, 3, 4, 5],
          timeRange: { start: "08:00", end: "17:00" },
        },
      },
      executor: { type: "builtin.agent", config: { prompt: "保留原提示词" } },
      nextRunAt: "2026-06-03T01:00:00.000Z",
    })
    await harness.itemStore.upsert(legacy)

    await harness.service.start()
    try {
      const stored = await harness.items.get(legacy.id)
      expect(stored).toEqual(expect.objectContaining({
        schemaVersion: 1,
        enabled: false,
        trigger: legacy.trigger,
        executor: legacy.executor,
        runCount: legacy.runCount,
      }))
      expect(stored?.nextRunAt).toBeUndefined()
      expect(harness.service.automationRuntimeInspect().timers).not.toContain(legacy.id)
      await expect(harness.service.runNow(legacy.id)).rejects.toThrow("旧版自动化不可运行")
      await expect(harness.service.automationUpdate(legacy.id, { name: "Renamed" })).rejects.toThrow("旧版自动化不可编辑")
    } finally { await harness.service.stop() }
  })

  it("does not schedule a manual trigger with a stale persisted next run", async () => {
    const harness = createHarness()
    const item = createStoredAutomation({
      trigger: { type: "builtin.manual", config: {} },
      nextRunAt: "2099-01-01T00:00:00.000Z",
    })
    await harness.itemStore.upsert(item)

    await harness.service.start()
    try {
      expect(harness.service.automationRuntimeInspect().timers).toEqual([])
      expect(await harness.runs.listByAutomation(item.id)).toEqual([])
    } finally { await harness.service.stop() }
  })

  it("leaves an automation without a matching time unscheduled while allowing manual runs", async () => {
    const harness = createHarness({ now: () => new Date("2026-10-23T18:00:00Z") })
    const item = await harness.service.automationCreate({
      ...createCronAutomationInput(), trigger: { type: "builtin.cron", config: {
        expr: "0 2 * * *", timezone: "UTC",
      } }, conditions: { operator: "and", items: [
        { type: "weekdays", days: [1, 2, 3, 4, 5] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ] },
    })
    await harness.service.start()
    try {
      expect(item.nextRunAt).toBeUndefined()
      expect(harness.service.automationRuntimeInspect().timers).toEqual([])
      expect((await harness.service.runNow(item.id))?.status).toBe("success")
      expect((await harness.items.get(item.id))?.nextRunAt).toBeUndefined()
    } finally { await harness.service.stop() }
  })

  it("rechecks the range when a due timer fires late after sleep", async () => {
    vi.useFakeTimers()
    const clock = { now: new Date("2026-10-23T16:58:00Z") }
    const harness = createHarness({ now: () => clock.now })
    try {
      const item = await harness.service.automationCreate({
        ...createCronAutomationInput(), trigger: { type: "builtin.cron", config: {
          expr: "* * * * *", timezone: "UTC",
        } }, conditions: { operator: "and", items: [
          { type: "weekdays", days: [1, 2, 3, 4, 5] },
          { type: "daily-time-range", start: "08:00", end: "17:00" },
        ] },
      })
      await harness.service.start()
      expect(item.nextRunAt).toBe("2026-10-23T16:59:00.000Z")
      clock.now = new Date("2026-10-23T17:01:00Z")
      await vi.advanceTimersByTimeAsync(60_000)
      expect(await harness.runs.listByAutomation(item.id)).toEqual([expect.objectContaining({ status: "skipped" })])
      expect((await harness.items.get(item.id))?.nextRunAt).toBe("2026-10-26T08:00:00.000Z")
    } finally {
      await harness.service.stop()
      vi.useRealTimers()
    }
  })

  it("blocks startup run_once catchup outside the daily range", async () => {
    const harness = createHarness({ now: () => new Date("2026-10-23T17:00:00Z") })
    const item = createStoredAutomation({
      trigger: { type: "builtin.cron", config: {
        expr: "* * * * *", timezone: "UTC",
      } }, conditions: { operator: "and", items: [
        { type: "weekdays", days: [1, 2, 3, 4, 5] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ] }, policy: { missedRunPolicy: "run_once", overlapPolicy: "skip" }, nextRunAt: "2026-10-23T16:59:00Z",
    })
    await harness.itemStore.upsert(item)
    await harness.service.start()
    try {
      await waitFor(async () => (await harness.runs.listByAutomation(item.id)).length === 1)
      expect(await harness.runs.listByAutomation(item.id)).toEqual([expect.objectContaining({ triggeredBy: "missed_run", status: "skipped" })])
      expect((await harness.items.get(item.id))?.nextRunAt).toBe("2026-10-26T08:00:00.000Z")
    } finally { await harness.service.stop() }
  })

  it("rejects a context-free Webhook manual run before creating a run", async () => {
    const harness = createHarness()
    const item = await harness.service.automationCreate({ ...createAutomationInput(), trigger: { type: "builtin.webhook", config: { webhookPublicId: "wh_public" } } })
    await expect(harness.service.runNow(item.id)).rejects.toThrow("Webhook 请求")
    expect(await harness.runs.listByAutomation(item.id)).toEqual([])
  })

  it("runs a manual trigger without scheduling or applying conditions", async () => {
    const harness = createHarness({ now: () => new Date("2026-11-07T12:00:00.000Z") })
    const item = await harness.service.automationCreate({
      ...createAutomationInput(),
      trigger: { type: "builtin.manual", config: {} },
      conditions: { operator: "and", items: [{ type: "weekdays", days: [1, 2, 3, 4, 5] }] },
    })

    await harness.service.start()
    try {
      expect(harness.service.automationRuntimeInspect().timers).toEqual([])
      const run = await harness.service.runNow(item.id)
      expect(run?.status).toBe("success")
      expect(run?.triggeredBy).toBe("manual")
      expect(harness.service.automationRuntimeInspect().timers).toEqual([])
    } finally {
      await harness.service.stop()
    }
  })

  it("rejects manual runs for disabled automations", async () => {
    const harness = createHarness()
    const item = await harness.service.automationCreate({
      ...createAutomationInput(),
      enabled: false,
      trigger: { type: "builtin.manual", config: {} },
    })

    await expect(harness.service.runNow(item.id)).rejects.toThrow("automation is disabled")
    expect(await harness.runs.listByAutomation(item.id)).toEqual([])
  })

  it("does not accept external events for a manual trigger", async () => {
    const harness = createHarness()
    const item = await harness.service.automationCreate({
      ...createAutomationInput(),
      trigger: { type: "builtin.manual", config: {} },
    })

    const runs = await harness.service.acceptEvent({ source: "test", type: "manual", payload: {}, receivedAt: "2026-11-07T12:00:00.000Z" })
    expect(runs).toEqual([])
    expect(await harness.runs.listByAutomation(item.id)).toEqual([])
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

  it("queues overlapping event runs without mixing delivery payloads", async () => {
    const action = controllableEventAction()
    const harness = createHarness({ action: action.definition, triggers: fakeEventTriggerRegistry() })
    const item = await harness.service.automationCreate({
      name: "Event automation",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })

    const first = harness.service.acceptEvent({
      source: "webhook",
      type: "demo.created",
      payload: { deliveryId: "delivery-running" },
      receivedAt: "2026-06-03T00:00:00.000Z",
    })
    await waitFor(async () => action.started.length === 1)
    const second = harness.service.acceptEvent({
      source: "webhook",
      type: "demo.created",
      payload: { deliveryId: "delivery-skipped" },
      receivedAt: "2026-06-03T00:00:01.000Z",
    })
    const third = harness.service.acceptEvent({
      source: "webhook",
      type: "demo.created",
      payload: { deliveryId: "delivery-final" },
      receivedAt: "2026-06-03T00:00:02.000Z",
    })

    action.resolveNext()
    await waitFor(async () => action.started.length === 2)
    action.resolveNext()
    await waitFor(async () => action.started.length === 3)
    action.resolveNext()

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      [expect.objectContaining({ status: "success", result: expect.objectContaining({ summary: "delivery-running" }) })],
      [expect.objectContaining({ status: "success", result: expect.objectContaining({ summary: "delivery-skipped" }) })],
      [expect.objectContaining({ status: "success", result: expect.objectContaining({ summary: "delivery-final" }) })],
    ])

    expect(action.started.map((run) => run.deliveryId)).toEqual([
      "delivery-running",
      "delivery-skipped",
      "delivery-final",
    ])
    expect(await harness.runs.listByAutomation(item.id)).toEqual([
      expect.objectContaining({ status: "success" }),
      expect.objectContaining({ status: "success" }),
      expect.objectContaining({ status: "success" }),
    ])
  })

  it.each(["disable-reenable", "update-disable", "source-roundtrip", "stop", "rename", "failed-disable"] as const)("handles pending events across a %s boundary", async boundary => {
    const started: string[] = []
    let releaseFirst!: () => void
    const triggers = fakeEventTriggerRegistry()
    const matches = vi.spyOn(triggers.get("builtin.fake-event").runtime, "shouldAcceptEvent")
    const harness = createHarness({ triggers, action: { ...testAction, execute: async ({ context }) => {
      const deliveryId = context.templateVariables!["trigger.payload.deliveryId"]!
      started.push(deliveryId)
      if (deliveryId === "running") await new Promise<void>(resolve => {
        releaseFirst = resolve
        context.abortSignal.addEventListener("abort", () => resolve(), { once: true })
      })
      return { status: "success", summary: deliveryId }
    } } })
    const item = await harness.service.automationCreate({
      name: "Queued lifecycle", scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })
    const event = (deliveryId: string) => ({ source: "webhook", type: "demo.created", payload: { deliveryId }, receivedAt: "2026-06-03T00:00:00.000Z" })
    const first = harness.service.acceptEvent(event("running"))
    await waitFor(() => started.length === 1)
    const pending = harness.service.acceptEvent(event("obsolete"))
    await waitFor(() => matches.mock.calls.length === 2)
    if (boundary === "disable-reenable") {
      await harness.service.automationDisable(item.id)
      await harness.service.automationEnable(item.id)
    } else if (boundary === "update-disable") {
      await harness.service.automationUpdate(item.id, { enabled: false })
      await harness.service.automationEnable(item.id)
    } else if (boundary === "source-roundtrip") {
      await harness.service.automationUpdate(item.id, { trigger: { type: "builtin.fake-event", config: { eventType: "demo.changed" } } })
      await harness.service.automationUpdate(item.id, { trigger: item.trigger })
    } else if (boundary === "rename") {
      await harness.service.automationUpdate(item.id, { name: "Renamed without changing its trigger" })
    } else if (boundary === "failed-disable") {
      vi.spyOn(harness.items, "setEnabled").mockRejectedValueOnce(new Error("disk unavailable"))
      await expect(harness.service.automationDisable(item.id)).rejects.toThrow("disk unavailable")
    } else {
      await harness.service.stop()
    }
    const fresh = boundary === "stop" ? undefined : harness.service.acceptEvent(event("fresh"))
    releaseFirst()
    await first
    await pending
    if (fresh) await fresh
    const preserved = boundary === "rename" || boundary === "failed-disable"
    expect(started).toEqual(boundary === "stop" ? ["running"] : preserved ? ["running", "obsolete", "fresh"] : ["running", "fresh"])
    expect(await pending).toHaveLength(preserved ? 1 : 0)
    await harness.service.stop()
  })

  it("starts different matching event automations without waiting for the first run to finish", async () => {
    const action = controllableEventAction()
    const harness = createHarness({ action: action.definition, triggers: fakeEventTriggerRegistry() })
    await harness.service.automationCreate({
      name: "Slow event automation",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
      executor: { type: "builtin.test", config: { message: "slow" } },
    })
    await harness.service.automationCreate({
      name: "Quick event automation",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
      executor: { type: "builtin.test", config: { message: "quick" } },
    })

    const runs = harness.service.acceptEvent({
      source: "webhook",
      type: "demo.created",
      payload: { deliveryId: "delivery-fanout" },
      receivedAt: "2026-06-03T00:00:00.000Z",
    })

    await waitFor(async () => action.started.length === 2)
    expect(action.started.map((run) => run.deliveryId)).toEqual(["delivery-fanout", "delivery-fanout"])

    action.resolveNext()
    action.resolveNext()

    await expect(runs).resolves.toEqual([
      expect.objectContaining({ automationId: "automation:1", status: "success" }),
      expect.objectContaining({ automationId: "automation:2", status: "success" }),
    ])
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

  it("lists recently created or updated automations first", async () => {
    const harness = createHarness()
    await harness.itemStore.upsert(createStoredAutomation({
      id: "automation:old",
      name: "Old automation",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
    }))
    await harness.itemStore.upsert(createStoredAutomation({
      id: "automation:new",
      name: "New automation",
      createdAt: "2026-06-03T00:10:00.000Z",
      updatedAt: "2026-06-03T00:10:00.000Z",
    }))
    await harness.itemStore.upsert(createStoredAutomation({
      id: "automation:edited",
      name: "Edited automation",
      createdAt: "2026-06-03T00:05:00.000Z",
      updatedAt: "2026-06-03T00:15:00.000Z",
    }))

    const listedIds = (await harness.service.automationList()).map((item) => item.id)

    expect(listedIds).toEqual(["automation:edited", "automation:new", "automation:old"])
  })

  it("applies list filters and limits before runtime projection", async () => {
    const harness = createHarness()
    await harness.itemStore.upsert(createStoredAutomation({
      id: "automation:invalid-old",
      name: "Invalid old automation",
      enabled: true,
      trigger: { type: "builtin.missing-trigger", config: {} },
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
    }))
    await harness.itemStore.upsert(createStoredAutomation({
      id: "automation:new",
      name: "New automation",
      enabled: true,
      createdAt: "2026-06-03T00:10:00.000Z",
      updatedAt: "2026-06-03T00:10:00.000Z",
    }))

    const listed = await harness.service.automationList({ enabled: true, limit: 1 })

    expect(listed.map((item) => item.id)).toEqual(["automation:new"])
    expect(listed[0]?.validation).toBeUndefined()
  })

  it("projects invalid listed automations as disabled without persisting the change", async () => {
    const harness = createHarness()
    await harness.itemStore.upsert(createStoredAutomation({
      id: "automation:invalid",
      enabled: true,
      trigger: { type: "builtin.missing-trigger", config: {} },
    }))

    const [listed] = await harness.service.automationList()

    expect(listed).toEqual(expect.objectContaining({
      id: "automation:invalid",
      enabled: false,
      validation: expect.objectContaining({ status: "needs_update" }),
    }))
    await expect(harness.items.get("automation:invalid")).resolves.toEqual(expect.objectContaining({
      enabled: true,
    }))
  })

  it("projects invalid loaded automations as disabled without persisting the change", async () => {
    const harness = createHarness()
    await harness.itemStore.upsert(createStoredAutomation({
      id: "automation:invalid",
      enabled: true,
      trigger: { type: "builtin.missing-trigger", config: {} },
    }))

    const loaded = await harness.service.automationGet("automation:invalid")

    expect(loaded).toEqual(expect.objectContaining({
      id: "automation:invalid",
      enabled: false,
      validation: expect.objectContaining({ status: "needs_update" }),
    }))
    await expect(harness.items.get("automation:invalid")).resolves.toEqual(expect.objectContaining({
      enabled: true,
    }))
  })

  it("clears runtime running markers when stop times out waiting for active runs", async () => {
    const controlled = manuallyResolvedAction()
    const harness = createHarness({ action: controlled.action })
    const item = await harness.service.automationCreate(createAutomationInput())
    const runPromise = harness.service.runNow(item.id)
    await waitFor(async () => harness.service.automationRuntimeInspect().runningItemIds.includes(item.id))

    vi.useFakeTimers()
    try {
      const stopPromise = harness.service.stop()
      await vi.advanceTimersByTimeAsync(3_000)
      await stopPromise
    } finally {
      vi.useRealTimers()
    }

    expect(harness.service.automationRuntimeInspect().runningItemIds).toEqual([])
    const [listed] = await harness.service.automationList()
    expect(listed?.activeRun).toBeUndefined()

    controlled.resolve()
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

  it("emits run-started after the active run id is available", async () => {
    const activeRunIdsAtEmit: Array<string | undefined> = []
    const emit = vi.fn(async (event) => {
      if (event.payload.reason !== "run-started") return
      const items = await harness.service.automationList()
      activeRunIdsAtEmit.push(items.find((listed) => listed.id === item.id)?.activeRun?.id)
    })
    const eventBus: Pick<EventBus, "emit"> = { emit: emit as unknown as EventBus["emit"] }
    const harness = createHarness({ action: longRunningAction(), eventBus })
    const item = await harness.service.automationCreate(createAutomationInput())

    const runPromise = harness.service.runNow(item.id)
    await waitFor(async () => activeRunIdsAtEmit.length > 0)

    const startedPayload = emit.mock.calls
      .map(([event]) => event.payload)
      .find((payload) => payload.reason === "run-started")

    expect(startedPayload).toEqual(expect.objectContaining({
      automationId: item.id,
      runId: "automation-run:1",
      reason: "run-started",
    }))
    expect(activeRunIdsAtEmit).toEqual(["automation-run:1"])

    await harness.service.stopRun("automation-run:1")
    await runPromise
  })

  it("does not report stopped when a run ignores abort past the settle timeout", async () => {
    vi.useFakeTimers()
    try {
      const action = abortIgnoringAction()
      const emit = vi.fn()
      const eventBus: Pick<EventBus, "emit"> = { emit: emit as unknown as EventBus["emit"] }
      const harness = createHarness({ action: action.definition, eventBus })
      const item = await harness.service.automationCreate(createAutomationInput())

      const runPromise = harness.service.runNow(item.id)
      await action.started
      const running = (await harness.runs.listByAutomation(item.id)).find((run) => run.status === "running")
      expect(running).toBeDefined()

      const stopPromise = harness.service.stopRun(running!.id)
      await vi.advanceTimersByTimeAsync(3_000)

      await expect(stopPromise).resolves.toEqual({
        stopped: false,
        stopRequested: true,
      })
      await expect(harness.runs.get(running!.id)).resolves.toEqual(expect.objectContaining({
        status: "running",
      }))
      expect(emit.mock.calls.some(([event]) => event.payload.reason === "run-stopped")).toBe(false)

      action.resolve()
      await expect(runPromise).resolves.toEqual(expect.objectContaining({ status: "cancelled" }))
    } finally {
      vi.useRealTimers()
    }
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

  it("treats capped long-delay timers as checkpoints until nextRunAt is due", async () => {
    vi.useFakeTimers()
    try {
      const clock = { now: new Date("2026-06-03T00:00:00.000Z") }
      const logger = structuredLogger()
      const harness = createHarness({ logger, now: () => clock.now })
      const item = await harness.service.automationCreate(createLongIntervalInput())
      await harness.service.start()
      const originalNextRunAt = (await harness.items.get(item.id))?.nextRunAt

      clock.now = new Date(clock.now.getTime() + 2_147_483_647)
      await vi.advanceTimersByTimeAsync(2_147_483_647)

      expect(await harness.runs.listByAutomation(item.id)).toEqual([])
      expect((await harness.items.get(item.id))?.nextRunAt).toBe(originalNextRunAt)
      expect(harness.service.automationRuntimeInspect().timers).toContain(item.id)
      expect(logger.info).toHaveBeenCalledWith("Automation trigger timer woke before due time, rescheduled.", {
        automationId: item.id,
        nextRunAt: originalNextRunAt,
        now: clock.now.toISOString(),
        boundary: "automation-schedule-checkpoint",
      })
      await harness.service.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it("accepts events through trigger runtime matching", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ triggers: fakeEventTriggerRegistry(), logger })
    const item = await harness.service.automationCreate({
      name: "Event automation",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })
    await harness.service.automationCreate({
      name: "Unmatched event automation",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.deleted" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })

    const runs = await harness.service.acceptEvent({
      source: "test",
      type: "demo.created",
      payload: {
        id: "1",
        deliveryId: "delivery-1",
        webhook: { publicId: "wh_public" },
      },
      receivedAt: "2026-06-03T00:00:00.000Z",
    })

    expect(runs).toHaveLength(1)
    expect(runs[0]).toEqual(expect.objectContaining({
      automationId: item.id,
      status: "success",
      triggeredBy: "trigger",
    }))
    expect(logger.info).toHaveBeenCalledWith("Automation event received.", {
      source: "automation",
      eventSource: "test",
      eventType: "demo.created",
      receivedAt: "2026-06-03T00:00:00.000Z",
      deliveryId: "delivery-1",
      webhookPublicId: "wh_public",
      boundary: "automation-event-trigger",
    })
    expect(logger.info).toHaveBeenCalledWith("Automation event processing complete.", {
      source: "automation",
      eventSource: "test",
      eventType: "demo.created",
      receivedAt: "2026-06-03T00:00:00.000Z",
      deliveryId: "delivery-1",
      webhookPublicId: "wh_public",
      checkedCount: 2,
      matchedCount: 1,
      acceptedCount: 1,
      durationMs: expect.any(Number),
      boundary: "automation-event-trigger",
    })
  })

  it("drops events outside automation conditions without creating a run", async () => {
    const harness = createHarness({ triggers: fakeEventTriggerRegistry() })
    const receivedAt = "2026-06-03T18:00:00.000Z"
    const blockedDay = (new Date(receivedAt).getDay() + 1) % 7
    const item = await harness.service.automationCreate({
      name: "Windowed event",
      scope: { type: "global" },
      trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
      conditions: {
        operator: "and",
        items: [{ type: "weekdays", days: [blockedDay] }],
      },
    })

    const runs = await harness.service.acceptEvent({
      source: "test",
      type: "demo.created",
      payload: { id: "outside" },
      receivedAt,
    })

    expect(runs).toEqual([])
    expect(await harness.runs.listByAutomation(item.id)).toEqual([])
  })

  it("prefilters live webhook deliveries to matching webhook automations", async () => {
    const logger = structuredLogger()
    const harness = createHarness({ logger })
    const target = await harness.service.automationCreate({
      name: "Target webhook automation",
      scope: { type: "global" },
      trigger: { type: "builtin.webhook", config: { webhookPublicId: "wh_target" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })
    await harness.service.automationCreate({
      name: "Other webhook automation",
      scope: { type: "global" },
      trigger: { type: "builtin.webhook", config: { webhookPublicId: "wh_other" } },
      executor: { type: "builtin.test", config: { message: "ok" } },
    })
    await harness.service.automationCreate(createAutomationInput())
    const listSpy = vi.spyOn(harness.itemStore, "list")
    await harness.service.start()
    listSpy.mockClear()

    try {
      const runs = await harness.service.acceptEvent({
        source: "webhook",
        type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
        payload: {
          deliveryId: "delivery-1",
          webhook: { publicId: "wh_target" },
        },
        receivedAt: "2026-06-03T00:00:00.000Z",
      })

      expect(listSpy).not.toHaveBeenCalled()
      expect(runs).toEqual([
        expect.objectContaining({
          automationId: target.id,
          status: "success",
          triggeredBy: "trigger",
        }),
      ])
      expect(logger.info).toHaveBeenCalledWith("Automation event processing complete.", {
        source: "automation",
        eventSource: "webhook",
        eventType: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
        receivedAt: "2026-06-03T00:00:00.000Z",
        deliveryId: "delivery-1",
        webhookPublicId: "wh_target",
        checkedCount: 1,
        matchedCount: 1,
        acceptedCount: 1,
        durationMs: expect.any(Number),
        boundary: "automation-event-trigger",
      })
    } finally {
      await harness.service.stop()
    }
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
      schemaVersion: 2,
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
      },
    },
    executor: { type: "builtin.test", config: { message: "ok" } },
  }
}

function createLongIntervalInput() {
  return {
    name: "Long interval",
    scope: { type: "global" as const },
    trigger: {
      type: "builtin.interval",
      config: {
        everyMinutes: 60 * 24 * 60,
        anchor: "created_at",
      },
    },
    executor: { type: "builtin.test", config: { message: "ok" } },
  }
}

function createStoredAutomation(overrides: Partial<AutomationItem> = {}): AutomationItem {
  return {
    id: "automation:stored",
    schemaVersion: 2,
    name: "Stored automation",
    enabled: true,
    scope: { type: "global" },
    trigger: {
      type: "builtin.interval",
      config: {
        everyMinutes: 10,
        anchor: "created_at",
      },
    },
    executor: { type: "builtin.test", config: { message: "ok" } },
    policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    runCount: 0,
    configVersion: 0,
    ...overrides,
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

function abortIgnoringAction(): {
  readonly definition: MainActionDefinition<TestActionConfig>
  readonly started: Promise<void>
  readonly resolve: () => void
} {
  let resolveStarted: (() => void) | undefined
  let resolveRun: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve
  })
  return {
    definition: {
      ...testAction,
      execute: async () => {
        resolveStarted?.()
        await new Promise<void>((resolve) => {
          resolveRun = resolve
        })
        return {
          status: "success",
          summary: "ok",
          outputs: { stdout: "ok" },
        }
      },
    },
    started,
    resolve: () => {
      resolveRun?.()
    },
  }
}

function controllableEventAction(): {
  readonly definition: MainActionDefinition<TestActionConfig>
  readonly started: Array<{ readonly runId: string; readonly deliveryId: string }>
  readonly resolveNext: () => void
} {
  const started: Array<{ readonly runId: string; readonly deliveryId: string }> = []
  const resolvers: Array<() => void> = []
  const definition: MainActionDefinition<TestActionConfig> = {
    ...testAction,
    execute: async ({ context }) => {
      const rawDeliveryId = context.templateVariables?.["trigger.payload.deliveryId"]
      const deliveryId = typeof rawDeliveryId === "string" ? rawDeliveryId : "missing"
      started.push({ runId: context.runId, deliveryId })
      await new Promise<void>((resolve) => {
        resolvers.push(resolve)
        context.abortSignal.addEventListener("abort", () => resolve(), { once: true })
      })
      return {
        status: "success",
        summary: deliveryId,
        outputs: { deliveryId },
      }
    },
  }
  return {
    definition,
    started,
    resolveNext: () => {
      const resolve = resolvers.shift()
      if (resolve) resolve()
    },
  }
}

function manuallyResolvedAction(): {
  readonly action: MainActionDefinition<TestActionConfig>
  readonly resolve: () => void
} {
  type ActionResult = Awaited<ReturnType<MainActionDefinition<TestActionConfig>["execute"]>>
  let resolveRun: ((value: ActionResult) => void) | undefined
  return {
    action: {
      ...testAction,
      execute: async () => new Promise<ActionResult>((resolve) => {
        resolveRun = resolve
      }),
    },
    resolve: () => {
      resolveRun?.({
        status: "success",
        summary: "ok",
        outputs: { stdout: "ok" },
      })
    },
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
