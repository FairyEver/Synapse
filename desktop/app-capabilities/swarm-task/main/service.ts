import { randomUUID } from "node:crypto"
import path from "node:path"

import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { AgentEvent } from "../../../electron/services/agent-runtime"
import {
  swarmRunStartInputSchema,
  swarmTaskCreateInputSchema,
  swarmTaskUpdateInputSchema,
  type SwarmRun,
  type SwarmRunStartInput,
  type SwarmTask,
  type SwarmTaskCreateInput,
  type SwarmTaskUpdateInput,
  type SwarmWorkerRun,
} from "../shared/schema"
import {
  buildSwarmWorkerPrompt,
  extractSwarmStructuredOutput,
  fallbackSummary,
} from "./prompt-builder"
import { createSwarmScheduler, type SwarmWorkerRunner } from "./scheduler"

export type SwarmAgentGatewayResult = {
  readonly conversationId: string
  readonly resultText: string
  readonly status: "success" | "failed" | "cancelled" | "timeout"
  readonly events: readonly AgentEvent[]
  readonly error?: string
}

export type SwarmAgentGatewayInput = {
  readonly task: SwarmTask
  readonly run: SwarmRun
  readonly worker: SwarmWorkerRun
  readonly prompt: string
  readonly abortSignal?: AbortSignal
}

export type SwarmAgentGateway = {
  sendWorker(input: SwarmAgentGatewayInput): Promise<SwarmAgentGatewayResult>
  cancelConversation(projectId: string, conversationId: string): Promise<void>
}

export type SwarmTaskServiceDeps = {
  readonly tasks: Pick<DataNamespace<SwarmTask>, "list" | "get" | "upsert" | "remove">
  readonly runs: Pick<DataNamespace<SwarmRun>, "list" | "get" | "upsert" | "remove">
  readonly workers: Pick<DataNamespace<SwarmWorkerRun>, "list" | "get" | "upsert" | "remove">
  readonly agent: SwarmAgentGateway
  readonly outputRoot: string
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export type SwarmTaskService = ReturnType<typeof createSwarmTaskService>

export function createSwarmTaskService(deps: SwarmTaskServiceDeps) {
  const timestamp = () => (deps.now ?? (() => new Date()))().toISOString()
  const createId = deps.idFactory ?? (() => randomUUID())
  const scheduler = createSwarmScheduler({ runner: createWorkerRunner() })
  const runningRuns = new Map<string, Promise<void>>()

  async function listTasks(): Promise<SwarmTask[]> {
    return (await deps.tasks.list()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async function createTask(input: SwarmTaskCreateInput): Promise<SwarmTask> {
    const parsed = swarmTaskCreateInputSchema.parse(input)
    const now = timestamp()
    const task: SwarmTask = {
      id: createId(),
      schemaVersion: 1,
      name: parsed.name.trim(),
      description: parsed.description,
      currentConfig: parsed.config,
      createdAt: now,
      updatedAt: now,
    }
    await deps.tasks.upsert(task)
    return task
  }

  async function updateTask(input: SwarmTaskUpdateInput): Promise<SwarmTask> {
    const parsed = swarmTaskUpdateInputSchema.parse(input)
    const task = await requireTask(parsed.taskId)
    const updated: SwarmTask = {
      ...task,
      ...("name" in parsed.patch && parsed.patch.name ? { name: parsed.patch.name.trim() } : {}),
      ...("description" in parsed.patch ? { description: parsed.patch.description } : {}),
      ...("currentConfig" in parsed.patch && parsed.patch.currentConfig
        ? { currentConfig: parsed.patch.currentConfig }
        : {}),
      updatedAt: timestamp(),
    }
    await deps.tasks.upsert(updated)
    return updated
  }

  async function deleteTask(taskId: string): Promise<void> {
    await deps.tasks.remove(taskId)
  }

  async function startRun(input: SwarmRunStartInput): Promise<SwarmRun> {
    const parsed = swarmRunStartInputSchema.parse(input)
    const task = await requireTask(parsed.taskId)
    const runId = createId()
    const configSnapshot = {
      ...task.currentConfig,
      ...parsed.configOverride,
      output: {
        ...task.currentConfig.output,
        ...parsed.configOverride?.output,
      },
    }
    const run: SwarmRun = {
      id: runId,
      schemaVersion: 1,
      taskId: task.id,
      status: "running",
      configSnapshot,
      startedAt: timestamp(),
      totals: { started: 0, success: 0, failed: 0, cancelled: 0, timeout: 0 },
      outputDirectory: configSnapshot.output.managedDirectory ?? path.join(deps.outputRoot, runId),
      stopRequested: false,
    }

    await deps.runs.upsert(run)
    await deps.tasks.upsert({ ...task, lastRunId: run.id, lastStatus: "running", updatedAt: timestamp() })

    const promise = finishRunInBackground(task.id, run)
    runningRuns.set(run.id, promise)
    void promise.finally(() => {
      runningRuns.delete(run.id)
    })

    return run
  }

  async function stopRefill(runId: string): Promise<SwarmRun | null> {
    scheduler.stopRefill(runId)
    const run = await deps.runs.get(runId)
    if (!run) return null
    const updated: SwarmRun = { ...run, status: "draining", stopRequested: true }
    await deps.runs.upsert(updated)
    return updated
  }

  async function cancelRun(runId: string): Promise<SwarmRun | null> {
    await scheduler.cancel(runId)
    const run = await deps.runs.get(runId)
    if (!run) return null
    const activeWorkers = await deps.workers.list({ runId, status: "running" } as Partial<SwarmWorkerRun>)
    await Promise.all(activeWorkers.map((worker) =>
      worker.conversationId
        ? deps.agent.cancelConversation(run.configSnapshot.projectId, worker.conversationId)
        : Promise.resolve()))
    const updated: SwarmRun = {
      ...run,
      status: "cancelled",
      stopRequested: true,
      finishedAt: timestamp(),
    }
    await deps.runs.upsert(updated)
    await runningRuns.get(runId)?.catch(() => undefined)
    return updated
  }

  async function listRuns(taskId?: string, limit = 100): Promise<SwarmRun[]> {
    const runs = taskId
      ? await deps.runs.list({ taskId } as Partial<SwarmRun>)
      : await deps.runs.list()
    return runs
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, limit)
  }

  function getRun(runId: string): Promise<SwarmRun | null> {
    return deps.runs.get(runId)
  }

  async function listWorkerRuns(runId: string): Promise<SwarmWorkerRun[]> {
    return (await deps.workers.list({ runId } as Partial<SwarmWorkerRun>))
      .sort((left, right) => left.roundIndex - right.roundIndex || left.workerIndex - right.workerIndex)
  }

  async function finishRunInBackground(taskId: string, run: SwarmRun): Promise<void> {
    try {
      const result = await scheduler.start({ taskId, runId: run.id, config: run.configSnapshot })
      const latestRun = await deps.runs.get(run.id)
      if (!latestRun || latestRun.status === "cancelled") return

      const finished: SwarmRun = {
        ...latestRun,
        status: result.status,
        totals: result.totals,
        finishedAt: timestamp(),
      }
      await deps.runs.upsert(finished)
      const latestTask = await requireTask(taskId)
      await deps.tasks.upsert({
        ...latestTask,
        lastRunId: run.id,
        lastStatus: finished.status,
        updatedAt: timestamp(),
      })
    } catch {
      const latestRun = await deps.runs.get(run.id)
      if (!latestRun) return
      const failed: SwarmRun = {
        ...latestRun,
        status: "failed",
        finishedAt: timestamp(),
      }
      await deps.runs.upsert(failed)
      const latestTask = await requireTask(taskId)
      await deps.tasks.upsert({
        ...latestTask,
        lastRunId: run.id,
        lastStatus: "failed",
        updatedAt: timestamp(),
      })
    }
  }

  async function requireTask(taskId: string): Promise<SwarmTask> {
    const task = await deps.tasks.get(taskId)
    if (!task) throw new Error(`Swarm task not found: ${taskId}`)
    return task
  }

  function createWorkerRunner(): SwarmWorkerRunner {
    return async (input) => {
      const task = await requireTask(input.taskId)
      const run = await deps.runs.get(input.runId)
      if (!run) throw new Error(`Swarm run not found: ${input.runId}`)

      const previousWorkers = await listWorkerRuns(run.id)
      const previousHandoff = input.config.handoff.enabled
        ? previousWorkers.filter((worker) => worker.handoff?.trim()).at(-1)?.handoff
        : undefined

      const worker: SwarmWorkerRun = {
        id: createId(),
        schemaVersion: 1,
        taskId: input.taskId,
        runId: input.runId,
        workerIndex: input.workerIndex,
        roundIndex: input.roundIndex,
        status: "running",
        sessionKey: `swarm:${input.taskId}:${input.runId}`,
        startedAt: timestamp(),
        lastPhase: "queued",
      }
      await deps.workers.upsert(worker)

      const prompt = buildSwarmWorkerPrompt({
        taskId: input.taskId,
        runId: input.runId,
        workerIndex: input.workerIndex,
        roundIndex: input.roundIndex,
        config: input.config,
        recentSummaries: previousWorkers,
        previousHandoff,
      })

      const result = await deps.agent.sendWorker({
        task,
        run,
        worker,
        prompt,
        abortSignal: input.abortSignal,
      })

      const extracted = extractSwarmStructuredOutput(result.resultText)
      const summary = input.config.summary.enabled
        ? extracted.summary ?? fallbackSummary(result.resultText)
        : undefined
      const summaryFallback = input.config.summary.enabled && !extracted.summary
      const updated: SwarmWorkerRun = {
        ...worker,
        status: result.status,
        conversationId: result.conversationId,
        finishedAt: timestamp(),
        lastPhase: result.status === "success" ? "completed" : "failed",
        lastMessage: result.error ?? result.resultText.slice(0, 500),
        ...(summary ? { summary, summaryFallback } : {}),
        ...(input.config.handoff.enabled && extracted.handoff ? { handoff: extracted.handoff } : {}),
        ...(result.error ? { error: result.error } : {}),
      }
      await deps.workers.upsert(updated)

      return {
        status: result.status,
        resultText: result.resultText,
        error: result.error,
      }
    }
  }

  return {
    listTasks,
    createTask,
    updateTask,
    deleteTask,
    startRun,
    stopRefill,
    cancelRun,
    listRuns,
    getRun,
    listWorkerRuns,
  }
}
