import type { SwarmTaskConfig, SwarmWorkerRunStatus } from "../shared/schema"

export type SwarmWorkerRunnerInput = {
  readonly taskId: string
  readonly runId: string
  readonly workerIndex: number
  readonly roundIndex: number
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
  readonly totals: {
    readonly started: number
    readonly success: number
    readonly failed: number
    readonly cancelled: number
    readonly timeout: number
  }
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

    const runRound = async (workerIndex: number, roundIndex: number): Promise<void> => {
      totals.started++
      const outcome = await runWorker(deps.runner, {
        taskId: input.taskId,
        runId: input.runId,
        workerIndex,
        roundIndex,
        config: input.config,
        abortSignal: control.abort.signal,
      })

      if (outcome.kind === "aborted") {
        totals.cancelled++
        return
      }

      if (outcome.kind === "error") {
        totals.failed++
        return
      }

      if (outcome.value.status === "success") {
        totals.success++
        return
      }

      if (outcome.value.status === "failed") {
        totals.failed++
        return
      }

      if (outcome.value.status === "cancelled") {
        totals.cancelled++
        return
      }

      totals.timeout++
    }

    const runSlot = async (workerIndex: number): Promise<void> => {
      while (!control.stopRefill && !control.abort.signal.aborted) {
        if (nextRound > input.config.maxRounds) return
        const roundIndex = nextRound
        nextRound++
        await runRound(workerIndex, roundIndex)
        if (input.config.runMode === "batch") return
      }
    }

    const slotCount =
      input.config.runMode === "batch"
        ? Math.min(input.config.concurrency, input.config.maxRounds)
        : input.config.concurrency

    try {
      await Promise.all(Array.from({ length: slotCount }, (_, index) => runSlot(index + 1)))
    } finally {
      controls.delete(input.runId)
    }

    return {
      status: classifyTotals(totals, control.abort.signal.aborted),
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

type RunnerOutcome =
  | { readonly kind: "result"; readonly value: SwarmWorkerRunnerResult }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "aborted" }

async function runWorker(
  runner: SwarmWorkerRunner,
  input: SwarmWorkerRunnerInput,
): Promise<RunnerOutcome> {
  const { abortSignal } = input
  if (abortSignal.aborted) {
    return { kind: "aborted" }
  }

  try {
    return {
      kind: "result",
      value: await runner(input),
    }
  } catch (error) {
    return {
      kind: "error",
      error,
    }
  }
}

function classifyTotals(
  totals: SwarmSchedulerResult["totals"],
  aborted: boolean,
): SwarmSchedulerResult["status"] {
  if (totals.started > 0 && totals.success === totals.started) {
    return "success"
  }
  if (totals.success > 0) {
    return "partial"
  }
  if (aborted || (totals.cancelled > 0 && totals.failed === 0 && totals.timeout === 0)) {
    return "cancelled"
  }
  return "failed"
}
