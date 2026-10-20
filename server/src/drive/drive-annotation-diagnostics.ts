import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import { performance } from "node:perf_hooks"
import { Logger } from "@nestjs/common"

type AnnotationOperation = "owner.list" | "share.list" | "owner.create" | "share.create" | "owner.delete" | "share.delete"
type AnnotationStage = "access" | "threads.read" | "version.read" | "anchor.validate" | "idempotency.read"
  | "write.transaction" | "audit" | "comment.read" | "anchors.refresh" | "document.resolve"
  | "document.source" | "document.projection" | "document.previousProjection" | "document.render" | "document.epoch"
  | "diff.map" | "anchor.resolve" | "anchor.persist" | "thread.persist"
  | "transaction.lock" | "notifications.enqueue" | "write.access" | "write.save"
type AnnotationMetric = "threadCount" | "commentCount" | "sourceChars" | "renderedChars" | "diffVersionCount"
  | "hasLiveDocument" | "hasStoredProjection" | "anchorCount" | "deletedCommentCount"
type StageTiming = { calls: number; failures: number; totalWorkMs: number; maxMs: number }
type AnnotationTrace = { stages: Partial<Record<AnnotationStage, StageTiming>>; metrics: Partial<Record<AnnotationMetric, number>> }

const traces = new AsyncLocalStorage<AnnotationTrace>()
const logger = new Logger("DriveAnnotationDiagnostics")
let activeOperations = 0

export async function traceAnnotationOperation<T>(operation: AnnotationOperation, work: () => Promise<T>): Promise<T> {
  const startedAt = performance.now()
  const eventLoopStart = performance.eventLoopUtilization()
  const activeAtStart = ++activeOperations
  const trace: AnnotationTrace = { stages: {}, metrics: {} }
  return traces.run(trace, async () => {
    let outcome = "failure"
    try {
      const result = await work()
      outcome = "success"
      return result
    } finally {
      const eventLoop = performance.eventLoopUtilization(eventLoopStart)
      activeOperations -= 1
      logger.log({
        event: "drive.annotation.performance", traceId: randomUUID(), operation, outcome,
        durationMs: round(performance.now() - startedAt), activeAtStart, activeAtFinish: activeOperations,
        // Event loop activity is process-wide; parallel stage durations are accumulated work, not wall time.
        eventLoopActiveMs: round(eventLoop.active), eventLoopIdleMs: round(eventLoop.idle),
        stages: Object.fromEntries(Object.entries(trace.stages).map(([name, stage]) => [name, {
          ...stage, totalWorkMs: round(stage.totalWorkMs), maxMs: round(stage.maxMs),
        }])),
        metrics: trace.metrics,
      }, "Drive annotation performance")
    }
  })
}

export async function measureAnnotationStage<T>(stage: AnnotationStage, work: () => Promise<T>): Promise<T> {
  const trace = traces.getStore()
  if (!trace) return work()
  const startedAt = performance.now()
  let failed = true
  try {
    const result = await work()
    failed = false
    return result
  } finally {
    recordStageTiming(trace, stage, performance.now() - startedAt, failed)
  }
}

export function measureAnnotationStageSync<T>(stage: AnnotationStage, work: () => T): T {
  const trace = traces.getStore()
  if (!trace) return work()
  const startedAt = performance.now()
  let failed = true
  try {
    const result = work()
    failed = false
    return result
  } finally {
    recordStageTiming(trace, stage, performance.now() - startedAt, failed)
  }
}

export function recordAnnotationMetrics(metrics: Partial<Record<AnnotationMetric, number>>): void {
  const trace = traces.getStore()
  if (trace) Object.assign(trace.metrics, metrics)
}

function round(value: number): number { return Math.round(value * 100) / 100 }

function recordStageTiming(trace: AnnotationTrace, stage: AnnotationStage, elapsed: number, failed: boolean): void {
  const timing = trace.stages[stage] ??= { calls: 0, failures: 0, totalWorkMs: 0, maxMs: 0 }
  timing.calls += 1
  timing.failures += Number(failed)
  timing.totalWorkMs += elapsed
  timing.maxMs = Math.max(timing.maxMs, elapsed)
}
