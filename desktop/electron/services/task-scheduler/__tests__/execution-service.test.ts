import { z } from "zod"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../log-store", () => ({
  createMainLogger: () => ({ warn: vi.fn() }),
}))

import { MainActionRegistry, type MainActionDefinition } from "../../../action-runtime/action-registry"
import { ControlledProcessPermissionError } from "../../../runtime/process"
import type { DataChangeListener, DataNamespace } from "../../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import { TaskSchedulerExecutionService } from "../execution-service"
import { ScheduledTaskRunRepository } from "../run-repository"
import { ScheduledTaskRepository } from "../task-repository"
import type {
  ScheduledTaskEntry,
  ScheduledTaskRunEntry,
} from "../types"

const testActionSchema = z.object({ message: z.string().min(1) })
type TestActionConfig = z.infer<typeof testActionSchema>

describe("TaskSchedulerExecutionService", () => {
  it("records action output and updates task run metadata", async () => {
    const harness = await createExecutionHarness()

    const run = await harness.service.runTask(harness.task, "manual")

    expect(run.status).toBe("success")
    expect(run.result).toEqual({
      status: "success",
      summary: "ok",
      outputs: { stdout: "ok" },
    })
    expect(await harness.tasks.get("task:1")).toEqual(expect.objectContaining({
      runCount: 1,
      lastStatus: "success",
    }))
    expect(harness.auditEvents).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        outcome: "allowed",
      }),
    ])
  })

  it("logs successful action completion without recording raw result content", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() }
    const harness = await createExecutionHarness({
      action: sensitiveSuccessAction,
      logger,
    })

    const run = await harness.service.runTask(harness.task, "schedule")

    expect(run.status).toBe("success")
    expect(logger.info).toHaveBeenCalledWith(
      "Scheduled task action completed.",
      expect.objectContaining({
        source: "task-scheduler",
        taskId: "task:1",
        runId: "run:1",
        actionType: "builtin.test",
        triggeredBy: "schedule",
        boundary: "task-scheduler-action",
        status: "success",
        hasOutputs: true,
        summaryLength: "completed secret prompt token=sk-secret".length,
      }),
    )
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("secret prompt")
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("/Users/example")
  })

  it("records failed run when action permission is denied", async () => {
    const harness = await createExecutionHarness({
      permissionGuard: permissionGuard({ allowed: false, reason: "denied by test" }),
    })

    const run = await harness.service.runTask(harness.task, "manual")

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

  it("uses connector actor for tasks created by external scheduler capabilities", async () => {
    const harness = await createExecutionHarness({
      taskPatch: {
        provenance: { source: "mcp-stdio" },
      },
    })

    await harness.service.runTask(harness.task, "schedule")

    expect(harness.permissionRequests[0]).toEqual(expect.objectContaining({
      actor: { kind: "connector", id: "scheduler:mcp-stdio" },
    }))
    expect(harness.auditEvents[0]).toEqual(expect.objectContaining({
      actor: { kind: "connector", id: "scheduler:mcp-stdio" },
      metadata: expect.objectContaining({
        taskSource: "mcp-stdio",
      }),
    }))
  })

  it("persists inner process permission denial reasons without raw secrets", async () => {
    const harness = await createExecutionHarness({
      action: innerPermissionDeniedAction,
    })

    const run = await harness.service.runTask(harness.task, "manual")

    expect(run.status).toBe("failed")
    expect(run.error).toBe("执行失败：blocked command [path] token=[redacted]")
    expect(run.result?.error).toBe("执行失败：blocked command [path] token=[redacted]")
    expect(run.error).not.toContain("ControlledProcessPermissionError")
    expect(JSON.stringify(run)).not.toContain("/Users/example")
    expect(JSON.stringify(run)).not.toContain("sk-secret")
  })

  it("logs permission guard exceptions before the action starts", async () => {
    const logger = { warn: vi.fn() }
    const harness = await createExecutionHarness({
      logger,
      permissionGuard: {
        registerPolicy: () => () => {},
        check: async () => {
          throw new Error("permission backend leaked secret prompt")
        },
      },
    })

    const run = await harness.service.runTask(harness.task, "schedule")

    expect(run.status).toBe("failed")
    expect(run.error).toBe("执行失败（Error）")
    expect(run.result?.error).toBe("执行失败（Error）")
    expect(logger.warn).toHaveBeenCalledWith(
      "Scheduled task preparation failed.",
      expect.objectContaining({
        source: "task-scheduler",
        boundary: "task-scheduler-pre-execution",
        taskId: "task:1",
        runId: "run:1",
        actionType: "builtin.test",
        triggeredBy: "schedule",
        status: "failed",
        errorName: "Error",
        errorLength: "permission backend leaked secret prompt".length,
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret prompt")
    expect(JSON.stringify(run)).not.toContain("secret prompt")
  })

  it("records action exceptions with audit and log context", async () => {
    const logger = { warn: vi.fn() }
    const harness = await createExecutionHarness({
      action: throwingAction,
      logger,
    })

    const run = await harness.service.runTask(harness.task, "schedule")

    expect(run.status).toBe("failed")
    expect(run.error).toBe("执行失败（Error）")
    expect(run.result).toEqual({
      status: "failed",
      error: "执行失败（Error）",
      summary: "执行失败",
    })
    expect(harness.auditEvents).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        outcome: "allowed",
      }),
      expect.objectContaining({
        action: "shell.exec",
        outcome: "failed",
        metadata: expect.objectContaining({
          source: "task-scheduler",
          taskId: "task:1",
          runId: "run:1",
          actionType: "builtin.test",
          triggeredBy: "schedule",
          boundary: "task-scheduler-action",
          status: "failed",
          errorName: "Error",
          errorLength: "sdk unavailable for secret prompt".length,
        }),
      }),
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      "Scheduled task action threw.",
      expect.objectContaining({
        source: "task-scheduler",
        taskId: "task:1",
        runId: "run:1",
        actionType: "builtin.test",
        triggeredBy: "schedule",
        boundary: "task-scheduler-action",
        status: "failed",
        errorName: "Error",
        errorLength: "sdk unavailable for secret prompt".length,
      }),
    )
    expect(JSON.stringify(harness.auditEvents)).not.toContain("secret prompt")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret prompt")
    expect(JSON.stringify(run)).not.toContain("secret prompt")
  })

  it("retries failed-run persistence and still marks task result after action exceptions", async () => {
    const logger = { warn: vi.fn() }
    const harness = await createExecutionHarness({
      action: throwingAction,
      logger,
    })
    const finish = vi.spyOn(harness.runs, "finish")
    finish.mockRejectedValueOnce(new Error("data namespace busy"))

    const run = await harness.service.runTask(harness.task, "schedule")

    expect(finish).toHaveBeenCalledTimes(2)
    expect(run.status).toBe("failed")
    expect(await harness.runs.get("run:1")).toEqual(expect.objectContaining({
      status: "failed",
      error: "执行失败（Error）",
    }))
    expect(await harness.tasks.get("task:1")).toEqual(expect.objectContaining({
      lastStatus: "failed",
      runCount: 1,
    }))
    expect(logger.warn).toHaveBeenCalledWith(
      "runs.finish failed after failed task execution; retrying once.",
      expect.objectContaining({
        source: "task-scheduler",
        taskId: "task:1",
        runId: "run:1",
        status: "failed",
        errorName: "Error",
        errorLength: "data namespace busy".length,
      }),
    )
  })

  it("records returned action failures without leaking raw error text", async () => {
    const logger = { warn: vi.fn() }
    const harness = await createExecutionHarness({
      action: failedResultAction,
      logger,
    })

    const run = await harness.service.runTask(harness.task, "schedule")

    expect(run.status).toBe("failed")
    expect(run.error).toBe("执行失败：sdk failed for token=[redacted] at [path] prompt")
    expect(run.result?.error).toBe("执行失败：sdk failed for token=[redacted] at [path] prompt")
    expect(harness.auditEvents).toEqual([
      expect.objectContaining({
        action: "shell.exec",
        outcome: "allowed",
      }),
      expect.objectContaining({
        action: "shell.exec",
        outcome: "failed",
        metadata: expect.objectContaining({
          source: "task-scheduler",
          taskId: "task:1",
          runId: "run:1",
          actionType: "builtin.test",
          triggeredBy: "schedule",
          boundary: "task-scheduler-action",
          status: "failed",
          errorName: "action_error",
          errorLength: "sdk failed for token=sk-secret at /Users/example/repo prompt".length,
        }),
      }),
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      "Scheduled task action failed.",
      expect.objectContaining({
        source: "task-scheduler",
        taskId: "task:1",
        runId: "run:1",
        actionType: "builtin.test",
        triggeredBy: "schedule",
        boundary: "task-scheduler-action",
        status: "failed",
        errorName: "action_error",
        errorLength: "sdk failed for token=sk-secret at /Users/example/repo prompt".length,
      }),
    )
    expect(JSON.stringify(harness.auditEvents)).not.toContain("secret prompt")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret prompt")
    expect(JSON.stringify(run)).not.toContain("sk-secret")
    expect(JSON.stringify(run)).not.toContain("/Users/example")
    expect(JSON.stringify(run)).not.toContain("sdk failed for token=sk-secret at /Users/example/repo prompt")
  })

  it("passes task configVersion through action context", async () => {
    let observedContext: { configVersion?: number } | undefined
    const spyAction: MainActionDefinition<TestActionConfig> = {
      ...testAction,
      execute: async ({ context }) => {
        observedContext = context
        return { status: "success", summary: "ok" }
      },
    }
    const harness = await createExecutionHarness({ action: spyAction })

    await harness.service.runTask(harness.task, "manual")

    expect(observedContext?.configVersion).toBe(0)
  })

  it("passes the latest successful outputs after more than ten recent non-success runs", async () => {
    const previousOutputs = { conversationId: "conversation-success" }
    let observedPreviousOutputs: Record<string, unknown> | undefined
    const spyAction: MainActionDefinition<TestActionConfig> = {
      ...testAction,
      execute: async ({ previousOutputs }) => {
        observedPreviousOutputs = previousOutputs
        return { status: "success", summary: "ok" }
      },
    }
    const harness = await createExecutionHarness({ action: spyAction })
    const recentFailures = Array.from({ length: 10 }, (_, index): ScheduledTaskRunEntry => ({
      id: `run:failed:${index}`,
      schemaVersion: 2,
      taskId: harness.task.id,
      startedAt: `2026-04-29T00:${String(59 - index).padStart(2, "0")}:00.000Z`,
      status: "failed",
      triggeredBy: "schedule",
      result: {
        status: "failed",
        summary: "failed",
      },
    }))
    const olderSuccess: ScheduledTaskRunEntry = {
      id: "run:success",
      schemaVersion: 2,
      taskId: harness.task.id,
      startedAt: "2026-04-29T00:40:00.000Z",
      status: "success",
      triggeredBy: "schedule",
      result: {
        status: "success",
        summary: "ok",
        outputs: previousOutputs,
      },
    }
    const runHistory = [...recentFailures, olderSuccess]
    const listByTask = vi.spyOn(harness.runs, "listByTask").mockImplementation(async (_taskId, options) => {
      if (options?.limit === undefined) return runHistory
      return runHistory.slice(0, options.limit)
    })

    await harness.service.runTask(harness.task, "manual")

    expect(observedPreviousOutputs).toEqual(previousOutputs)
    expect(listByTask).toHaveBeenCalledWith(harness.task.id)
  })

  it("keeps stopped runs cancelled when an action resolves successfully after abort", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() }
    let releaseAction: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const mayFinish = new Promise<void>((resolve) => {
      releaseAction = resolve
    })
    let observedSignal: AbortSignal | undefined
    const lateSuccessAction: MainActionDefinition<TestActionConfig> = {
      ...testAction,
      execute: async ({ context }) => {
        observedSignal = context.abortSignal
        markStarted?.()
        await mayFinish
        return {
          status: "success",
          summary: "late ok",
          outputs: { stdout: "late ok" },
        }
      },
    }
    const harness = await createExecutionHarness({
      action: lateSuccessAction,
      logger,
    })

    const running = harness.service.runTask(harness.task, "manual")
    await started
    expect(observedSignal?.aborted).toBe(false)

    expect(harness.service.stopRun("run:1")).toBe(true)
    expect(observedSignal?.aborted).toBe(true)
    releaseAction?.()
    const run = await running

    expect(run.status).toBe("cancelled")
    expect(run.error).toBe("已停止")
    expect(run.result).toEqual({
      status: "cancelled",
      error: "已停止",
      summary: "已停止",
    })
    expect(await harness.tasks.get("task:1")).toEqual(expect.objectContaining({
      lastStatus: "cancelled",
    }))
    expect(logger.info).not.toHaveBeenCalledWith("Scheduled task action completed.", expect.anything())
    expect(logger.warn).toHaveBeenCalledWith(
      "Scheduled task action threw.",
      expect.objectContaining({
        source: "task-scheduler",
        taskId: "task:1",
        runId: "run:1",
        actionType: "builtin.test",
        triggeredBy: "manual",
        boundary: "task-scheduler-action",
        status: "cancelled",
      }),
    )
  })

  it("persistableActionError handles undefined error gracefully", async () => {
    const harness = await createExecutionHarness({
      action: {
        ...testAction,
        execute: async () => ({ status: "failed", summary: "no error field" }),
      },
    })
    const run = await harness.service.runTask(harness.task, "manual")
    expect(run.status).toBe("failed")
    expect(run.result?.error).toBeUndefined()
  })

  it("persistableActionError handles empty error string", async () => {
    const harness = await createExecutionHarness({
      action: {
        ...testAction,
        execute: async () => ({ status: "failed", error: "", summary: "empty" }),
      },
    })
    const run = await harness.service.runTask(harness.task, "manual")
    expect(run.status).toBe("failed")
    expect(run.result?.error).toBe("")
  })

  it("persistableActionError handles whitespace-only error", async () => {
    const harness = await createExecutionHarness({
      action: {
        ...testAction,
        execute: async () => ({ status: "failed", error: "   ", summary: "blank" }),
      },
    })
    const run = await harness.service.runTask(harness.task, "manual")
    expect(run.status).toBe("failed")
    expect(run.result?.error).toMatch(/执行失败（\d+ 字）/)
  })

  it("persistableActionError truncates long errors at 120 characters", async () => {
    const longError = "x".repeat(200)
    const harness = await createExecutionHarness({
      action: {
        ...testAction,
        execute: async () => ({ status: "failed", error: longError, summary: "long" }),
      },
      logger: { warn: vi.fn() },
    })
    const run = await harness.service.runTask(harness.task, "manual")
    expect(run.status).toBe("failed")
    expect(run.result?.error).toBe(`执行失败：${"x".repeat(120)}...`)
    expect(run.result?.error!.length).toBe(120 + "执行失败：...".length)
  })

  it("persistableActionError redacts secrets from long errors before truncation", async () => {
    const error = `long error with token=sk-secret-key-12345 ${"x".repeat(120)}`
    const harness = await createExecutionHarness({
      action: {
        ...testAction,
        execute: async () => ({ status: "failed", error, summary: "long secret" }),
      },
      logger: { warn: vi.fn() },
    })
    const run = await harness.service.runTask(harness.task, "manual")
    expect(run.status).toBe("failed")
    expect(run.result?.error).not.toContain("sk-secret-key-12345")
    expect(JSON.stringify(run)).not.toContain("sk-secret-key-12345")
  })
})

async function createExecutionHarness(options: {
  readonly action?: MainActionDefinition<TestActionConfig>
  readonly logger?: {
    info?: (message: string, metadata: Record<string, unknown>) => void
    warn: (message: string, metadata: Record<string, unknown>) => void
  }
  readonly permissionGuard?: PermissionGuard
  readonly taskPatch?: Partial<ScheduledTaskEntry>
} = {}) {
  const tasks = new ScheduledTaskRepository({
    tasks: new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks"),
    now: () => new Date("2026-04-29T00:00:00.000Z"),
    idFactory: () => "task:1",
  })
  const runs = new ScheduledTaskRunRepository({
    runs: new MemoryNamespace<ScheduledTaskRunEntry>("task-scheduler.runs"),
    now: () => new Date("2026-04-29T00:01:00.000Z"),
    idFactory: () => "run:1",
  })
  let task = await tasks.create({
    name: "Build",
    scope: { type: "global" },
    trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
    action: { type: "builtin.test", config: { message: "ok" } },
  })
  if (options.taskPatch) {
    task = { ...task, ...options.taskPatch }
  }
  const actions = new MainActionRegistry()
  actions.register(options.action ?? testAction)
  const auditEvents: Parameters<AuditSink["record"]>[0][] = []
  const permissionRequests: Parameters<PermissionGuard["check"]>[0][] = []
  const delegatePermissionGuard = options.permissionGuard ?? permissionGuard({ allowed: true })
  const deps = {
    tasks,
    runs,
    actions,
    permissionGuard: {
      registerPolicy: delegatePermissionGuard.registerPolicy.bind(delegatePermissionGuard),
      check: async (request: Parameters<PermissionGuard["check"]>[0]) => {
        permissionRequests.push(request)
        return delegatePermissionGuard.check(request)
      },
    },
    auditSink: {
      record: (event: Parameters<AuditSink["record"]>[0]) => {
        auditEvents.push(event)
      },
      list: () => [],
      clearForTests: () => {},
    },
    defaultCwd: "/tmp",
    logger: options.logger ?? { warn: () => {} },
  }
  const service = new TaskSchedulerExecutionService(deps)
  return { service, task, tasks, runs, auditEvents, permissionRequests }
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

const throwingAction: MainActionDefinition<TestActionConfig> = {
  ...testAction,
  execute: async () => {
    throw new Error("sdk unavailable for secret prompt")
  },
}

const sensitiveSuccessAction: MainActionDefinition<TestActionConfig> = {
  ...testAction,
  execute: async () => ({
    status: "success",
    summary: "completed secret prompt token=sk-secret",
    outputs: { stdout: "/Users/example/repo" },
  }),
}

const failedResultAction: MainActionDefinition<TestActionConfig> = {
  ...testAction,
  execute: async () => ({
    status: "failed",
    error: "sdk failed for token=sk-secret at /Users/example/repo prompt",
    summary: "failed",
  }),
}

const innerPermissionDeniedAction: MainActionDefinition<TestActionConfig> = {
  ...testAction,
  execute: async () => {
    throw new ControlledProcessPermissionError({
      allowed: false,
      reason: "blocked command /Users/example/repo token=sk-secret",
      policyId: "inner-policy",
    })
  },
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
