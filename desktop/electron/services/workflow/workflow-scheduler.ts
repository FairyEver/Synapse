import { createMainLogger } from "../log-store"
import type { SynapseAgentConversationTarget } from "../../../src/types/agent-navigation"
import type { WorkflowNodeUsageCostSnapshot } from "../../../src/types/workflow"

const logger = createMainLogger("service.workflow.scheduler")

export interface NodeExecOutcome {
  nodeId: string
  status: "success" | "failed" | "cancelled" | "skipped"
  output?: string
  outputs?: Record<string, unknown>
  logs?: readonly { readonly label: string; readonly value: string }[]
  activeBranch?: string
  error?: string
  errorCode?: string
  errorReason?: string
  durationMs?: number
  usage?: Record<string, unknown>
  modelName?: string
  costUsd?: number
  costCny?: number
  costBreakdownCny?: WorkflowNodeUsageCostSnapshot["costBreakdownCny"]
  costCurrency?: "CNY"
  usageCost?: WorkflowNodeUsageCostSnapshot
  agentConversation?: SynapseAgentConversationTarget
}

export interface NodeTask {
  nodeId: string
  execute: () => Promise<NodeExecOutcome>
}

export interface SchedulerOptions {
  maxConcurrency?: number
  cancelGraceMs?: number
  runId?: string
}

export interface SchedulerCallbacks {
  onNodeReady: (nodeId: string) => void
  onNodeDone: (outcome: NodeExecOutcome) => void
  resolveActivatedDownstream: (nodeId: string, outcome: NodeExecOutcome) => string[]
}

export class ReactiveScheduler {
  private readonly maxConcurrency: number
  private readonly cancelGraceMs: number
  private readonly runId?: string

  constructor(options?: SchedulerOptions) {
    // 0 means unlimited concurrency. Callers that need a cap should pass a positive value.
    this.maxConcurrency = options?.maxConcurrency ?? 0
    this.cancelGraceMs = options?.cancelGraceMs ?? 5_000
    this.runId = options?.runId
  }

  async execute(
    nodes: string[],
    edges: Array<{ from: string; to: string }>,
    taskFactory: (nodeId: string) => NodeTask,
    callbacks: SchedulerCallbacks,
    abortSignal: AbortSignal,
  ): Promise<Map<string, NodeExecOutcome>> {
    logger.info("scheduler: execute started", {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      maxConcurrency: this.maxConcurrency,
      ...(this.runId ? { runId: this.runId } : {}),
    })
    const nodeSet = new Set(nodes)
    const pending = new Map<string, number>()
    for (const id of nodes) pending.set(id, 0)
    for (const e of edges) {
      if (nodeSet.has(e.from) && nodeSet.has(e.to)) {
        pending.set(e.to, (pending.get(e.to) ?? 0) + 1)
      }
    }

    const running = new Map<string, Promise<void>>()
    const results = new Map<string, NodeExecOutcome>()
    const activeSignals = new Map<string, number>()
    const failedUpstream = new Set<string>()
    const waitQueue: string[] = []
    let hadFailure = false
    let acceptingResults = true

    const downstreamOf = (nodeId: string) => edges.filter((e) => e.from === nodeId).map((e) => e.to)
    const decrementPending = (nodeId: string): number | undefined => {
      const curr = pending.get(nodeId)
      if (curr === undefined) return undefined
      const updated = curr - 1
      pending.set(nodeId, updated)
      return updated
    }
    const skipNodeAndPropagate = (nodeId: string, error?: string) => {
      if (results.has(nodeId) || running.has(nodeId)) return
      const queuedIndex = waitQueue.indexOf(nodeId)
      if (queuedIndex >= 0) waitQueue.splice(queuedIndex, 1)
      const outcome: NodeExecOutcome = { nodeId, status: "skipped", ...(error ? { error } : {}) }
      results.set(nodeId, outcome)
      callbacks.onNodeDone(outcome)
      for (const next of downstreamOf(nodeId)) {
        if (error) skipNodeAndPropagate(next, error)
        else releaseSkippedDependency(next)
      }
    }
    const releaseSkippedDependency = (nodeId: string) => {
      const updated = decrementPending(nodeId)
      if (updated !== 0) return
      if (failedUpstream.has(nodeId)) skipNodeAndPropagate(nodeId, "upstream failed")
      else if ((activeSignals.get(nodeId) ?? 0) > 0) tryStart(nodeId)
      else skipNodeAndPropagate(nodeId)
    }
    const releaseFailedDependency = (nodeId: string) => {
      failedUpstream.add(nodeId)
      const updated = decrementPending(nodeId)
      if (updated !== 0) return
      skipNodeAndPropagate(nodeId, "upstream failed")
    }
    const recordCancelledNode = (nodeId: string, error = "运行被取消") => {
      if (results.has(nodeId)) return
      const outcome: NodeExecOutcome = { nodeId, status: "cancelled", error }
      results.set(nodeId, outcome)
      try {
        callbacks.onNodeDone(outcome)
      } catch (err) {
        logger.error("scheduler: onNodeDone callback threw", {
          nodeId,
          error: err instanceof Error ? err.message : String(err),
          ...(this.runId ? { runId: this.runId } : {}),
        })
      }
    }

    const tryStart = (nodeId: string) => {
      if (abortSignal.aborted) return
      if (this.maxConcurrency > 0 && running.size >= this.maxConcurrency) {
        waitQueue.push(nodeId)
        return
      }
      let task: NodeTask
      try {
        task = taskFactory(nodeId)
        callbacks.onNodeReady(nodeId)
      } catch (err) {
        hadFailure = true
        const message = err instanceof Error ? err.message : String(err)
        const outcome: NodeExecOutcome = { nodeId, status: "failed", error: message }
        results.set(nodeId, outcome)
        callbacks.onNodeDone(outcome)
        logger.error("scheduler: task factory threw unexpectedly", { nodeId, error: message, ...(this.runId ? { runId: this.runId } : {}) })
        for (const next of downstreamOf(nodeId)) {
          releaseFailedDependency(next)
        }
        return
      }
      const promise = task.execute().then((outcome) => {
        if (!acceptingResults) return
        results.set(nodeId, outcome)
        running.delete(nodeId)
        try {
          callbacks.onNodeDone(outcome)
        } catch (err) {
          logger.error("scheduler: onNodeDone callback threw", {
            nodeId,
            error: err instanceof Error ? err.message : String(err),
            ...(this.runId ? { runId: this.runId } : {}),
          })
        }
        if (outcome.status === "failed") {
          hadFailure = true
          logger.info("scheduler: node failed, stopping new launches", { nodeId, ...(this.runId ? { runId: this.runId } : {}) })
          // Release downstream dependencies so the skip propagates eagerly
          // through the DAG rather than waiting for the final cleanup loop.
          for (const next of downstreamOf(nodeId)) {
            releaseFailedDependency(next)
          }
        } else {
          let downstream: string[]
          try {
            downstream = callbacks.resolveActivatedDownstream(nodeId, outcome)
          } catch (err) {
            downstream = []
            logger.error("scheduler: resolveActivatedDownstream callback threw", {
              nodeId,
              error: err instanceof Error ? err.message : String(err),
              ...(this.runId ? { runId: this.runId } : {}),
            })
          }
          const activatedSet = new Set(downstream)
          for (const next of downstream) {
            activeSignals.set(next, (activeSignals.get(next) ?? 0) + 1)
            const updated = decrementPending(next)
            if (updated === 0) {
              if (failedUpstream.has(next)) skipNodeAndPropagate(next, "upstream failed")
              else tryStart(next)
            }
          }
          for (const next of downstreamOf(nodeId)) {
            if (!activatedSet.has(next)) releaseSkippedDependency(next)
          }
        }
        while (this.maxConcurrency > 0 && waitQueue.length > 0 && running.size < this.maxConcurrency) {
          tryStart(waitQueue.shift()!)
        }
      }).catch((err: unknown) => {
        if (!acceptingResults) return
        if (results.has(nodeId)) {
          // .then() callback already recorded the result but downstream release
          // may not have completed — only possible if a non-callback exception
          // escapes past the try/catch guards above. Log and skip synthetic
          // failure to avoid overwriting the real outcome.
          running.delete(nodeId)
          logger.warn("scheduler: .then callback threw after result was recorded", { nodeId, error: err instanceof Error ? err.message : String(err), ...(this.runId ? { runId: this.runId } : {}) })
          return
        }
        // If task.execute() throws (not just returns failed status), catch
        // the rejection to prevent unhandledRejection and abort listener leak.
        running.delete(nodeId)
        const message = err instanceof Error ? err.message : String(err)
        const outcome: NodeExecOutcome = { nodeId, status: "failed", error: message }
        results.set(nodeId, outcome)
        callbacks.onNodeDone(outcome)
        hadFailure = true
        logger.error("scheduler: node execution threw unexpectedly", { nodeId, error: message, ...(this.runId ? { runId: this.runId } : {}) })
        for (const next of downstreamOf(nodeId)) {
          releaseFailedDependency(next)
        }
        while (this.maxConcurrency > 0 && waitQueue.length > 0 && running.size < this.maxConcurrency) {
          tryStart(waitQueue.shift()!)
        }
      })
      running.set(nodeId, promise)
    }

    for (const [nodeId, count] of pending) {
      if (count === 0) tryStart(nodeId)
    }
    while (running.size > 0) {
      if (abortSignal.aborted) {
        // Abort fired — wait for in-flight tasks to finish so their
        // onNodeDone callbacks complete before we return results.
        // Tasks check the signal and should resolve promptly.
        logger.info("scheduler: abort detected, waiting for in-flight nodes", {
          runningNodeCount: running.size,
          runningNodeIds: [...running.keys()],
          queuedNodeCount: waitQueue.length,
          ...(this.runId ? { runId: this.runId } : {}),
        })
        const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), this.cancelGraceMs))
        const settled = await Promise.race([Promise.allSettled([...running.values()]), timeout])
        if (settled === "timeout") {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          const timedOutRunning = [...running.entries()]
          acceptingResults = false
          for (const [nodeId, promise] of timedOutRunning) {
            recordCancelledNode(nodeId, "运行被取消（取消宽限期超时）")
            void promise.then(() => {
              logger.warn("scheduler: node settled after abort grace timeout", {
                nodeId,
                ...(this.runId ? { runId: this.runId } : {}),
              })
            })
          }
          running.clear()
          waitQueue.length = 0
          logger.warn("scheduler: abort grace timeout elapsed", {
            cancelGraceMs: this.cancelGraceMs,
            runningNodeIds: timedOutRunning.map(([nodeId]) => nodeId),
            ...(this.runId ? { runId: this.runId } : {}),
          })
        }
        break
      }
      let abortHandler!: () => void
      const abortPromise = new Promise<void>((resolve) => {
        abortHandler = resolve
        abortSignal.addEventListener("abort", abortHandler, { once: true })
        // Signal may have been aborted between the while-loop check above and
        // this point. The listener won't fire for past events, so resolve manually.
        if (abortSignal.aborted) resolve()
      })
      try {
        await Promise.race([...running.values(), abortPromise])
      } finally {
        // Clean up the abort listener whether the race resolved normally
        // (task finished) or abnormally (task promise rejected). Without
        // the finally, a rejected task would skip cleanup and leak a
        // listener on the AbortSignal until it is GC'd.
        abortSignal.removeEventListener("abort", abortHandler)
      }
    }
    for (const id of nodes) {
      if (!results.has(id)) {
        if (abortSignal.aborted) {
          results.set(id, { nodeId: id, status: "cancelled", error: "运行被取消" })
        } else {
          results.set(id, { nodeId: id, status: "skipped", ...(hadFailure ? { error: "upstream failed" } : {}) })
        }
      }
    }
    const counts = schedulerResultCounts(results)
    logger.info("scheduler: execute done", {
      ...counts,
      ...(this.runId ? { runId: this.runId } : {}),
    })
    return results
  }
}

function schedulerResultCounts(results: Map<string, NodeExecOutcome>): {
  readonly successCount: number
  readonly failedCount: number
  readonly skippedCount: number
  readonly cancelledCount: number
} {
  let successCount = 0
  let failedCount = 0
  let skippedCount = 0
  let cancelledCount = 0
  for (const outcome of results.values()) {
    switch (outcome.status) {
      case "success": successCount++; break
      case "failed": failedCount++; break
      case "skipped": skippedCount++; break
      case "cancelled": cancelledCount++; break
    }
  }
  return { successCount, failedCount, skippedCount, cancelledCount }
}
