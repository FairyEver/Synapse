import { randomUUID } from "node:crypto"
import path from "node:path"

import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { EventBus } from "../../../electron/runtime/event-bus"
import type { AgentEvent, AgentMessage, AgentRuntimeService } from "../../../electron/services/agent-runtime"
import {
  normalizeSwarmTaskConfig,
  swarmRunStartInputSchema,
  swarmTaskConfigSchema,
  swarmTaskCreateInputSchema,
  swarmTaskUpdateInputSchema,
  type SwarmRun,
  type SwarmRunStartInput,
  type SwarmTask,
  type SwarmTaskChangedEvent,
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
  readonly workspacePath: string
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
  readonly resolveProjectPath: (projectId: string) => Promise<string>
  readonly outputRoot: string
  readonly eventBus?: Pick<EventBus, "emit">
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export type SwarmTaskService = ReturnType<typeof createSwarmTaskService>

export function createAgentRuntimeSwarmGateway(deps: {
  readonly resolveAgent: (projectId: string) => Promise<AgentRuntimeService>
}): SwarmAgentGateway {
  return {
    async sendWorker(input) {
      const configSnapshot = input.run.configSnapshot
      const agent = await deps.resolveAgent(configSnapshot.projectId)
      const result = await agent.sendNewSession(
        {
          projectId: configSnapshot.projectId,
          sessionKey: input.worker.sessionKey,
          platform: "swarm",
          content: input.prompt,
          workspacePath: input.workspacePath,
          agentType: "claude-code",
          providerId: configSnapshot.agent.providerId,
          modelTier: configSnapshot.agent.modelTier,
          modeOverride: configSnapshot.agent.permissionMode,
          mainThreadPersonaId: configSnapshot.agent.mainThreadPersonaId,
          userMeta: {
            swarmTaskId: input.task.id,
            swarmRunId: input.run.id,
            swarmWorkerRunId: input.worker.id,
            swarmRoundIndex: input.worker.roundIndex,
            swarmWorkerIndex: input.worker.workerIndex,
            swarmSequenceIndex: input.worker.sequenceIndex ?? input.worker.roundIndex,
            swarmSlotIndex: input.worker.slotIndex ?? input.worker.workerIndex,
            swarmBatchIndex: input.worker.batchIndex,
          },
        } satisfies AgentMessage,
        `${input.task.name} #${input.worker.roundIndex}`,
        {
          abortSignal: input.abortSignal,
          onConversationCreated: (conversation) => {
            input.onConversationId?.(conversation.id)
          },
        },
      )
      return {
        conversationId: result.conversationId,
        resultText: result.resultText,
        status: result.error ? "failed" : "success",
        events: result.events,
        error: result.error,
      }
    },
    async cancelConversation(projectId, conversationId) {
      const agent = await deps.resolveAgent(projectId)
      await agent.cancelTurn(conversationId)
    },
  }
}

type TerminalWorkerOutcome = {
  readonly status: "success" | "failed" | "cancelled" | "timeout"
  readonly resultText: string
  readonly error?: string
  readonly conversationId?: string
}

const INTERRUPTED_RUN_ERROR = "Synapse 重启，运行已中断"

export function createSwarmTaskService(deps: SwarmTaskServiceDeps) {
  const timestamp = () => (deps.now ?? (() => new Date()))().toISOString()
  const createId = deps.idFactory ?? (() => randomUUID())
  const scheduler = createSwarmScheduler({ runner: createWorkerRunner() })
  const runningRuns = new Map<string, Promise<void>>()
  const terminalRunStatuses = new Set<SwarmRun["status"]>(["success", "partial", "failed", "cancelled"])
  const activeRunStatuses = new Set<SwarmRun["status"]>(["running", "draining"])

  async function initialize(): Promise<void> {
    const persistedRuns = await deps.runs.list()
    for (const run of persistedRuns) {
      if (activeRunStatuses.has(run.status)) {
        await recoverInterruptedRun(run)
      }
    }
  }

  async function recoverInterruptedRun(run: SwarmRun): Promise<void> {
    const interruptedAt = timestamp()
    const persistedWorkers = await deps.workers.list({ runId: run.id } as Partial<SwarmWorkerRun>)
    const recoveredWorkers: SwarmWorkerRun[] = []

    for (const worker of persistedWorkers) {
      if (worker.status !== "queued" && worker.status !== "running") {
        recoveredWorkers.push(worker)
        continue
      }
      const recoveredWorker: SwarmWorkerRun = {
        ...worker,
        status: "failed",
        finishedAt: interruptedAt,
        lastPhase: "failed",
        lastMessage: INTERRUPTED_RUN_ERROR,
        error: INTERRUPTED_RUN_ERROR,
      }
      await deps.workers.upsert(recoveredWorker)
      recoveredWorkers.push(recoveredWorker)
      emitChanged({
        taskId: recoveredWorker.taskId,
        runId: recoveredWorker.runId,
        workerRunId: recoveredWorker.id,
        reason: "worker-finished",
      })
    }

    const countWorkers = (status: SwarmWorkerRun["status"]) => (
      recoveredWorkers.filter((worker) => worker.status === status).length
    )
    const failedRun: SwarmRun = {
      ...run,
      status: "failed",
      finishedAt: interruptedAt,
      totals: {
        started: Math.max(run.totals.started, recoveredWorkers.length),
        success: Math.max(run.totals.success, countWorkers("success")),
        failed: Math.max(run.totals.failed, countWorkers("failed")),
        cancelled: Math.max(run.totals.cancelled, countWorkers("cancelled")),
        timeout: Math.max(run.totals.timeout, countWorkers("timeout")),
      },
      error: INTERRUPTED_RUN_ERROR,
      stopRequested: true,
    }
    await deps.runs.upsert(failedRun)

    const task = await deps.tasks.get(run.taskId)
    if (task?.lastRunId === run.id) {
      await deps.tasks.upsert({
        ...task,
        lastStatus: "failed",
        updatedAt: interruptedAt,
      })
    }
    emitChanged({ taskId: run.taskId, runId: run.id, reason: "run-failed" })
  }

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
      currentConfig: normalizeSwarmTaskConfig(parsed.config),
      createdAt: now,
      updatedAt: now,
    }
    await deps.tasks.upsert(task)
    emitChanged({ taskId: task.id, reason: "task-created" })
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
        ? { currentConfig: normalizeSwarmTaskConfig(parsed.patch.currentConfig) }
        : {}),
      updatedAt: timestamp(),
    }
    await deps.tasks.upsert(updated)
    emitChanged({ taskId: updated.id, reason: "task-updated" })
    return updated
  }

  async function deleteTask(taskId: string): Promise<void> {
    await requireTask(taskId)
    const runs = await deps.runs.list({ taskId } as Partial<SwarmRun>)
    if (runs.some((run) => activeRunStatuses.has(run.status))) {
      throw new Error("请先取消运行后再删除任务")
    }

    const workers = await deps.workers.list({ taskId } as Partial<SwarmWorkerRun>)
    await Promise.all(workers.map((worker) => deps.workers.remove(worker.id)))
    await Promise.all(runs.map((run) => deps.runs.remove(run.id)))
    await deps.tasks.remove(taskId)
    emitChanged({ taskId, reason: "task-deleted" })
  }

  async function startRun(input: SwarmRunStartInput): Promise<SwarmRun> {
    const parsed = swarmRunStartInputSchema.parse(input)
    const task = await requireTask(parsed.taskId)
    const runId = createId()
    const configSnapshot = mergeConfigSnapshot(task.currentConfig, parsed.configOverride)
    await deps.resolveProjectPath(configSnapshot.projectId)
    const run: SwarmRun = {
      id: runId,
      schemaVersion: 1,
      taskId: task.id,
      status: "running",
      configSnapshot,
      startedAt: timestamp(),
      totals: { started: 0, success: 0, failed: 0, cancelled: 0, timeout: 0 },
      outputDirectory: path.join(deps.outputRoot, runId),
      stopRequested: false,
    }

    await deps.runs.upsert(run)
    await deps.tasks.upsert({ ...task, lastRunId: run.id, lastStatus: "running", updatedAt: timestamp() })
    emitChanged({ taskId: task.id, runId: run.id, reason: "run-started" })

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
    const latestRun = await deps.runs.get(runId)
    if (!latestRun) return null
    if (terminalRunStatuses.has(latestRun.status)) {
      return latestRun
    }
    const updated: SwarmRun = { ...latestRun, status: "draining", stopRequested: true }
    await deps.runs.upsert(updated)
    emitChanged({ taskId: updated.taskId, runId: updated.id, reason: "run-draining" })
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
    const latestRun = await deps.runs.get(runId)
    if (!latestRun) {
      await runningRuns.get(runId)?.catch(() => undefined)
      return null
    }
    if (terminalRunStatuses.has(latestRun.status)) {
      await runningRuns.get(runId)?.catch(() => undefined)
      return latestRun
    }
    const updated: SwarmRun = {
      ...latestRun,
      status: "cancelled",
      stopRequested: true,
      finishedAt: timestamp(),
    }
    await deps.runs.upsert(updated)
    const task = await requireTask(latestRun.taskId)
    await deps.tasks.upsert({
      ...task,
      lastRunId: latestRun.id,
      lastStatus: "cancelled",
      updatedAt: timestamp(),
    })
    emitChanged({ taskId: latestRun.taskId, runId: latestRun.id, reason: "run-cancelled" })
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
      emitChanged({ taskId, runId: run.id, reason: "run-finished" })
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
      emitChanged({ taskId, runId: run.id, reason: "run-failed" })
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
      const previousHandoffs = input.config.promptInjection.previousHandoff.enabled
        ? previousHandoffsForWorker(previousWorkers, input)
        : []

      const worker: SwarmWorkerRun = {
        id: createId(),
        schemaVersion: 1,
        taskId: input.taskId,
        runId: input.runId,
        workerIndex: input.workerIndex,
        roundIndex: input.roundIndex,
        sequenceIndex: input.sequenceIndex,
        slotIndex: input.slotIndex,
        batchIndex: input.batchIndex,
        status: "running",
        sessionKey: `swarm:${input.taskId}:${input.runId}`,
        startedAt: timestamp(),
        lastPhase: "queued",
      }
      await deps.workers.upsert(worker)
      emitChanged({ taskId: input.taskId, runId: input.runId, workerRunId: worker.id, reason: "worker-started" })

      const prompt = buildSwarmWorkerPrompt({
        taskId: input.taskId,
        runId: input.runId,
        workerIndex: input.workerIndex,
        roundIndex: input.roundIndex,
        sequenceIndex: input.sequenceIndex,
        slotIndex: input.slotIndex,
        batchIndex: input.batchIndex,
        config: input.config,
        recentSummaries: previousWorkers,
        previousHandoffs,
      })

      try {
        const workspacePath = await deps.resolveProjectPath(run.configSnapshot.projectId)
        const result = await deps.agent.sendWorker({
          task,
          run,
          worker,
          prompt,
          workspacePath,
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
    const summaryEnabled = input.input.config.promptInjection.summary.enabled
    const handoffEnabled = input.input.config.promptInjection.previousHandoff.enabled
    const summary = summaryEnabled
      ? extracted.summary ?? fallbackSummary(outcome.resultText)
      : undefined
    const summaryFallback = summaryEnabled && !extracted.summary
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
      ...(handoffEnabled && extracted.handoff ? { handoff: extracted.handoff } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    }
    await deps.workers.upsert(updated)
    emitChanged({
      taskId: updated.taskId,
      runId: updated.runId,
      workerRunId: updated.id,
      reason: "worker-finished",
    })

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
    emitChanged({
      taskId: worker.taskId,
      runId: worker.runId,
      workerRunId: worker.id,
      reason: "worker-conversation",
    })
  }

  function emitChanged(payload: SwarmTaskChangedEvent): void {
    deps.eventBus?.emit({
      domain: "swarm-task",
      type: "swarm-task.changed",
      payload,
      timestamp: timestamp(),
    }, { backpressure: "coalesce" })
  }

  return {
    initialize,
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
  const normalizedBase = normalizeSwarmTaskConfig(base)
  if (!override) {
    return normalizedBase
  }

  return swarmTaskConfigSchema.parse({
    ...normalizedBase,
    ...override,
    promptInjection: {
      ...normalizedBase.promptInjection,
      ...override.promptInjection,
      sequenceBatch: {
        ...normalizedBase.promptInjection.sequenceBatch,
        ...override.promptInjection?.sequenceBatch,
      },
      previousHandoff: {
        ...normalizedBase.promptInjection.previousHandoff,
        ...override.promptInjection?.previousHandoff,
      },
      summary: {
        ...normalizedBase.promptInjection.summary,
        ...override.promptInjection?.summary,
      },
      fileWrite: {
        ...normalizedBase.promptInjection.fileWrite,
        ...override.promptInjection?.fileWrite,
        lock: {
          ...normalizedBase.promptInjection.fileWrite.lock,
          ...override.promptInjection?.fileWrite?.lock,
        },
      },
    },
    agent: {
      ...normalizedBase.agent,
      ...override.agent,
    },
  })
}

function previousHandoffsForWorker(
  workers: readonly SwarmWorkerRun[],
  current: {
    readonly config: SwarmTaskConfig
    readonly batchIndex: number
    readonly roundIndex: number
    readonly slotIndex: number
  },
): Array<{
  workerIndex: number
  sequenceIndex: number
  slotIndex: number
  batchIndex: number
  handoff: string
}> {
  if (current.config.runMode === "continuous") {
    return previousSlotHandoff(workers, current.slotIndex, current.roundIndex)
  }
  return previousBatchHandoffs(workers, current.batchIndex)
}

function previousBatchHandoffs(
  workers: readonly SwarmWorkerRun[],
  currentBatchIndex: number,
): Array<{
  workerIndex: number
  sequenceIndex: number
  slotIndex: number
  batchIndex: number
  handoff: string
}> {
  const previousBatchIndex = currentBatchIndex - 1
  if (previousBatchIndex < 1) return []

  return workers
    .filter((worker) => (worker.batchIndex ?? inferBatchIndex(worker)) === previousBatchIndex)
    .filter((worker) => worker.handoff?.trim())
    .sort((left, right) =>
      (left.sequenceIndex ?? left.roundIndex) - (right.sequenceIndex ?? right.roundIndex)
      || left.workerIndex - right.workerIndex)
    .map((worker) => ({
      workerIndex: worker.workerIndex,
      sequenceIndex: worker.sequenceIndex ?? worker.roundIndex,
      slotIndex: worker.slotIndex ?? worker.workerIndex,
      batchIndex: worker.batchIndex ?? inferBatchIndex(worker),
      handoff: worker.handoff?.trim() ?? "",
    }))
}

function previousSlotHandoff(
  workers: readonly SwarmWorkerRun[],
  currentSlotIndex: number,
  currentRoundIndex: number,
): Array<{
  workerIndex: number
  sequenceIndex: number
  slotIndex: number
  batchIndex: number
  handoff: string
}> {
  const previousRoundIndex = currentRoundIndex - 1
  if (previousRoundIndex < 1) return []

  return workers
    .filter((worker) => (worker.slotIndex ?? worker.workerIndex) === currentSlotIndex)
    .filter((worker) => worker.roundIndex === previousRoundIndex)
    .filter((worker) => worker.handoff?.trim())
    .sort((left, right) =>
      (left.sequenceIndex ?? left.roundIndex) - (right.sequenceIndex ?? right.roundIndex)
      || left.workerIndex - right.workerIndex)
    .map((worker) => ({
      workerIndex: worker.workerIndex,
      sequenceIndex: worker.sequenceIndex ?? worker.roundIndex,
      slotIndex: worker.slotIndex ?? worker.workerIndex,
      batchIndex: worker.batchIndex ?? inferBatchIndex(worker),
      handoff: worker.handoff?.trim() ?? "",
    }))
}

function inferBatchIndex(worker: SwarmWorkerRun): number {
  return worker.batchIndex ?? 1
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const { name } = error as { name?: unknown }
  return name === "AbortError"
}
