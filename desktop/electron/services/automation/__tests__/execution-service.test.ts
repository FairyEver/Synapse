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
      config: { expr: "0 9 * * *", activeDays: [0, 1, 2, 3, 4, 5, 6] },
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
