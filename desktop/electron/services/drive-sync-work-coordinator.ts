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
  cancelAndRun<T>(bindingId: string, work: () => Promise<T>): Promise<T>
  cancelAllAndWait(): Promise<void>
  isBusy(bindingId: string): boolean
  waitForIdle(): Promise<void>
}

export function createDriveSyncWorkCoordinator(): DriveSyncWorkCoordinator {
  const tails = new Map<string, Promise<void>>()
  const generations = new Map<string, number>()
  const activeControllers = new Map<string, AbortController>()

  async function runAtGeneration<T>(
    bindingId: string,
    generation: number,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const previous = tails.get(bindingId)
    let release: () => void = () => {}
    const tail = new Promise<void>((resolve) => {
      release = resolve
    })
    tails.set(bindingId, tail)
    if (previous) await previous.catch(() => undefined)
    if (generation !== currentGeneration(bindingId)) {
      releaseTail(bindingId, tail, release)
      throw new DriveSyncWorkCancelledError(bindingId)
    }

    const controller = new AbortController()
    activeControllers.set(bindingId, controller)
    try {
      return await work(controller.signal)
    } finally {
      if (activeControllers.get(bindingId) === controller) activeControllers.delete(bindingId)
      releaseTail(bindingId, tail, release)
    }
  }

  function run<T>(bindingId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return runAtGeneration(bindingId, currentGeneration(bindingId), work)
  }

  async function cancelAndRun<T>(bindingId: string, work: () => Promise<T>): Promise<T> {
    const generation = cancel(bindingId)
    return runAtGeneration(bindingId, generation, async () => work())
  }

  function cancel(bindingId: string): number {
    const generation = currentGeneration(bindingId) + 1
    generations.set(bindingId, generation)
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

  function releaseTail(bindingId: string, tail: Promise<void>, release: () => void): void {
    release()
    if (tails.get(bindingId) === tail) tails.delete(bindingId)
  }

  return {
    run,
    cancelAndRun,
    cancelAllAndWait,
    isBusy: (bindingId) => tails.has(bindingId),
    waitForIdle,
  }
}
