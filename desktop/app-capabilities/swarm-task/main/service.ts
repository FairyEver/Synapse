import { randomUUID } from "node:crypto"
import path from "node:path"

import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { AgentEvent } from "../../../electron/services/agent-runtime"
import {
  swarmRunStartInputSchema,
  swarmTaskConfigSchema,
  swarmTaskCreateInputSchema,
  swarmTaskUpdateInputSchema,
  type SwarmRun,
  type SwarmRunStartInput,
  type SwarmTask,
  type SwarmTaskConfig,
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
  readonly onConversationId?: (conversationId: string) => Promise<void> | void
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

type TerminalWorkerOutcome = {
  readonly status: "success" | "failed" | "cancelled" | "timeout"
  readonly resultText: string
  readonly error?: string
  readonly conversationId?: string
}

export function createSwarmTaskService(deps: SwarmTaskServiceDeps) {
  const timestamp = () => (deps.now ?? (() => new Date()))().toISOString()
  const createId = deps.idFactory ?? (() => randomUUID())
  const scheduler = createSwarmScheduler({ runner: createWorkerRunner() })
  const runningRuns = new Map<string, Promise<void>>()
  const terminalRunStatuses = new Set<SwarmRun["status"]>(["success", "partial", "failed", "cancelled"])

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
    const configSnapshot = mergeConfigSnapshot(task.currentConfig, input.configOverride)
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
    const run = await deps.runs.get(runId)
    if (!run) return null
    if (terminalRunStatuses.has(run.status)) {
      return run
    }
    scheduler.stopRefill(runId)
    const updated: SwarmRun = { ...run, status: "draining", stopRequested: true }
    await deps.runs.upsert(updated)
    return updated
  }

  async function cancelRun(runId: string): Promise<SwarmRun | null> {
    const run = await deps.runs.get(runId)
    if (!run) return null
    if (terminalRunStatuses.has(run.status)) {
      return run
    }

    const activeConversationIds = await snapshotActiveWorkerConversationIds(run.id)
    await scheduler.cancel(runId)
    await Promise.all(
      activeConversationIds.map((conversationId) =>
        deps.agent.cancelConversation(run.configSnapshot.projectId, conversationId),
      ),
    )
    const updated: SwarmRun = {
      ...run,
      status: "cancelled",
      stopRequested: true,
      finishedAt: timestamp(),
    }
    await deps.runs.upsert(updated)
    const task = await requireTask(run.taskId)
    await deps.tasks.upsert({
      ...task,
      lastRunId: run.id,
      lastStatus: "cancelled",
      updatedAt: timestamp(),
    })
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

  async function snapshotActiveWorkerConversationIds(runId: string): Promise<string[]> {
    const activeWorkers = await deps.workers.list({ runId, status: "running" } as Partial<SwarmWorkerRun>)
    return [...new Set(activeWorkers.flatMap((worker) => (worker.conversationId ? [worker.conversationId] : [])))]
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

      try {
        const result = await deps.agent.sendWorker({
          task,
          run,
          worker,
          prompt,
          abortSignal: input.abortSignal,
          onConversationId: (conversationId) => persistWorkerConversationId(worker.id, conversationId),
        })

        return persistWorkerOutcome({
          worker,
          input,
          outcome: {
            status: result.status,
            resultText: result.resultText,
            error: result.error,
            conversationId: result.conversationId,
          },
        })
      } catch (error) {
        const outcome = normalizeWorkerErrorOutcome(error, input.abortSignal)
        return persistWorkerOutcome({ worker, input, outcome })
      }
    }
  }

  function normalizeWorkerErrorOutcome(
    error: unknown,
    abortSignal?: AbortSignal,
  ): TerminalWorkerOutcome {
    if (abortSignal?.aborted || isAbortError(error)) {
      return {
        status: "cancelled",
        resultText: "",
      }
    }

    return {
      status: "failed",
      resultText: "",
      error: error instanceof Error ? error.message : "worker failed",
    }
  }

  async function persistWorkerOutcome(input: {
    worker: SwarmWorkerRun
    input: Parameters<SwarmWorkerRunner>[0]
    outcome: TerminalWorkerOutcome
  }): Promise<{
    status: "success" | "failed" | "cancelled" | "timeout"
    resultText: string
    error?: string
  }> {
    const { worker, outcome } = input
    const latestWorker = (await deps.workers.get(worker.id)) ?? worker
    const extracted = extractSwarmStructuredOutput(outcome.resultText)
    const summary = input.input.config.summary.enabled
      ? extracted.summary ?? fallbackSummary(outcome.resultText)
      : undefined
    const summaryFallback = input.input.config.summary.enabled && !extracted.summary
    const finalMessage =
      outcome.error ??
      (outcome.resultText ? outcome.resultText.slice(0, 500) : outcome.status === "cancelled" ? "cancelled" : undefined)
    const updated: SwarmWorkerRun = {
      ...latestWorker,
      status: outcome.status,
      ...((outcome.conversationId ?? latestWorker.conversationId)
        ? { conversationId: outcome.conversationId ?? latestWorker.conversationId }
        : {}),
      finishedAt: timestamp(),
      lastPhase: outcome.status === "success" ? "completed" : "failed",
      ...(finalMessage ? { lastMessage: finalMessage } : {}),
      ...(summary ? { summary, summaryFallback } : {}),
      ...(input.input.config.handoff.enabled && extracted.handoff ? { handoff: extracted.handoff } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    }
    await deps.workers.upsert(updated)

    return {
      status: outcome.status,
      resultText: outcome.resultText,
      error: outcome.error,
    }
  }

  async function persistWorkerConversationId(workerId: string, conversationId: string): Promise<void> {
    const worker = await deps.workers.get(workerId)
    if (!worker || worker.conversationId === conversationId) {
      return
    }
    await deps.workers.upsert({
      ...worker,
      conversationId,
    })
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

function mergeConfigSnapshot(
  base: SwarmTaskConfig,
  override?: SwarmRunStartInput["configOverride"],
): SwarmTaskConfig {
  if (!override) {
    return base
  }

  return swarmTaskConfigSchema.parse({
    ...base,
    ...override,
    injectOptions: {
      ...base.injectOptions,
      ...override.injectOptions,
    },
    output: {
      ...base.output,
      ...override.output,
    },
    summary: {
      ...base.summary,
      ...override.summary,
    },
    handoff: {
      ...base.handoff,
      ...override.handoff,
    },
    agent: {
      ...base.agent,
      ...override.agent,
    },
  })
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const { name } = error as { name?: unknown }
  return name === "AbortError"
}
