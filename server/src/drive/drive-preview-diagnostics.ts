import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'
import { Logger } from '@nestjs/common'

type Stage = 'access' | 'source' | 'projection.read' | 'projection.previous' | 'parse' | 'projection.persist' | 'render' | 'images'
type Trace = { stages: Partial<Record<Stage, { calls: number; ms: number }>>; cacheHit: number; shared: number }
const traces = new AsyncLocalStorage<Trace>()
const logger = new Logger('DrivePreviewDiagnostics')

export async function traceDrivePreview<T>(context: 'owner' | 'share', work: () => Promise<T>): Promise<T> {
  const started = performance.now()
  const trace: Trace = { stages: {}, cacheHit: 0, shared: 0 }
  return traces.run(trace, async () => {
    let success = false
    try { const result = await work(); success = true; return result }
    finally { logger.log({ event: 'drive.preview.performance', context, success, durationMs: performance.now() - started, ...trace }) }
  })
}

export async function measureDrivePreview<T>(stage: Stage, work: () => Promise<T>): Promise<T> {
  const trace = traces.getStore()
  if (!trace) return work()
  const started = performance.now()
  try { return await work() }
  finally {
    const value = trace.stages[stage] ?? { calls: 0, ms: 0 }
    value.calls += 1
    value.ms += performance.now() - started
    trace.stages[stage] = value
  }
}

export function recordDrivePreviewCache(status: 'hit' | 'shared' | 'computed'): void {
  const trace = traces.getStore()
  if (trace) { trace.cacheHit += Number(status === 'hit'); trace.shared += Number(status === 'shared') }
}
