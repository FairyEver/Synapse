import { ScriptRuntimeError } from "../shared/json"

type ScheduledTask<T> = {
  readonly signal: AbortSignal
  readonly execute: () => Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
  removeAbortListener?: () => void
}

export class ScriptRunScheduler {
  private running = 0
  private readonly queue: ScheduledTask<unknown>[] = []

  constructor(
    private readonly maxRunning = 2,
    private readonly maxQueued = 8,
  ) {}

  run<T>(signal: AbortSignal, execute: () => Promise<T>): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(new ScriptRuntimeError("CANCELLED", "Script execution was cancelled."))
    }
    if (this.running < this.maxRunning) return this.start(execute)
    if (this.queue.length >= this.maxQueued) {
      return Promise.reject(new ScriptRuntimeError("RUNNER_BUSY", "The script runner queue is full."))
    }
    return new Promise<T>((resolve, reject) => {
      const task: ScheduledTask<T> = { signal, execute, resolve, reject }
      const onAbort = () => {
        const index = this.queue.indexOf(task as ScheduledTask<unknown>)
        if (index >= 0) this.queue.splice(index, 1)
        reject(new ScriptRuntimeError("CANCELLED", "Script execution was cancelled."))
      }
      signal.addEventListener("abort", onAbort, { once: true })
      task.removeAbortListener = () => signal.removeEventListener("abort", onAbort)
      this.queue.push(task as ScheduledTask<unknown>)
    })
  }

  private async start<T>(execute: () => Promise<T>): Promise<T> {
    this.running += 1
    try {
      return await execute()
    } finally {
      this.running -= 1
      this.drain()
    }
  }

  private drain(): void {
    while (this.running < this.maxRunning && this.queue.length > 0) {
      const task = this.queue.shift()!
      task.removeAbortListener?.()
      if (task.signal.aborted) {
        task.reject(new ScriptRuntimeError("CANCELLED", "Script execution was cancelled."))
        continue
      }
      void this.start(task.execute).then(task.resolve, task.reject)
    }
  }
}
