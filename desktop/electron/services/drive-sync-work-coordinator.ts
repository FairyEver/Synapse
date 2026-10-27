export class DriveSyncWorkCancelledError extends Error {
  constructor(readonly bindingId: string) {
    super("云盘同步任务已取消。")
    this.name = "DriveSyncWorkCancelledError"
  }
}

export function isDriveSyncWorkCancelledError(error: unknown): error is DriveSyncWorkCancelledError {
  return error instanceof DriveSyncWorkCancelledError
}

export interface DriveSyncWorkCoordinator {
  run<T>(bindingId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T>
  runMany<T>(bindingIds: readonly string[], work: (signal: AbortSignal) => Promise<T>): Promise<T>
  cancelAndRun<T>(bindingId: string, work: () => Promise<T>): Promise<T>
  cancelQueued(bindingId: string): void
  cancelAllAndWait(): Promise<void>
  isBusy(bindingId: string): boolean
  waitForIdle(): Promise<void>
}

export function createDriveSyncWorkCoordinator(): DriveSyncWorkCoordinator {
  let activeCount = 0
  const slotWaiters: Array<() => void> = []

  const tails = new Map<string, Promise<void>>()
  const generations = new Map<string, number>()
  const activeControllers = new Map<string, AbortController>()

  async function runAtGeneration<T>(
    bindingIds: readonly string[],
    bindingGenerations: ReadonlyMap<string, number>,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const previous = bindingIds.map((bindingId) => tails.get(bindingId)).filter((tail): tail is Promise<void> => Boolean(tail))
    let release: () => void = () => {}
    const tail = new Promise<void>((resolve) => {
      release = resolve
    })
    for (const bindingId of bindingIds) tails.set(bindingId, tail)
    if (previous.length) await Promise.all(previous)
    // Reserve a shared slot only after this binding reaches the front of its queue.
    if (activeCount >= 2) await new Promise<void>((resolve) => slotWaiters.push(resolve))
    else activeCount += 1
    const cancelled = bindingIds.find((bindingId) => bindingGenerations.get(bindingId) !== currentGeneration(bindingId))
    if (cancelled) {
      releaseSlot()
      releaseTails(bindingIds, tail, release)
      throw new DriveSyncWorkCancelledError(cancelled)
    }

    const controller = new AbortController()
    for (const bindingId of bindingIds) activeControllers.set(bindingId, controller)
    try {
      return await work(controller.signal)
    } finally {
      for (const bindingId of bindingIds) {
        if (activeControllers.get(bindingId) === controller) activeControllers.delete(bindingId)
      }
      releaseSlot()
      releaseTails(bindingIds, tail, release)
    }
  }

  function releaseSlot(): void {
    const next = slotWaiters.shift()
    if (next) next()
    else activeCount -= 1
  }

  function run<T>(bindingId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return runMany([bindingId], work)
  }

  function runMany<T>(ids: readonly string[], work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const bindingIds = [...new Set(ids)]
    if (bindingIds.length === 0) throw new Error("同步任务至少需要一个同步关系。")
    return runAtGeneration(bindingIds, new Map(bindingIds.map((id) => [id, currentGeneration(id)])), work)
  }

  async function cancelAndRun<T>(bindingId: string, work: () => Promise<T>): Promise<T> {
    const generation = cancel(bindingId)
    return runAtGeneration([bindingId], new Map([[bindingId, generation]]), async () => work())
  }

  function cancelQueued(bindingId: string): void {
    generations.set(bindingId, currentGeneration(bindingId) + 1)
  }

  function cancel(bindingId: string): number {
    cancelQueued(bindingId)
    const generation = currentGeneration(bindingId)
    activeControllers.get(bindingId)?.abort(new DriveSyncWorkCancelledError(bindingId))
    return generation
  }

  async function cancelAllAndWait(): Promise<void> {
    for (const bindingId of new Set([...tails.keys(), ...activeControllers.keys()])) cancel(bindingId)
    await waitForIdle()
  }

  function waitForIdle(): Promise<void> {
    return Promise.all([...tails.values()]).then(() => undefined)
  }

  function currentGeneration(bindingId: string): number {
    return generations.get(bindingId) ?? 0
  }

  function releaseTails(bindingIds: readonly string[], tail: Promise<void>, release: () => void): void {
    release()
    for (const bindingId of bindingIds) {
      if (tails.get(bindingId) === tail) tails.delete(bindingId)
    }
  }

  return {
    run,
    runMany,
    cancelAndRun,
    cancelQueued,
    cancelAllAndWait,
    isBusy: (bindingId) => tails.has(bindingId),
    waitForIdle,
  }
}
