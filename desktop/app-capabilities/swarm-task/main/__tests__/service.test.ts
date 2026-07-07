import { describe, expect, it, vi } from "vitest"

import { createSwarmTaskService, type SwarmAgentGateway } from "../service"
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
  workspacePath: "/repo",
  prompt: "Run.",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    outputProtocol: true,
    parallelContext: true,
    gitContext: false,
    customAppendix: "",
  },
  runMode: "batch" as const,
  concurrency: 2,
  maxRounds: 2,
  output: { mode: "managed-directory" as const, targetFilePolicy: "append-only" as const },
  summary: { enabled: true, injectRecent: false, recentLimit: 3 },
  handoff: { enabled: false },
  agent: {},
}

function serviceHarness(agent?: Partial<SwarmAgentGateway>) {
  const tasks = namespace<SwarmTask>()
  const runs = namespace<SwarmRun>()
  const workers = namespace<SwarmWorkerRun>()
  const gateway: SwarmAgentGateway = {
    sendWorker: vi.fn(async () => ({
      conversationId: "conversation-1",
      resultText: "<SYNAPSE_SWARM_SUMMARY>\ndone\n</SYNAPSE_SWARM_SUMMARY>",
      status: "success",
      events: [],
    })),
    cancelConversation: vi.fn(async () => undefined),
    ...agent,
  }
  const service = createSwarmTaskService({
    tasks,
    runs,
    workers,
    agent: gateway,
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    idFactory: (() => {
      let index = 0
      return () => `id-${++index}`
    })(),
    outputRoot: "/repo/swarm-runs",
  })
  return { service, tasks, runs, workers, gateway }
}

describe("createSwarmTaskService", () => {
  it("creates and lists reusable tasks", async () => {
    const { service } = serviceHarness()

    const task = await service.createTask({ name: "任务", config })

    expect(task.name).toBe("任务")
    expect(await service.listTasks()).toHaveLength(1)
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

  it("stores fallback summary when summary block is missing", async () => {
    const { service } = serviceHarness({
      sendWorker: vi.fn(async () => ({
        conversationId: "conversation-1",
        resultText: "plain final result",
        status: "success",
        events: [],
      })),
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
      sendWorker: vi.fn(async () => pending.promise),
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
})
