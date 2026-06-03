import { describe, expect, it, vi } from "vitest"

const logStoreMock = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { createInMemoryHarness, type IpcHandlerContext } from "../../../runtime/ipc"
import { automationIpcModule } from "../ipc"

vi.mock("../../../services/log-store", () => ({
  createMainLogger: vi.fn(() => logStoreMock.logger),
}))

describe("automationIpcModule", () => {
  it("declares automation editor window methods", () => {
    expect(automationIpcModule.methods.openCreateEditorWindow.channel).toBe("synapse:automation:editor:open-create")
    expect(automationIpcModule.methods.openCreateEditorWindow.request?.safeParse(undefined).success).toBe(true)
    expect(automationIpcModule.methods.openEditorWindow.channel).toBe("synapse:automation:editor:open-edit")
    expect(automationIpcModule.methods.openEditorWindow.request?.parse({ automationId: "automation:1" })).toEqual({
      automationId: "automation:1",
    })
  })

  it("declares an automation changed event", () => {
    expect(automationIpcModule.events.changed.channel).toBe("synapse:events:automation")
    expect(automationIpcModule.events.changed.payload.parse({
      domain: "automation",
      type: "automation.itemChanged",
      payload: {
        automationId: "automation:1",
        runId: "automation-run:1",
        reason: "run-finished",
      },
      timestamp: "2026-06-03T00:00:00.000Z",
    })).toMatchObject({
      payload: {
        automationId: "automation:1",
        runId: "automation-run:1",
      },
    })
  })

  it("routes automation CRUD and run calls", async () => {
    const service = {
      automationList: vi.fn(async () => []),
      automationGet: vi.fn(async () => null),
      automationCreate: vi.fn(async (input) => automationItem({ ...input, enabled: input.enabled ?? true })),
      automationUpdate: vi.fn(async (_id, patch) => automationItem({
        ...defaultAutomationInput(),
        ...patch,
      })),
      automationDelete: vi.fn(async () => ({ deleted: true })),
      automationEnable: vi.fn(async () => automationItem({ ...defaultAutomationInput(), enabled: true })),
      automationDisable: vi.fn(async () => automationItem({ ...defaultAutomationInput(), enabled: false })),
      runAutomationNow: vi.fn(async () => automationRun()),
      stopRun: vi.fn(async () => ({ stopped: true })),
      automationRunList: vi.fn(async () => [automationRun()]),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.automation") return service as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(automationIpcModule, { moduleId: "automation", resolve })

    expect(await harness.invoke("synapse:automation:items:list", undefined)).toEqual([])
    await harness.invoke("synapse:automation:items:create", defaultAutomationInput())
    await harness.invoke("synapse:automation:items:update", {
      id: "automation:1",
      patch: { enabled: false },
    })
    await harness.invoke("synapse:automation:items:set-enabled", {
      automationId: "automation:1",
      enabled: false,
    })
    await harness.invoke("synapse:automation:items:run", { automationId: "automation:1" })
    await harness.invoke("synapse:automation:runs:stop", { runId: "automation-run:1" })
    const runs = await harness.invoke("synapse:automation:runs:list", {
      automationId: "automation:1",
      limit: 20,
    })

    expect(service.automationCreate).toHaveBeenCalledWith(defaultAutomationInput())
    expect(service.automationUpdate).toHaveBeenCalledWith("automation:1", { enabled: false })
    expect(service.automationDisable).toHaveBeenCalledWith("automation:1")
    expect(service.runAutomationNow).toHaveBeenCalledWith("automation:1")
    expect(service.stopRun).toHaveBeenCalledWith("automation-run:1")
    expect(service.automationRunList).toHaveBeenCalledWith("automation:1", { limit: 20 })
    expect(runs).toEqual([
      expect.objectContaining({
        result: expect.objectContaining({
          usage: { input_tokens: 10 },
          costUsd: 0.01,
        }),
      }),
    ])
  })

  it("preserves active run and needs-update validation through list IPC validation", async () => {
    const service = {
      automationList: vi.fn(async () => [
        automationItem({
          ...defaultAutomationInput(),
          activeRun: { status: "running", id: "automation-run:1" },
          validation: {
            status: "needs_update",
            issues: [{ field: "executor.config", message: "检查执行内容" }],
          },
        }),
      ]),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.automation") return service as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(automationIpcModule, { moduleId: "automation", resolve })

    const items = await harness.invoke("synapse:automation:items:list", undefined) as Array<{
      activeRun?: { readonly status: "running"; readonly id?: string }
      validation?: { readonly status: string }
    }>

    expect(items[0]?.activeRun).toEqual({ status: "running", id: "automation-run:1" })
    expect(items[0]?.validation?.status).toBe("needs_update")
  })
})

function defaultAutomationInput() {
  return {
    name: "Daily report",
    scope: { type: "global" as const },
    trigger: {
      type: "builtin.interval" as const,
      config: {
        everyMinutes: 10,
        anchor: "created_at" as const,
        activeDays: [0, 1, 2, 3, 4, 5, 6],
      },
    },
    executor: {
      type: "builtin.command",
      config: { command: "echo ok", shell: "posix", timeoutMins: 30 },
    },
  }
}

function automationItem(input: ReturnType<typeof defaultAutomationInput> & {
  readonly enabled?: boolean
  readonly activeRun?: { readonly status: "running"; readonly id?: string }
  readonly validation?: {
    readonly status: "needs_update"
    readonly issues: readonly { readonly field: string; readonly message: string }[]
  }
}) {
  return {
    id: "automation:1",
    schemaVersion: 1,
    name: input.name,
    enabled: input.enabled ?? true,
    scope: input.scope,
    trigger: input.trigger,
    executor: input.executor,
    policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    runCount: 0,
    configVersion: 0,
    ...(input.activeRun ? { activeRun: input.activeRun } : {}),
    ...(input.validation ? { validation: input.validation } : {}),
  }
}

function automationRun() {
  return {
    id: "automation-run:1",
    schemaVersion: 1,
    automationId: "automation:1",
    startedAt: "2026-06-03T00:00:00.000Z",
    finishedAt: "2026-06-03T00:01:00.000Z",
    status: "success",
    triggeredBy: "manual",
    triggerType: "builtin.interval",
    executorType: "builtin.command",
    result: {
      status: "success",
      summary: "ok",
      usage: { input_tokens: 10 },
      costUsd: 0.01,
    },
  }
}
