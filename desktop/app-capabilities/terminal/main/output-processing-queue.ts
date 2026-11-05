export type TerminalProcessingQueueLimits = {
  readonly maxBytes: number
  readonly maxTasks: number
  readonly highBytes: number
  readonly lowBytes: number
  readonly highTasks: number
  readonly lowTasks: number
}

export class TerminalProcessingQueueError extends Error {
  constructor(readonly code: "emulator_queue_overflow" | "emulator_disposed" | "emulator_unavailable") {
    super(code)
  }
}

type Work = {
  readonly bytes: number
  readonly enqueuedAt: number
  readonly run: (signal: AbortSignal) => unknown
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
  settled: boolean
}

/** 串行、带背压的解析任务队列；resize 与输出共用顺序，取消时收尾所有调用方。 */
export function createTerminalProcessingQueue(options: {
  readonly limits: TerminalProcessingQueueLimits
  readonly onBackpressure?: (paused: boolean) => void
  readonly now?: () => number
}) {
  const { limits } = options
  const now = options.now ?? (() => performance.now())
  const entries: Array<Work | undefined> = new Array(limits.maxTasks)
  const controller = new AbortController()
  let head = 0
  let queued = 0
  let active: Work | undefined
  let pendingBytes = 0
  let pendingTasks = 0
  let peakBytes = 0
  let peakTasks = 0
  let rejectedTasks = 0
  let pauseCount = 0
  let maxWaitMs = 0
  let maxProcessingMs = 0
  let paused = false
  let failure: TerminalProcessingQueueError | undefined
  let tail: Promise<unknown> = Promise.resolve()

  function setPaused(next: boolean): void {
    if (paused === next) return
    paused = next
    if (next) pauseCount += 1
    options.onBackpressure?.(next)
  }

  function updatePressure(): void {
    if (failure) { setPaused(false); return }
    if (!paused && (pendingBytes >= limits.highBytes || pendingTasks >= limits.highTasks)) setPaused(true)
    else if (paused && pendingBytes <= limits.lowBytes && pendingTasks <= limits.lowTasks) setPaused(false)
  }

  function settle(work: Work, error: unknown, value?: unknown): void {
    if (work.settled) return
    work.settled = true
    pendingBytes -= work.bytes
    pendingTasks -= 1
    if (error) work.reject(error)
    else work.resolve(value)
  }

  function fail(error: unknown): void {
    if (failure) return
    failure = error instanceof TerminalProcessingQueueError ? error : new TerminalProcessingQueueError("emulator_unavailable")
    controller.abort()
    if (active) settle(active, failure)
    active = undefined
    for (const work of entries) if (work) settle(work, failure)
    entries.fill(undefined)
    head = 0
    queued = 0
    updatePressure()
  }

  function pump(): void {
    if (active || queued === 0 || failure) return
    const work = entries[head]!
    entries[head] = undefined
    head = (head + 1) % limits.maxTasks
    queued -= 1
    active = work
    const started = now()
    maxWaitMs = Math.max(maxWaitMs, started - work.enqueuedAt)
    void Promise.resolve().then(() => work.settled ? undefined : work.run(controller.signal)).then((value) => {
      maxProcessingMs = Math.max(maxProcessingMs, now() - started)
      settle(work, undefined, value)
      if (active === work) active = undefined
      updatePressure()
      pump()
    }, fail)
  }

  return {
    enqueue<T>(bytes: number, run: (signal: AbortSignal) => T | Promise<T>): Promise<T> {
      if (failure) return Promise.reject(failure)
      if (pendingBytes + bytes > limits.maxBytes || pendingTasks >= limits.maxTasks) {
        rejectedTasks += 1
        const error = new TerminalProcessingQueueError("emulator_queue_overflow")
        fail(error)
        return Promise.reject(error)
      }
      const promise = new Promise<unknown>((resolve, reject) => {
        entries[(head + queued) % limits.maxTasks] = { bytes, run, resolve, reject, enqueuedAt: now(), settled: false }
        queued += 1
      })
      tail = promise
      pendingBytes += bytes
      pendingTasks += 1
      peakBytes = Math.max(peakBytes, pendingBytes)
      peakTasks = Math.max(peakTasks, pendingTasks)
      updatePressure()
      pump()
      return promise as Promise<T>
    },
    async ready() {
      await tail
      if (failure) throw failure
    },
    fail,
    dispose: () => fail(new TerminalProcessingQueueError("emulator_disposed")),
    get failure() { return failure },
    diagnostics: () => ({ pendingBytes, pendingTasks, peakBytes, peakTasks, rejectedTasks, paused, pauseCount, maxWaitMs, maxProcessingMs }),
  }
}
