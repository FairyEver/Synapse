import { describe, expect, it, vi } from "vitest"

import { swarmTaskIpcModule } from "../ipc"

describe("swarmTaskIpcModule", () => {
  it("defines stable channels", () => {
    expect(swarmTaskIpcModule.id).toBe("swarmTask")
    expect(swarmTaskIpcModule.methods.listTasks.channel).toBe("synapse:swarm-task:tasks:list")
    expect(swarmTaskIpcModule.methods.createTask.channel).toBe("synapse:swarm-task:tasks:create")
    expect(swarmTaskIpcModule.methods.updateTask.channel).toBe("synapse:swarm-task:tasks:update")
    expect(swarmTaskIpcModule.methods.deleteTask.channel).toBe("synapse:swarm-task:tasks:delete")
    expect(swarmTaskIpcModule.methods.startRun.channel).toBe("synapse:swarm-task:runs:start")
    expect(swarmTaskIpcModule.methods.stopRefill.channel).toBe("synapse:swarm-task:runs:stop-refill")
    expect(swarmTaskIpcModule.methods.cancelRun.channel).toBe("synapse:swarm-task:runs:cancel")
    expect(swarmTaskIpcModule.methods.listRuns.channel).toBe("synapse:swarm-task:runs:list")
    expect(swarmTaskIpcModule.methods.getRun.channel).toBe("synapse:swarm-task:runs:get")
    expect(swarmTaskIpcModule.methods.listWorkerRuns.channel).toBe("synapse:swarm-task:worker-runs:list")
  })

  it("routes task and run calls to the service", async () => {
    const service = {
      listTasks: vi.fn(async () => []),
      createTask: vi.fn(async (input) => ({ id: "task-1", ...input })),
      updateTask: vi.fn(async (input) => ({ id: input.taskId, schemaVersion: 1, ...input.patch })),
      deleteTask: vi.fn(async () => undefined),
      startRun: vi.fn(async () => ({ id: "run-1" })),
      stopRefill: vi.fn(async () => null),
      cancelRun: vi.fn(async () => null),
      listRuns: vi.fn(async () => []),
      getRun: vi.fn(async () => null),
      listWorkerRuns: vi.fn(async () => []),
    }
    const ctx = {
      resolve: (id: string) => {
        if (id === "core.swarm-task") return service
        throw new Error(id)
      },
    }

    await swarmTaskIpcModule.methods.listTasks.handler(ctx as never, undefined)
    await swarmTaskIpcModule.methods.createTask.handler(ctx as never, {
      name: "Task",
      config: {
        projectId: "project-1",
        workspacePath: "/tmp/project-1",
        prompt: "Do work",
      },
    })
    await swarmTaskIpcModule.methods.updateTask.handler(ctx as never, {
      taskId: "task-1",
      patch: { name: "Updated" },
    })
    await swarmTaskIpcModule.methods.deleteTask.handler(ctx as never, { taskId: "task-1" })
    await swarmTaskIpcModule.methods.startRun.handler(ctx as never, { taskId: "task-1" })
    await swarmTaskIpcModule.methods.stopRefill.handler(ctx as never, { runId: "run-1" })
    await swarmTaskIpcModule.methods.cancelRun.handler(ctx as never, { runId: "run-1" })
    await swarmTaskIpcModule.methods.listRuns.handler(ctx as never, { taskId: "task-1", limit: 5 })
    await swarmTaskIpcModule.methods.getRun.handler(ctx as never, { runId: "run-1" })
    await swarmTaskIpcModule.methods.listWorkerRuns.handler(ctx as never, { runId: "run-1" })

    expect(service.listTasks).toHaveBeenCalled()
    expect(service.createTask).toHaveBeenCalledWith({
      name: "Task",
      config: {
        projectId: "project-1",
        workspacePath: "/tmp/project-1",
        prompt: "Do work",
      },
    })
    expect(service.updateTask).toHaveBeenCalledWith({
      taskId: "task-1",
      patch: { name: "Updated" },
    })
    expect(service.deleteTask).toHaveBeenCalledWith("task-1")
    expect(service.startRun).toHaveBeenCalledWith({ taskId: "task-1" })
    expect(service.stopRefill).toHaveBeenCalledWith("run-1")
    expect(service.cancelRun).toHaveBeenCalledWith("run-1")
    expect(service.listRuns).toHaveBeenCalledWith("task-1", 5)
    expect(service.getRun).toHaveBeenCalledWith("run-1")
    expect(service.listWorkerRuns).toHaveBeenCalledWith("run-1")
  })
})
