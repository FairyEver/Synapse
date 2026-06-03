import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../log-store", () => ({
  createMainLogger: () => ({ warn: vi.fn() }),
}))

import {
  MainActionRegistry,
  type ActionExecutionInput,
  type MainActionDefinition,
} from "../../../action-runtime/action-registry"
import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { createBuiltinAutomationTriggerRegistry } from "../builtin-triggers"
import { AutomationExecutionService } from "../execution-service"
import { AutomationItemRepository } from "../item-repository"
import { AutomationRunRepository } from "../run-repository"
import type { AutomationItem, AutomationRun } from "../types"

const testActionSchema = z.object({ message: z.string().min(1) })
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
  readonly action?: MainActionDefinition<TestActionConfig>
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
