import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow.scheduler")

export interface NodeExecOutcome {
  nodeId: string
  status: "success" | "failed" | "cancelled" | "skipped"
  output?: string
  outputs?: Record<string, unknown>
  activeBranch?: string
  error?: string
  durationMs?: number
}

export interface NodeTask {
  nodeId: string
  execute: () => Promise<NodeExecOutcome>
}

export interface SchedulerOptions {
  maxConcurrency?: number
  runId?: string
}

export interface SchedulerCallbacks {
  onNodeReady: (nodeId: string) => void
  onNodeDone: (outcome: NodeExecOutcome) => void
  resolveActivatedDownstream: (nodeId: string, outcome: NodeExecOutcome) => string[]
}

export class ReactiveScheduler {
  private readonly maxConcurrency: number
  private readonly runId?: string

  constructor(options?: SchedulerOptions) {
    this.maxConcurrency = options?.maxConcurrency ?? 0
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
    const waitQueue: string[] = []
    let failed = false

    const downstreamOf = (nodeId: string) => edges.filter((e) => e.from === nodeId).map((e) => e.to)
    const decrementPending = (nodeId: string): number | undefined => {
      const curr = pending.get(nodeId)
      if (curr === undefined) return undefined
      const updated = curr - 1
      pending.set(nodeId, updated)
      return updated
    }
    const skipNodeAndPropagate = (nodeId: string) => {
      if (results.has(nodeId) || running.has(nodeId)) return
      const queuedIndex = waitQueue.indexOf(nodeId)
      if (queuedIndex >= 0) waitQueue.splice(queuedIndex, 1)
      results.set(nodeId, { nodeId, status: "skipped" })
      for (const next of downstreamOf(nodeId)) releaseSkippedDependency(next)
    }
    const releaseSkippedDependency = (nodeId: string) => {
      const updated = decrementPending(nodeId)
      if (updated !== 0) return
      if ((activeSignals.get(nodeId) ?? 0) > 0) tryStart(nodeId)
      else skipNodeAndPropagate(nodeId)
    }

    const tryStart = (nodeId: string) => {
      if (failed || abortSignal.aborted) return
      if (this.maxConcurrency > 0 && running.size >= this.maxConcurrency) {
        waitQueue.push(nodeId)
        return
      }
      const task = taskFactory(nodeId)
      callbacks.onNodeReady(nodeId)
      const promise = task.execute().then((outcome) => {
        results.set(nodeId, outcome)
        running.delete(nodeId)
        callbacks.onNodeDone(outcome)
        if (outcome.status === "failed") {
          failed = true
          logger.info("scheduler: node failed, stopping new launches", { nodeId, ...(this.runId ? { runId: this.runId } : {}) })
          for (const queued of waitQueue) {
            results.set(queued, { nodeId: queued, status: "skipped", error: "upstream failed" })
          }
          waitQueue.length = 0
          // Release downstream dependencies so the skip propagates eagerly
          // through the DAG rather than waiting for the final cleanup loop.
          for (const next of downstreamOf(nodeId)) {
            releaseSkippedDependency(next)
          }
          return
        }
        const downstream = callbacks.resolveActivatedDownstream(nodeId, outcome)
        const activatedSet = new Set(downstream)
        for (const next of downstream) {
          activeSignals.set(next, (activeSignals.get(next) ?? 0) + 1)
          const updated = decrementPending(next)
          if (updated === 0) tryStart(next)
        }
        for (const next of downstreamOf(nodeId)) {
          if (!activatedSet.has(next)) releaseSkippedDependency(next)
        }
        while (this.maxConcurrency > 0 && waitQueue.length > 0 && running.size < this.maxConcurrency) {
          tryStart(waitQueue.shift()!)
        }
      }).catch((err: unknown) => {
        // If task.execute() throws (not just returns failed status), catch
        // the rejection to prevent unhandledRejection and abort listener leak.
        running.delete(nodeId)
        const message = err instanceof Error ? err.message : String(err)
        const outcome: NodeExecOutcome = { nodeId, status: "failed", error: message }
        results.set(nodeId, outcome)
        callbacks.onNodeDone(outcome)
        failed = true
        logger.error("scheduler: node execution threw unexpectedly", { nodeId, error: message, ...(this.runId ? { runId: this.runId } : {}) })
        for (const queued of waitQueue) {
          results.set(queued, { nodeId: queued, status: "skipped", error: "upstream failed" })
        }
        waitQueue.length = 0
        for (const next of downstreamOf(nodeId)) {
          releaseSkippedDependency(next)
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
        await Promise.allSettled([...running.values()])
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
        results.set(id, { nodeId: id, status: "skipped", ...(failed ? { error: "upstream failed" } : {}) })
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
