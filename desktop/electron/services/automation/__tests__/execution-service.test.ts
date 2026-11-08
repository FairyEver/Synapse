import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../log-store", () => ({
  createMainLogger: () => ({ warn: vi.fn() }),
}))

import {
  MainActionRegistry,
  type ActionExecutionInput,
  type MainActionDefinition,
  type RegisteredMainActionDefinition,
} from "../../../action-runtime/action-registry"
import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { createBuiltinAutomationTriggerRegistry } from "../builtin-triggers"
import { AutomationExecutionService } from "../execution-service"
import { AutomationItemRepository } from "../item-repository"
import { AutomationRunRepository } from "../run-repository"
import type { AutomationItem, AutomationRun } from "../types"

const testActionSchema = z.object({ message: z.string().min(1) }).passthrough()
type TestActionConfig = z.infer<typeof testActionSchema>

describe("AutomationExecutionService", () => {
  it("saves terminal output after cancellation and keeps its actual exit metadata", async () => {
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const h = await createExecutionHarness({ action: {
      ...testAction, manifest: { ...testAction.manifest, id: "builtin.terminal" },
      execute: async ({ context }) => {
        entered()
        await new Promise<void>(resolve => context.abortSignal.addEventListener("abort", () => resolve(), { once: true }))
        await context.persistOutputs!({ sessionId: "owned", terminalOutput: "before stop", exitCode: 143 })
        return { status: "cancelled", logs: [{ label: "终端输出", value: "before stop" }], outputs: { sessionId: "owned", terminalRetained: false }, metrics: { exitCode: 143 } }
      },
    } })
    const pending = h.service.runItem({ ...h.item, executor: { ...h.item.executor, type: "builtin.terminal" } }, "manual")
    await started
    expect(h.service.stopRun("automation-run:1")).toBe(true)
    const run = await pending
    expect(run).toMatchObject({ status: "cancelled", result: { metrics: { exitCode: 143 }, logs: [{ label: "终端输出", value: "before stop" }] } })
    expect(run.result?.outputs).toMatchObject({ sessionId: "owned", terminalRetained: false })
    expect(h.auditEvents[0]).toMatchObject({ action: "shell.exec", outcome: "allowed" })
  })
  it("persists only webhook identity before the executor starts", async () => {
    let observed: AutomationRun | null = null
    const h = await createExecutionHarness({ action: { ...testAction, execute: async () => {
      observed = await h.runs.get("automation-run:1")
      return { status: "success", summary: "ok" }
    } } })
    const run = await h.service.runItem({ ...h.item, trigger: { type: "builtin.webhook", config: {} } }, "trigger", {}, {
      triggeredBy: "trigger", triggeredAt: "2026-11-06T12:00:01Z", scheduledAt: "2026-11-06T12:00:01Z",
      event: { source: "webhook", type: "webhook.delivery.received", occurredAt: "2026-11-06T12:00:00Z", receivedAt: "2026-11-06T12:00:01Z",
        payload: { deliveryId: "delivery-1", webhook: { publicId: "wh_public" }, request: { body: { secret: "never-store" } } } },
    })
    expect(observed).toMatchObject({ webhookDelivery: { deliveryId: "delivery-1", webhookPublicId: "wh_public", triggeredAt: "2026-11-06T12:00:00Z" } })
    expect(run.webhookDelivery).toEqual(observed!.webhookDelivery)
    expect(JSON.stringify(observed)).not.toContain("never-store")
  })
  it.each([1, 3])("rejects schema version %s before creating an execution", async schemaVersion => {
    const harness = await createExecutionHarness()
    await expect(harness.service.runItem({ ...harness.item, schemaVersion }, "manual")).rejects.toThrow("配置需要更新")
    expect(await harness.runs.listByAutomation(harness.item.id)).toEqual([])
  })
  it("persists a terminal association before execution and preserves it on cancellation", async () => {
    const inspectRef: { current?: () => Promise<AutomationRun | null> } = {}
    let stored: AutomationRun | null | undefined
    const harness = await createExecutionHarness({ action: {
      ...testAction,
      execute: async ({ context }) => {
        await context.persistOutputs!({ projectId: "p1", sessionId: "terminal-1" })
        stored = await inspectRef.current!()
        throw new Error("interrupted")
      },
    } })
    inspectRef.current = () => harness.runs.get("automation-run:1")
    const run = await harness.service.runItem(harness.item, "trigger")
    expect(stored?.pendingOutputs).toEqual({ projectId: "p1", sessionId: "terminal-1" })
    expect(stored?.result).toBeUndefined()
    expect(run.result?.outputs).toEqual({ projectId: "p1", sessionId: "terminal-1" })
    expect(run.status).toBe("failed")
  })
  it("runs an executor, persists output, and records audit metadata", async () => {
    let observedContext: ActionExecutionInput<TestActionConfig>["context"] | undefined
    const harness = await createExecutionHarness({
      action: {
        ...testAction,
        execute: async ({ context }) => {
          observedContext = context
          return {
            status: "success",
            summary: "ok",
            outputs: { stdout: "ok" },
          }
        },
      },
    })

    const run = await harness.service.runItem(harness.item, "trigger")

    expect(run.status).toBe("success")
    expect(run.result).toEqual({
      status: "success",
      summary: "ok",
      outputs: { stdout: "ok" },
    })
    expect(observedContext).toEqual(expect.objectContaining({
      taskId: "automation:1",
      taskName: "Daily report",
      triggeredBy: "schedule",
      configVersion: 0,
      cwd: "/tmp",
    }))
    expect(await harness.items.get("automation:1")).toEqual(expect.objectContaining({
      runCount: 1,
      lastStatus: "success",
    }))
    expect(harness.auditEvents).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        outcome: "allowed",
        metadata: expect.objectContaining({
          source: "automation",
          automationId: "automation:1",
          runId: "automation-run:1",
          triggerType: "builtin.cron",
          executorType: "builtin.test",
          triggeredBy: "trigger",
        }),
      }),
    ])
  })

  it("passes trigger template variables to executors", async () => {
    let observedVariables: Record<string, string> | undefined
    const harness = await createExecutionHarness({
      action: {
        ...testAction,
        execute: async ({ context }) => {
          observedVariables = context.templateVariables
          return { status: "success", summary: "ok" }
        },
      },
    })

    await harness.service.runItem(harness.item, "trigger", {}, {
      triggeredBy: "trigger",
      triggerKind: "schedule",
      triggeredAt: "2026-06-06T01:00:00.000Z",
      scheduledAt: "2026-06-06T01:00:00.000Z",
    })

    expect(observedVariables).toEqual(expect.objectContaining({
      "trigger.type": "builtin.cron",
      "trigger.triggeredBy": "trigger",
      "trigger.triggeredAt": "2026-06-06T01:00:00.000Z",
      "trigger.scheduledAt": "2026-06-06T01:00:00.000Z",
      "trigger.automationId": "automation:1",
      "trigger.automationName": "Daily report",
      "trigger.cron": "0 9 * * *",
    }))
  })

  it("passes manual trigger variables without a scheduledAt value", async () => {
    let observedVariables: Record<string, string> | undefined
    let observedTriggerInput: Record<string, unknown> | undefined
    const harness = await createExecutionHarness({
      action: {
        ...testAction,
        execute: async ({ context }) => {
          observedVariables = context.templateVariables
          observedTriggerInput = context.triggerInput as Record<string, unknown>
          return { status: "success", summary: "ok" }
        },
      },
    })

    await harness.service.runItem({ ...harness.item, trigger: { type: "builtin.manual", config: {} } }, "manual", {}, {
      triggeredBy: "manual",
      triggerKind: "manual",
      triggeredAt: "2026-11-07T00:00:00.000Z",
      scheduledAt: "2026-11-07T00:00:00.000Z",
    })

    expect(observedVariables).toEqual(expect.objectContaining({
      "trigger.type": "builtin.manual",
      "trigger.triggeredBy": "manual",
      "trigger.triggeredAt": "2026-11-07T00:00:00.000Z",
    }))
    expect(observedVariables).not.toHaveProperty("trigger.scheduledAt")
    expect(observedTriggerInput).not.toHaveProperty("scheduledAt")
  })

  it("runs raw script actions without permission checks or previous outputs", async () => {
    let observedPreviousOutputs: Record<string, unknown> | undefined
    const check = vi.fn(async () => ({ allowed: false, reason: "must not be called" }))
    const harness = await createExecutionHarness({
      permissionGuard: { registerPolicy: () => () => {}, check },
      action: {
        ...testAction,
        manifest: {
          ...testAction.manifest,
          authorization: "none",
          previousOutputs: "none",
          resultPersistence: "raw",
        },
        execute: async ({ previousOutputs }) => {
          observedPreviousOutputs = previousOutputs
          return {
            status: "success",
            logs: [{ label: "stderr", value: "Authorization: Bearer visible-log" }],
            outputs: { result: { apiKey: "visible-result" } },
          }
        },
      },
    })

    const run = await harness.service.runItem(harness.item, "manual")

    expect(check).not.toHaveBeenCalled()
    expect(observedPreviousOutputs).toBeUndefined()
    expect(run.result).toEqual({
      status: "success",
      logs: [{ label: "stderr", value: "Authorization: Bearer visible-log" }],
      outputs: { result: { apiKey: "visible-result" } },
    })
    expect(harness.auditEvents).toEqual([])
  })

  it("omits run content only when the Action policy field is false", async () => {
    const harness = await createExecutionHarness({
      action: {
        ...testAction,
        manifest: {
          ...testAction.manifest,
          automationPolicy: {
            runContentPersistenceConfigField: "saveRunContent",
          },
        },
        execute: async () => ({
          status: "success",
          summary: "ok",
          logs: [{ label: "stdout", value: "visible live log" }],
          outputs: { result: { value: 42 } },
          usage: { tokens: 3 },
        }),
      },
    })
    const item = {
      ...harness.item,
      executor: {
        ...harness.item.executor,
        config: {
          ...harness.item.executor.config,
          saveRunContent: false,
        },
      },
    }

    const run = await harness.service.runItem(item, "manual")

    expect(run.result).toEqual({
      status: "success",
      summary: "ok",
      logs: undefined,
      outputs: undefined,
      usage: undefined,
    })
  })

  it("persists denied permission as a failed run", async () => {
    const harness = await createExecutionHarness({
      permissionGuard: permissionGuard({ allowed: false, reason: "denied by test" }),
    })

    const run = await harness.service.runItem(harness.item, "manual")

    expect(run.status).toBe("failed")
    expect(run.error).toBe("denied by test")
    expect(run.result).toEqual({
      status: "failed",
      error: "denied by test",
      summary: "执行失败",
    })
    expect(harness.auditEvents).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        outcome: "denied",
      }),
    ])
  })

  it("audits permission guard exceptions before the executor starts", async () => {
    const harness = await createExecutionHarness({
      permissionGuard: {
        registerPolicy: () => () => {},
        check: async () => {
          throw new Error("permission backend failed token=secret-value at /Users/liyang/private")
        },
      },
    })

    const run = await harness.service.runItem(harness.item, "trigger")

    expect(run.status).toBe("failed")
    expect(run.error).toBe("执行失败（Error）")
    expect(harness.auditEvents).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        outcome: "failed",
        metadata: expect.objectContaining({
          source: "automation",
          automationId: "automation:1",
          runId: "automation-run:1",
          triggerType: "builtin.cron",
          executorType: "builtin.test",
          triggeredBy: "trigger",
          boundary: "automation-pre-execution",
          status: "failed",
          errorName: "Error",
          errorLength: "permission backend failed token=secret-value at /Users/liyang/private".length,
        }),
      }),
    ])
    expect(JSON.stringify(harness.auditEvents)).not.toContain("secret-value")
    expect(JSON.stringify(harness.auditEvents)).not.toContain("/Users/liyang/private")
  })

  it("sanitizes persisted executor logs and outputs while preserving regular paths", async () => {
    const harness = await createExecutionHarness({
      action: {
        ...testAction,
        execute: async () => ({
          status: "success",
          summary: "Authorization: Bearer abc123 at /Users/example/repo",
          logs: [
            { label: "stdout", value: "token=sk-secret-value at /Users/example/repo" },
            { label: "stderr", value: "Cookie: session=session-secret" },
          ],
          outputs: {
            stdout: "--env API_KEY=plain-secret /Users/example/repo",
            nested: { token: "raw-token", filePath: "/Users/example/repo" },
          },
        }),
      },
    })

    const run = await harness.service.runItem(harness.item, "manual")
    const payload = JSON.stringify(run.result)

    expect(payload).not.toContain("abc123")
    expect(payload).not.toContain("sk-secret-value")
    expect(payload).not.toContain("session-secret")
    expect(payload).not.toContain("plain-secret")
    expect(payload).not.toContain("raw-token")
    expect(payload).toContain("[redacted]")
    expect(payload).toContain("/Users/example/repo")
  })

  it("cancels an active run by run id", async () => {
    let releaseAction: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const mayFinish = new Promise<void>((resolve) => {
      releaseAction = resolve
    })
    const harness = await createExecutionHarness({
      action: {
        ...testAction,
        execute: async () => {
          markStarted?.()
          await mayFinish
          return { status: "success", summary: "late ok" }
        },
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    })

    const running = harness.service.runItem(harness.item, "manual")
    await started

    expect(harness.service.stopRun("automation-run:1")).toBe(true)
    releaseAction?.()
    const run = await running

    expect(run.status).toBe("cancelled")
    expect(run.error).toBe("已停止")
    expect(await harness.items.get("automation:1")).toEqual(expect.objectContaining({
      lastStatus: "cancelled",
    }))
  })
})

async function createExecutionHarness(options: {
  readonly action?: RegisteredMainActionDefinition<TestActionConfig>
  readonly logger?: {
    info?: (message: string, metadata: Record<string, unknown>) => void
    warn: (message: string, metadata: Record<string, unknown>) => void
  }
  readonly permissionGuard?: PermissionGuard
} = {}) {
  const triggers = createBuiltinAutomationTriggerRegistry()
  const items = new AutomationItemRepository({
    items: new MemoryNamespace<AutomationItem>("automation.items"),
    triggers,
    now: () => new Date("2026-06-03T00:00:00.000Z"),
    idFactory: () => "automation:1",
  })
  const runs = new AutomationRunRepository({
    runs: new MemoryNamespace<AutomationRun>("automation.runs"),
    now: () => new Date("2026-06-03T00:01:00.000Z"),
    idFactory: () => "automation-run:1",
  })
  const item = await items.create({
    name: "Daily report",
    scope: { type: "global" },
    trigger: {
      type: "builtin.cron",
      config: { expr: "0 9 * * *" },
    },
    executor: { type: "builtin.test", config: { message: "ok" } },
  })
  const actions = new MainActionRegistry()
  actions.register(options.action ?? testAction)
  const auditEvents: Parameters<AuditSink["record"]>[0][] = []
  const service = new AutomationExecutionService({
    items,
    runs,
    actions,
    permissionGuard: options.permissionGuard ?? permissionGuard({ allowed: true }),
    auditSink: {
      record: (event: Parameters<AuditSink["record"]>[0]) => {
        auditEvents.push(event)
      },
      list: () => [],
      clearForTests: () => {},
    },
    defaultCwd: "/tmp",
    logger: options.logger ?? { warn: () => {} },
  })
  return { service, item, items, runs, auditEvents }
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

function permissionGuard(result: Awaited<ReturnType<PermissionGuard["check"]>>): PermissionGuard {
  return {
    registerPolicy: () => () => {},
    check: async () => result,
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
