import { describe, expect, it, vi } from "vitest"

const logStoreMock = vi.hoisted(() => ({
  logger: {
    warn: vi.fn(),
  },
}))

import { createInMemoryHarness, type IpcHandlerContext } from "../../../runtime/ipc"
import { taskSchedulerIpcModule } from "../ipc"

vi.mock("../../../services/log-store", () => ({
  createMainLogger: vi.fn(() => logStoreMock.logger),
}))

describe("taskSchedulerIpcModule", () => {
  it("routes task CRUD and run calls", async () => {
    const service = {
      schedulerTaskList: vi.fn(async () => []),
      schedulerTaskGet: vi.fn(async () => null),
      schedulerTaskCreate: vi.fn(async (input) => ({
        id: "task:1",
        schemaVersion: 2,
        ...input,
        enabled: true,
        missedRunPolicy: "skip",
        overlapPolicy: "skip",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
        runCount: 0,
      })),
      schedulerTaskUpdate: vi.fn(async (_id, patch) => ({
        id: "task:1",
        schemaVersion: 2,
        name: "Build",
        scope: { type: "global" },
        trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
        action: { type: "builtin.command", config: { command: "echo ok", shell: "posix", timeoutMins: 30 } },
        enabled: true,
        missedRunPolicy: "skip",
        overlapPolicy: "skip",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
        runCount: 0,
        ...patch,
      })),
      deleteTask: vi.fn(async () => ({ deleted: true })),
      schedulerTaskEnable: vi.fn(async (_id) => ({
        id: "task:1",
        schemaVersion: 2,
        name: "Build",
        scope: { type: "global" },
        trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
        action: { type: "builtin.command", config: { command: "echo ok", shell: "posix", timeoutMins: 30 } },
        enabled: true,
        missedRunPolicy: "skip",
        overlapPolicy: "skip",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
        runCount: 0,
      })),
      schedulerTaskDisable: vi.fn(async (_id) => ({
        id: "task:1",
        schemaVersion: 2,
        name: "Build",
        scope: { type: "global" },
        trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
        action: { type: "builtin.command", config: { command: "echo ok", shell: "posix", timeoutMins: 30 } },
        enabled: false,
        missedRunPolicy: "skip",
        overlapPolicy: "skip",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
        runCount: 0,
      })),
      runTaskNow: vi.fn(async () => null),
      stopRun: vi.fn(() => ({ stopped: true })),
      schedulerRunList: vi.fn(async () => []),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.task-scheduler") return service as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(taskSchedulerIpcModule, { moduleId: "task-scheduler", resolve })

    expect(await harness.invoke("synapse:task-scheduler:tasks:list", undefined)).toEqual([])
    await harness.invoke("synapse:task-scheduler:tasks:create", {
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
      action: { type: "builtin.command", config: { command: "echo ok", shell: "posix", timeoutMins: 30 } },
    })
    await harness.invoke("synapse:task-scheduler:tasks:update", {
      id: "task:1",
      patch: { enabled: false },
    })
    await harness.invoke("synapse:task-scheduler:tasks:run", { taskId: "task:1" })
    await harness.invoke("synapse:task-scheduler:runs:list", { taskId: "task:1" })

    expect(service.schedulerTaskCreate).toHaveBeenCalled()
    expect(service.schedulerTaskUpdate).toHaveBeenCalledWith("task:1", { enabled: false })
    expect(service.runTaskNow).toHaveBeenCalledWith("task:1")
    expect(service.schedulerRunList).toHaveBeenCalledWith("task:1", { limit: undefined })
  })

  it("logs manual run failures with sanitized IPC context", async () => {
    const service = {
      runTaskNow: vi.fn(async () => {
        throw new Error("failed with prompt text and token=sk-test")
      }),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.task-scheduler") return service as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(taskSchedulerIpcModule, { moduleId: "task-scheduler", resolve })

    await expect(harness.invoke("synapse:task-scheduler:tasks:run", {
      taskId: "task:agent-1",
    })).rejects.toThrow("failed with prompt text")

    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "Task scheduler manual run IPC failed.",
      expect.objectContaining({
        boundary: "task-scheduler.ipc.run-task",
        channel: "synapse:task-scheduler:tasks:run",
        taskId: "task:agent-1",
        durationMs: expect.any(Number),
        errorName: "Error",
        errorLength: "failed with prompt text and token=sk-test".length,
      }),
    )
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("prompt text")
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("sk-test")
  })
})
