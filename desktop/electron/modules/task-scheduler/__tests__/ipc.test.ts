import { describe, expect, it, vi } from "vitest"

import { createInMemoryHarness, type IpcHandlerContext } from "../../../runtime/ipc"
import { taskSchedulerIpcModule } from "../ipc"

describe("taskSchedulerIpcModule", () => {
  it("routes task CRUD and run calls", async () => {
    const service = {
      listTasks: vi.fn(async () => []),
      getTask: vi.fn(async () => null),
      createTask: vi.fn(async (input) => ({
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
      updateTask: vi.fn(async (_id, patch) => ({
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
      setTaskEnabled: vi.fn(async (_id, enabled) => ({
        id: "task:1",
        schemaVersion: 2,
        name: "Build",
        scope: { type: "global" },
        trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
        action: { type: "builtin.command", config: { command: "echo ok", shell: "posix", timeoutMins: 30 } },
        enabled,
        missedRunPolicy: "skip",
        overlapPolicy: "skip",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
        runCount: 0,
      })),
      runTaskNow: vi.fn(async () => null),
      stopRun: vi.fn(() => ({ stopped: true })),
      listRuns: vi.fn(async () => []),
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

    expect(service.createTask).toHaveBeenCalled()
    expect(service.updateTask).toHaveBeenCalledWith("task:1", { enabled: false })
    expect(service.runTaskNow).toHaveBeenCalledWith("task:1")
    expect(service.listRuns).toHaveBeenCalledWith("task:1", { limit: undefined })
  })
})
