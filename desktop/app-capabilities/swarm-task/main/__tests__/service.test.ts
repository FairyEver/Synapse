import { describe, expect, it, vi } from "vitest"

import type { AgentMessage, AgentRuntimeService } from "../../../../electron/services/agent-runtime"
import { createAgentRuntimeSwarmGateway, createSwarmTaskService, type SwarmAgentGateway } from "../service"
import type { SwarmRun, SwarmTask, SwarmWorkerRun } from "../../shared/schema"

function namespace<T extends { id: string }>() {
  const items = new Map<string, T>()
  return {
    async list(filter?: Partial<T>): Promise<T[]> {
      const values = [...items.values()]
      if (!filter) return values
      return values.filter((item) =>
        Object.entries(filter).every(([key, value]) => item[key as keyof T] === value))
    },
    async get(id: string): Promise<T | null> {
      return items.get(id) ?? null
    },
    async upsert(value: T): Promise<void> {
      items.set(value.id, value)
    },
    async remove(id: string): Promise<void> {
      items.delete(id)
    },
  }
}

function terminalRaceRun(initialRun: SwarmRun, terminalStatus: Extract<SwarmRun["status"], "success" | "failed">) {
  let armed = true
  let terminalSnapshot: SwarmRun | null = null
  const items = new Map<string, SwarmRun>()
  const liveRun = { ...initialRun }

  Object.defineProperty(liveRun, "status", {
    configurable: true,
    enumerable: true,
    get() {
      if (armed) {
        armed = false
        terminalSnapshot = {
          ...initialRun,
          status: terminalStatus,
          stopRequested: false,
          finishedAt: "2026-07-07T00:00:00.000Z",
        }
        items.set(initialRun.id, terminalSnapshot)
      }
      return "running"
    },
  })

  items.set(initialRun.id, liveRun)

  return {
    async list(filter?: Partial<SwarmRun>): Promise<SwarmRun[]> {
      const values = [...items.values()]
      if (!filter) return values
      return values.filter((item) =>
        Object.entries(filter).every(([key, value]) => item[key as keyof SwarmRun] === value))
    },
    async get(id: string): Promise<SwarmRun | null> {
      return items.get(id) ?? null
    },
    async upsert(value: SwarmRun): Promise<void> {
      items.set(value.id, value)
    },
    async remove(id: string): Promise<void> {
      items.delete(id)
    },
    terminalSnapshot() {
      return terminalSnapshot
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const config = {
  projectId: "project-1",
  prompt: "Run.",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    parallelContext: true,
    customAppendix: "",
  },
  runMode: "batch" as const,
  concurrency: 2,
  maxRounds: 2,
  summary: { enabled: true, injectRecent: false, recentLimit: 3 },
  handoff: { enabled: false },
  summaryFile: { enabled: false, path: "" },
  agent: {},
}

function serviceHarness(options?: {
  agent?: Partial<SwarmAgentGateway>
  eventBus?: { emit: ReturnType<typeof vi.fn> }
  workers?: ReturnType<typeof namespace<SwarmWorkerRun>>
  resolveProjectPath?: (projectId: string) => Promise<string>
}) {
  const tasks = namespace<SwarmTask>()
  const runs = namespace<SwarmRun>()
  const workers = options?.workers ?? namespace<SwarmWorkerRun>()
  const resolveProjectPath = vi.fn(options?.resolveProjectPath ?? (async (projectId: string) => {
    if (projectId === "project-1") return "/repo"
    throw new Error("项目不可用")
  }))
  const gateway: SwarmAgentGateway = {
    sendWorker: vi.fn(async () => ({
      conversationId: "conversation-1",
      resultText: "<SYNAPSE_SWARM_SUMMARY>\ndone\n</SYNAPSE_SWARM_SUMMARY>",
      status: "success",
      events: [],
    })),
    cancelConversation: vi.fn(async () => undefined),
    ...options?.agent,
  }
  const service = createSwarmTaskService({
    tasks,
    runs,
    workers,
    agent: gateway,
    eventBus: options?.eventBus,
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    idFactory: (() => {
      let index = 0
      return () => `id-${++index}`
    })(),
    outputRoot: "/repo/swarm-runs",
    resolveProjectPath,
  } as never)
  return { service, tasks, runs, workers, gateway, resolveProjectPath }
}

describe("createSwarmTaskService", () => {
  it("creates an Agent Runtime swarm gateway with swarm session metadata", async () => {
    const pendingResult = deferred<{
      conversationId: string
      resultText: string
      events: []
    }>()
    const publishedConversationIds: string[] = []
    const sendNewSession = vi.fn(async (_message, _name, options) => {
      options?.onConversationCreated?.({
        id: "conversation-1",
      } as never)
      return pendingResult.promise
    })
    const cancelTurn = vi.fn(async () => ({ status: "graceful-pending" as const }))
    const agent = {
      sendNewSession,
      cancelTurn,
    } as unknown as AgentRuntimeService
    const resolveAgent = vi.fn(async () => agent)
    const gateway = createAgentRuntimeSwarmGateway({ resolveAgent })
    const abortController = new AbortController()

    const resultPromise = gateway.sendWorker({
      task: {
        id: "task-1",
        schemaVersion: 1,
        name: "任务",
        currentConfig: {
          ...config,
          agent: {
            providerId: "openai",
            modelTier: "haiku",
            permissionMode: "plan",
            mainThreadPersonaId: "persona-current",
          },
          projectId: "project-current",
        },
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T00:00:00.000Z",
      },
      run: {
        id: "run-1",
        schemaVersion: 1,
        taskId: "task-1",
        status: "running",
        configSnapshot: {
          ...config,
          projectId: "project-snapshot",
          agent: {
            providerId: "anthropic",
            modelTier: "sonnet",
            permissionMode: "acceptEdits",
            mainThreadPersonaId: "persona-snapshot",
          },
        },
        startedAt: "2026-07-07T00:00:00.000Z",
        totals: { started: 0, success: 0, failed: 0, cancelled: 0, timeout: 0 },
        stopRequested: false,
      },
      worker: {
        id: "worker-1",
        schemaVersion: 1,
        taskId: "task-1",
        runId: "run-1",
        workerIndex: 2,
        roundIndex: 3,
        status: "running",
        sessionKey: "swarm:task-1:run-1",
      },
      workspacePath: "/repo-snapshot",
      prompt: "Do the work",
      abortSignal: abortController.signal,
      onConversationId: (conversationId) => {
        publishedConversationIds.push(conversationId)
      },
    })

    await vi.waitFor(() => {
      expect(resolveAgent).toHaveBeenCalledWith("project-snapshot")
      expect(sendNewSession).toHaveBeenCalledWith(
        {
          projectId: "project-snapshot",
          sessionKey: "swarm:task-1:run-1",
          platform: "swarm",
          content: "Do the work",
          workspacePath: "/repo-snapshot",
          agentType: "claude-code",
          providerId: "anthropic",
          modelTier: "sonnet",
          modeOverride: "acceptEdits",
          mainThreadPersonaId: "persona-snapshot",
          userMeta: {
            swarmTaskId: "task-1",
            swarmRunId: "run-1",
            swarmWorkerRunId: "worker-1",
            swarmRoundIndex: 3,
            swarmWorkerIndex: 2,
          },
        } satisfies AgentMessage,
        "任务 #3",
        expect.objectContaining({
          abortSignal: abortController.signal,
          onConversationCreated: expect.any(Function),
        }),
      )
      expect(publishedConversationIds).toEqual(["conversation-1"])
    })

    pendingResult.resolve({
      conversationId: "conversation-1",
      resultText: "done",
      events: [],
    })

    const result = await resultPromise
    expect(result).toEqual({
      conversationId: "conversation-1",
      resultText: "done",
      status: "success",
      events: [],
      error: undefined,
    })

    await gateway.cancelConversation("project-1", "conversation-1")

    expect(cancelTurn).toHaveBeenCalledWith("conversation-1")
  })

  it("creates and lists reusable tasks", async () => {
    const { service } = serviceHarness()

    const task = await service.createTask({ name: "任务", config })

    expect(task.name).toBe("任务")
    expect(await service.listTasks()).toHaveLength(1)
  })

  it("deletes a terminal task with its runs and worker records", async () => {
    const { service, runs, workers } = serviceHarness()
    const task = await service.createTask({ name: "任务", config })
    const run: SwarmRun = {
      id: "run-delete",
      schemaVersion: 1,
      taskId: task.id,
      status: "success",
      configSnapshot: config,
      startedAt: "2026-07-07T00:00:00.000Z",
      finishedAt: "2026-07-07T00:01:00.000Z",
      totals: { started: 1, success: 1, failed: 0, cancelled: 0, timeout: 0 },
      outputDirectory: "/repo/swarm-runs/run-delete",
      stopRequested: false,
    }
    await runs.upsert(run)
    await workers.upsert({
      id: "worker-delete",
      schemaVersion: 1,
      taskId: task.id,
      runId: run.id,
      workerIndex: 1,
      roundIndex: 1,
      status: "success",
      sessionKey: `swarm:${task.id}:${run.id}`,
      startedAt: "2026-07-07T00:00:00.000Z",
      finishedAt: "2026-07-07T00:01:00.000Z",
    })

    await service.deleteTask(task.id)

    expect(await service.listTasks()).toEqual([])
    expect(await service.listRuns(task.id)).toEqual([])
    expect(await service.listWorkerRuns(run.id)).toEqual([])
  })

  it("rejects deleting a task with an active run", async () => {
    const { service, tasks, runs, workers } = serviceHarness()
    const task = await service.createTask({ name: "任务", config })
    const run: SwarmRun = {
      id: "run-active",
      schemaVersion: 1,
      taskId: task.id,
      status: "running",
      configSnapshot: config,
      startedAt: "2026-07-07T00:00:00.000Z",
      totals: { started: 1, success: 0, failed: 0, cancelled: 0, timeout: 0 },
      outputDirectory: "/repo/swarm-runs/run-active",
      stopRequested: false,
    }
    await runs.upsert(run)
    await workers.upsert({
      id: "worker-active",
      schemaVersion: 1,
      taskId: task.id,
      runId: run.id,
      workerIndex: 1,
      roundIndex: 1,
      status: "running",
      sessionKey: `swarm:${task.id}:${run.id}`,
      startedAt: "2026-07-07T00:00:00.000Z",
    })

    await expect(service.deleteTask(task.id)).rejects.toThrow("请先取消运行")

    expect(await tasks.get(task.id)).toMatchObject({ id: task.id })
    expect(await runs.get(run.id)).toMatchObject({ id: run.id, status: "running" })
    expect(await workers.get("worker-active")).toMatchObject({ id: "worker-active", status: "running" })
  })

  it("snapshots config when starting a run", async () => {
    const { service } = serviceHarness()
    const task = await service.createTask({ name: "任务", config })
    await service.updateTask({
      taskId: task.id,
      patch: { currentConfig: { ...config, prompt: "Changed prompt." } },
    })

    const run = await service.startRun({ taskId: task.id })

    expect(run.status).toBe("running")
    expect(run.configSnapshot.prompt).toBe("Changed prompt.")
    expect(run.outputDirectory).toBe("/repo/swarm-runs/id-2")
  })

  it("starts Agent workers in the selected project path", async () => {
    const { service, gateway, resolveProjectPath } = serviceHarness()
    const task = await service.createTask({ name: "任务", config })

    await service.startRun({ taskId: task.id })

    await vi.waitFor(() => {
      expect(gateway.sendWorker).toHaveBeenCalled()
    })
    expect(resolveProjectPath).toHaveBeenCalledWith("project-1")
    const firstCall = vi.mocked(gateway.sendWorker).mock.calls[0]?.[0]
    expect(firstCall?.workspacePath).toBe("/repo")
  })

  it("rejects runs for missing projects before workers start", async () => {
    const { service, gateway } = serviceHarness({
      resolveProjectPath: async () => {
        throw new Error("项目不可用")
      },
    })
    const task = await service.createTask({ name: "任务", config })

    await expect(service.startRun({ taskId: task.id })).rejects.toThrow("项目不可用")
    expect(gateway.sendWorker).not.toHaveBeenCalled()
  })

  it("merges nested partial config overrides into a full snapshot", async () => {
    const { service } = serviceHarness()
    const task = await service.createTask({
      name: "任务",
      config: {
        ...config,
        injectOptions: {
          ...config.injectOptions,
          workerIdentity: false,
          customAppendix: "keep me",
        },
        summary: {
          enabled: false,
          injectRecent: false,
          recentLimit: 7,
        },
      },
    })

    const run = await service.startRun({
      taskId: task.id,
      configOverride: {
        summary: { injectRecent: true },
        handoff: { enabled: true },
        injectOptions: { roundContext: false },
      },
    })

    expect(run.configSnapshot.summary).toMatchObject({
      enabled: false,
      injectRecent: true,
      recentLimit: 7,
    })
    expect(run.configSnapshot.handoff).toMatchObject({ enabled: true })
    expect(run.configSnapshot.injectOptions).toMatchObject({
      workerIdentity: false,
      roundContext: false,
      runContext: true,
      parallelContext: true,
      customAppendix: "keep me",
    })
  })

  it("starts in the background and stores worker summaries", async () => {
    const { service } = serviceHarness()
    const task = await service.createTask({ name: "任务", config })

    const run = await service.startRun({ taskId: task.id })
    expect(run.status).toBe("running")

    await vi.waitFor(async () => {
      expect(await service.getRun(run.id)).toMatchObject({ status: "success" })
    })
    const workerRuns = await service.listWorkerRuns(run.id)

    expect(workerRuns).toHaveLength(2)
    expect(workerRuns[0]?.sessionKey).toBe(`swarm:${task.id}:${run.id}`)
    expect(workerRuns.every((worker) => worker.summary === "done")).toBe(true)
  })

  it("emits lightweight change events while runs and workers progress", async () => {
    const eventBus = { emit: vi.fn() }
    const { service } = serviceHarness({ eventBus })
    const task = await service.createTask({ name: "任务", config })

    eventBus.emit.mockClear()
    const run = await service.startRun({
      taskId: task.id,
      configOverride: { concurrency: 1, maxRounds: 1 },
    })

    await vi.waitFor(async () => {
      expect(await service.getRun(run.id)).toMatchObject({ status: "success" })
    })

    const emitted = eventBus.emit.mock.calls.map((call) => call[0])
    expect(emitted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        domain: "swarm-task",
        type: "swarm-task.changed",
        payload: expect.objectContaining({ taskId: task.id, runId: run.id, reason: "run-started" }),
      }),
      expect.objectContaining({
        domain: "swarm-task",
        type: "swarm-task.changed",
        payload: expect.objectContaining({ taskId: task.id, runId: run.id, workerRunId: expect.any(String), reason: "worker-started" }),
      }),
      expect.objectContaining({
        domain: "swarm-task",
        type: "swarm-task.changed",
        payload: expect.objectContaining({ taskId: task.id, runId: run.id, workerRunId: expect.any(String), reason: "worker-finished" }),
      }),
      expect.objectContaining({
        domain: "swarm-task",
        type: "swarm-task.changed",
        payload: expect.objectContaining({ taskId: task.id, runId: run.id, reason: "run-finished" }),
      }),
    ]))
    expect(JSON.stringify(emitted)).not.toContain("Run.")
    expect(JSON.stringify(emitted)).not.toContain("done")
  })

  it("stores fallback summary when summary block is missing", async () => {
    const { service } = serviceHarness({
      agent: {
        sendWorker: vi.fn(async () => ({
          conversationId: "conversation-1",
          resultText: "plain final result",
          status: "success",
          events: [],
        })),
      },
    })
    const task = await service.createTask({ name: "任务", config })

    const run = await service.startRun({ taskId: task.id })
    await vi.waitFor(async () => {
      expect(await service.getRun(run.id)).toMatchObject({ status: "success" })
    })
    const workerRuns = await service.listWorkerRuns(run.id)

    expect(workerRuns[0]?.summary).toBe("plain final result")
    expect(workerRuns[0]?.summaryFallback).toBe(true)
  })

  it("persists cancelled worker state when the gateway aborts during cancelRun", async () => {
    const pending = deferred<{
      conversationId: string
      resultText: string
      status: "success" | "failed" | "cancelled" | "timeout"
      events: []
    }>()
    const { service, tasks } = serviceHarness({
      agent: {
        sendWorker: vi.fn(async ({ abortSignal }) => {
          abortSignal?.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted")
              error.name = "AbortError"
              pending.reject(error)
            },
            { once: true },
          )
          return pending.promise
        }),
      },
    })
    const task = await service.createTask({ name: "任务", config })

    const run = await service.startRun({
      taskId: task.id,
      configOverride: { concurrency: 1, maxRounds: 1 },
    })

    await vi.waitFor(async () => {
      expect(await service.listWorkerRuns(run.id)).toHaveLength(1)
    })

    const cancelledRun = await service.cancelRun(run.id)
    const workerRuns = await service.listWorkerRuns(run.id)
    const latestTask = await tasks.get(task.id)

    expect(cancelledRun).toMatchObject({ id: run.id, status: "cancelled" })
    expect(workerRuns[0]).toMatchObject({ status: "cancelled" })
    expect(latestTask).toMatchObject({ lastRunId: run.id, lastStatus: "cancelled" })
  })

  it("persists failed worker state when the gateway rejects", async () => {
    const pending = deferred<{
      conversationId: string
      resultText: string
      status: "success" | "failed" | "cancelled" | "timeout"
      events: []
    }>()
    const { service, tasks } = serviceHarness({
      agent: {
        sendWorker: vi.fn(async () => pending.promise),
      },
    })
    const task = await service.createTask({ name: "任务", config })

    const run = await service.startRun({
      taskId: task.id,
      configOverride: { concurrency: 1, maxRounds: 1 },
    })

    await vi.waitFor(async () => {
      expect(await service.listWorkerRuns(run.id)).toHaveLength(1)
    })
    pending.reject(new Error("gateway exploded"))

    await vi.waitFor(async () => {
      expect(await service.getRun(run.id)).toMatchObject({ status: "failed" })
    })

    const workerRuns = await service.listWorkerRuns(run.id)
    const latestTask = await tasks.get(task.id)

    expect(workerRuns[0]).toMatchObject({
      status: "failed",
      error: "gateway exploded",
      lastMessage: "gateway exploded",
    })
    expect(latestTask).toMatchObject({ lastRunId: run.id, lastStatus: "failed" })
  })

  it("cancels an in-flight worker by conversation id published before gateway resolution", async () => {
    const pending = deferred<{
      conversationId: string
      resultText: string
      status: "success" | "failed" | "cancelled" | "timeout"
      events: []
    }>()
    const { service, gateway } = serviceHarness({
      agent: {
        sendWorker: vi.fn(async ({ onConversationId, abortSignal }) => {
          await onConversationId?.("conversation-live")
          abortSignal?.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted")
            error.name = "AbortError"
            pending.reject(error)
          },
          { once: true },
          )
          return pending.promise
        }),
      },
    })
    const task = await service.createTask({ name: "任务", config })

    const run = await service.startRun({
      taskId: task.id,
      configOverride: { concurrency: 1, maxRounds: 1 },
    })

    await vi.waitFor(async () => {
      const workerRuns = await service.listWorkerRuns(run.id)
      expect(workerRuns[0]).toMatchObject({
        status: "running",
        conversationId: "conversation-live",
      })
    })

    const cancelledRun = await service.cancelRun(run.id)
    const workerRuns = await service.listWorkerRuns(run.id)

    expect(gateway.cancelConversation).toHaveBeenCalledWith("project-1", "conversation-live")
    expect(cancelledRun).toMatchObject({ status: "cancelled" })
    expect(workerRuns[0]).toMatchObject({
      status: "cancelled",
      conversationId: "conversation-live",
    })
  })

  it("cancels the published conversation even if the worker persists cancelled immediately after abort", async () => {
    const baseWorkers = namespace<SwarmWorkerRun>()
    const delayedWorkers = {
      ...baseWorkers,
      async list(filter?: Partial<SwarmWorkerRun>): Promise<SwarmWorkerRun[]> {
        if (filter?.runId && filter.status === "running") {
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        return baseWorkers.list(filter)
      },
    }
    const pending = deferred<{
      conversationId: string
      resultText: string
      status: "success" | "failed" | "cancelled" | "timeout"
      events: []
    }>()
    const { service, gateway } = serviceHarness({
      agent: {
        sendWorker: vi.fn(async ({ onConversationId, abortSignal }) => {
          await onConversationId?.("conversation-race")
          abortSignal?.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted")
              error.name = "AbortError"
              pending.reject(error)
            },
            { once: true },
          )
          return pending.promise
        }),
      },
      workers: delayedWorkers,
    })
    const task = await service.createTask({ name: "任务", config })

    const run = await service.startRun({
      taskId: task.id,
      configOverride: { concurrency: 1, maxRounds: 1 },
    })

    await vi.waitFor(async () => {
      const workerRuns = await service.listWorkerRuns(run.id)
      expect(workerRuns[0]).toMatchObject({
        status: "running",
        conversationId: "conversation-race",
      })
    })

    const cancelledRun = await service.cancelRun(run.id)

    await vi.waitFor(async () => {
      const workerRuns = await service.listWorkerRuns(run.id)
      expect(workerRuns[0]).toMatchObject({
        status: "cancelled",
        conversationId: "conversation-race",
      })
    })

    expect(gateway.cancelConversation).toHaveBeenCalledTimes(1)
    expect(gateway.cancelConversation).toHaveBeenCalledWith("project-1", "conversation-race")
    expect(cancelledRun).toMatchObject({ status: "cancelled" })
  })

  it("leaves an already successful run unchanged when cancelRun is called", async () => {
    const { service, tasks, gateway } = serviceHarness()
    const task = await service.createTask({ name: "任务", config })

    const run = await service.startRun({
      taskId: task.id,
      configOverride: { concurrency: 1, maxRounds: 1 },
    })

    await vi.waitFor(async () => {
      expect(await service.getRun(run.id)).toMatchObject({ status: "success" })
    })

    const beforeCancelTask = await tasks.get(task.id)
    const cancelledRun = await service.cancelRun(run.id)
    const persistedRun = await service.getRun(run.id)
    const persistedTask = await tasks.get(task.id)

    expect(cancelledRun).toMatchObject({ status: "success" })
    expect(persistedRun).toMatchObject({ status: "success" })
    expect(persistedTask).toMatchObject({
      lastRunId: run.id,
      lastStatus: "success",
    })
    expect(persistedTask?.updatedAt).toBe(beforeCancelTask?.updatedAt)
    expect(gateway.cancelConversation).not.toHaveBeenCalled()
  })

  it("does not rewrite the run or task when cancelRun sees a terminal run on re-read", async () => {
    const taskStore = namespace<SwarmTask>()
    const runningRun: SwarmRun = {
      id: "run-race",
      schemaVersion: 1,
      taskId: "task-race",
      status: "running",
      configSnapshot: config,
      startedAt: "2026-07-07T00:00:00.000Z",
      totals: { started: 1, success: 0, failed: 0, cancelled: 0, timeout: 0 },
      outputDirectory: "/repo/swarm-runs/run-race",
      stopRequested: false,
    }
    const runs = terminalRaceRun(runningRun, "success")
    const workers = namespace<SwarmWorkerRun>()
    await taskStore.upsert({
      id: "task-race",
      schemaVersion: 1,
      name: "任务",
      currentConfig: config,
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
      lastRunId: runningRun.id,
      lastStatus: "running",
    })
    await workers.upsert({
      id: "worker-race",
      schemaVersion: 1,
      taskId: "task-race",
      runId: runningRun.id,
      workerIndex: 1,
      roundIndex: 1,
      status: "running",
      sessionKey: "swarm:task-race:run-race",
      startedAt: "2026-07-07T00:00:00.000Z",
      lastPhase: "queued",
      conversationId: "conversation-race",
    })
    const gateway: SwarmAgentGateway = {
      sendWorker: vi.fn(),
      cancelConversation: vi.fn(async () => undefined),
    }
    const service = createSwarmTaskService({
      tasks: taskStore,
      runs,
      workers,
      agent: gateway,
      now: () => new Date("2026-07-07T00:00:00.000Z"),
      idFactory: () => "unused",
      outputRoot: "/repo/swarm-runs",
    })

    const result = await service.cancelRun(runningRun.id)
    const persistedRun = await service.getRun(runningRun.id)
    const persistedTask = await taskStore.get("task-race")

    expect(gateway.cancelConversation).toHaveBeenCalledWith("project-1", "conversation-race")
    expect(result).toMatchObject({ status: "success", stopRequested: false })
    expect(persistedRun).toMatchObject({ status: "success", stopRequested: false })
    expect(persistedTask).toMatchObject({ lastRunId: runningRun.id, lastStatus: "running" })
    expect(runs.terminalSnapshot()).toMatchObject({ status: "success", stopRequested: false })
  })

  it("leaves a terminal run unchanged when stopRefill is called", async () => {
    const { service } = serviceHarness()
    const task = await service.createTask({ name: "任务", config })

    const run = await service.startRun({
      taskId: task.id,
      configOverride: { concurrency: 1, maxRounds: 1 },
    })

    await vi.waitFor(async () => {
      expect(await service.getRun(run.id)).toMatchObject({ status: "success" })
    })

    const stoppedRun = await service.stopRefill(run.id)
    const persistedRun = await service.getRun(run.id)

    expect(stoppedRun).toMatchObject({ status: "success", stopRequested: false })
    expect(persistedRun).toMatchObject({ status: "success", stopRequested: false })
  })

  it("does not rewrite a run that becomes terminal before stopRefill persists draining", async () => {
    const taskStore = namespace<SwarmTask>()
    const runningRun: SwarmRun = {
      id: "run-stop-race",
      schemaVersion: 1,
      taskId: "task-stop-race",
      status: "running",
      configSnapshot: config,
      startedAt: "2026-07-07T00:00:00.000Z",
      totals: { started: 1, success: 0, failed: 0, cancelled: 0, timeout: 0 },
      outputDirectory: "/repo/swarm-runs/run-stop-race",
      stopRequested: false,
    }
    const runs = terminalRaceRun(runningRun, "failed")
    await taskStore.upsert({
      id: "task-stop-race",
      schemaVersion: 1,
      name: "任务",
      currentConfig: config,
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    })
    const service = createSwarmTaskService({
      tasks: taskStore,
      runs,
      workers: namespace<SwarmWorkerRun>(),
      agent: {
        sendWorker: vi.fn(),
        cancelConversation: vi.fn(async () => undefined),
      },
      now: () => new Date("2026-07-07T00:00:00.000Z"),
      idFactory: () => "unused",
      outputRoot: "/repo/swarm-runs",
    })

    const result = await service.stopRefill(runningRun.id)
    const persistedRun = await service.getRun(runningRun.id)

    expect(result).toMatchObject({ status: "failed", stopRequested: false })
    expect(persistedRun).toMatchObject({ status: "failed", stopRequested: false })
    expect(runs.terminalSnapshot()).toMatchObject({ status: "failed", stopRequested: false })
  })
})
