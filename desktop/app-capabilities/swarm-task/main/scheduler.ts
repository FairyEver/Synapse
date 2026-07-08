import type { SwarmTaskConfig, SwarmWorkerRunStatus } from "../shared/schema"

export type SwarmWorkerRunnerInput = {
  readonly taskId: string
  readonly runId: string
  readonly workerIndex: number
  readonly roundIndex: number
  readonly sequenceIndex: number
  readonly slotIndex: number
  readonly batchIndex: number
  readonly config: SwarmTaskConfig
  readonly abortSignal?: AbortSignal
}

export type SwarmWorkerRunnerResult = {
  readonly status: Extract<SwarmWorkerRunStatus, "success" | "failed" | "cancelled" | "timeout">
  readonly resultText: string
  readonly error?: string
}

export type SwarmWorkerRunner = (input: SwarmWorkerRunnerInput) => Promise<SwarmWorkerRunnerResult>

export type SwarmSchedulerResult = {
  readonly status: "success" | "partial" | "failed" | "cancelled"
  readonly totals: SwarmSchedulerTotals
}

type SwarmSchedulerTotals = {
  started: number
  success: number
  failed: number
  cancelled: number
  timeout: number
}

export type SwarmSchedulerStartInput = {
  readonly taskId: string
  readonly runId: string
  readonly config: SwarmTaskConfig
}

export type SwarmSchedulerDeps = {
  readonly runner: SwarmWorkerRunner
}

export interface SwarmScheduler {
  start(input: SwarmSchedulerStartInput): Promise<SwarmSchedulerResult>
  stopRefill(runId: string): void
  cancel(runId: string): Promise<void>
}

type RunControl = {
  stopRefill: boolean
  abort: AbortController
}

export function createSwarmScheduler(deps: SwarmSchedulerDeps): SwarmScheduler {
  const controls = new Map<string, RunControl>()

  async function start(input: SwarmSchedulerStartInput): Promise<SwarmSchedulerResult> {
    const control: RunControl = {
      stopRefill: false,
      abort: new AbortController(),
    }
    controls.set(input.runId, control)

    const totals: SwarmSchedulerResult["totals"] = {
      started: 0,
      success: 0,
      failed: 0,
      cancelled: 0,
      timeout: 0,
    }

    let nextRound = 1

    const runRound = async (slotIndex: number, sequenceIndex: number): Promise<void> => {
      totals.started++
      const batchIndex = Math.floor((sequenceIndex - 1) / input.config.concurrency) + 1
      const outcome = await runWorker(deps.runner, {
        taskId: input.taskId,
        runId: input.runId,
        workerIndex: slotIndex,
        roundIndex: sequenceIndex,
        sequenceIndex,
        slotIndex,
        batchIndex,
        config: input.config,
        abortSignal: control.abort.signal,
      })

      if (outcome.status === "success") {
        totals.success++
        return
      }

      if (outcome.status === "failed") {
        totals.failed++
        return
      }

      if (outcome.status === "cancelled") {
        totals.cancelled++
        return
      }

      totals.timeout++
    }

    const runSlot = async (slotIndex: number): Promise<void> => {
      while (!control.stopRefill && !control.abort.signal.aborted) {
        if (nextRound > input.config.maxRounds) return
        const sequenceIndex = nextRound
        nextRound++
        await runRound(slotIndex, sequenceIndex)
      }
    }

    const slotCount = Math.min(input.config.concurrency, input.config.maxRounds)

    try {
      await Promise.all(Array.from({ length: slotCount }, (_, index) => runSlot(index + 1)))
    } finally {
      controls.delete(input.runId)
    }

    return {
      status: classifyTotals(totals),
      totals,
    }
  }

  return {
    start,
    stopRefill(runId: string): void {
      const control = controls.get(runId)
      if (control) control.stopRefill = true
    },
    async cancel(runId: string): Promise<void> {
      const control = controls.get(runId)
      if (!control) return
      control.stopRefill = true
      control.abort.abort("swarm-cancel")
    },
  }
}

async function runWorker(
  runner: SwarmWorkerRunner,
  input: SwarmWorkerRunnerInput,
): Promise<SwarmWorkerRunnerResult> {
  const { abortSignal } = input
  if (abortSignal?.aborted) {
    return {
      status: "cancelled",
      resultText: "",
    }
  }

  try {
    return await runner(input)
  } catch (error) {
    if (isAbortError(error)) {
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
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const { name } = error as { name?: unknown }
  return name === "AbortError"
}

function classifyTotals(totals: SwarmSchedulerResult["totals"]): SwarmSchedulerResult["status"] {
  if (totals.started > 0 && totals.success === totals.started) {
    return "success"
  }
  if (totals.success > 0) {
    return "partial"
  }
  if (totals.started > 0 && totals.cancelled === totals.started && totals.failed === 0 && totals.timeout === 0) {
    return "cancelled"
  }
  return "failed"
}
