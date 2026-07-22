import { randomUUID } from "node:crypto"
import type { StructuredLogger } from "../../../electron/runtime/service-registry"
import {
  TextExtractionError,
  isTextExtractionError,
} from "../shared/errors"

export type TextExtractionTaskStatus =
  | "waiting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type SerializedTextExtractionError = {
  readonly code: TextExtractionError["code"]
  readonly message: string
}

export type TextExtractionTaskState = {
  readonly id: string
  readonly status: TextExtractionTaskStatus
  readonly error?: SerializedTextExtractionError
}

export type TextExtractionTask<Result> = {
  readonly result: Promise<Result>
  getState(): TextExtractionTaskState
  subscribe(listener: (state: TextExtractionTaskState) => void): () => void
  cancel(): boolean
}

type SchedulerLogger = Pick<StructuredLogger, "info" | "warn">

type QueuedTask<Result> = {
  readonly task: ScheduledTask<Result>
  readonly execute: (
    signal: AbortSignal,
    markRunning: () => void,
  ) => Promise<Result>
  active: boolean
}

class ScheduledTask<Result> implements TextExtractionTask<Result> {
  readonly result: Promise<Result>
  readonly controller = new AbortController()
  private readonly listeners = new Set<(state: TextExtractionTaskState) => void>()
  private readonly resolveResult: (result: Result) => void
  private readonly rejectResult: (error: unknown) => void
  private state: TextExtractionTaskState
  private cancelTask: (() => boolean) | undefined

  constructor(id: string) {
    this.state = { id, status: "waiting" }
    let resolveResult!: (result: Result) => void
    let rejectResult!: (error: unknown) => void
    this.result = new Promise<Result>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    this.resolveResult = resolveResult
    this.rejectResult = rejectResult
  }

  getState(): TextExtractionTaskState {
    return this.state
  }

  subscribe(listener: (state: TextExtractionTaskState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  cancel(): boolean {
    return this.cancelTask?.() ?? false
  }

  setCancelTask(cancelTask: () => boolean): void {
    this.cancelTask = cancelTask
  }

  transition(state: TextExtractionTaskState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }

  resolve(result: Result): void {
    this.resolveResult(result)
  }

  reject(error: unknown): void {
    this.rejectResult(error)
  }
}

export class TextExtractionScheduler {
  private readonly queue: Array<QueuedTask<unknown>> = []
  private readonly tasks = new Set<ScheduledTask<unknown>>()
  private runningCount = 0
  private drainScheduled = false

  constructor(
    private readonly concurrency: number,
    private readonly logger?: SchedulerLogger,
  ) {}

  schedule<Result>(execute: (
    signal: AbortSignal,
    markRunning: () => void,
  ) => Promise<Result>): TextExtractionTask<Result> {
    const task = new ScheduledTask<Result>(randomUUID())
    const queued: QueuedTask<Result> = { task, execute, active: false }
    this.queue.push(queued as QueuedTask<unknown>)
    this.tasks.add(task as ScheduledTask<unknown>)
    task.setCancelTask(() => this.cancel(queued as QueuedTask<unknown>))
    this.logState(task.getState())
    this.scheduleDrain()
    return task
  }

  async cancelAll(): Promise<void> {
    const tasks = [...this.tasks]
    const settled = Promise.allSettled(tasks.map((task) => task.result))
    for (const task of tasks) task.cancel()
    await settled
  }

  private cancel(queued: QueuedTask<unknown>): boolean {
    const state = queued.task.getState()
    if (state.status === "waiting" && !queued.active) {
      const index = this.queue.indexOf(queued)
      if (index < 0) return false
      this.queue.splice(index, 1)
      this.tasks.delete(queued.task)
      const error = this.transitionToCancelled(queued.task)
      queued.task.reject(error)
      return true
    }
    if (state.status !== "waiting" && state.status !== "running") return false
    this.transitionToCancelled(queued.task)
    queued.task.controller.abort()
    return true
  }

  private transitionToCancelled(task: ScheduledTask<unknown>): TextExtractionError {
    const error = new TextExtractionError("EXTRACTION_CANCELLED")
    task.transition({
      id: task.getState().id,
      status: "cancelled",
      error: serializeError(error),
    })
    this.logState(task.getState())
    return error
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return
    this.drainScheduled = true
    queueMicrotask(() => {
      this.drainScheduled = false
      this.drain()
    })
  }

  private drain(): void {
    while (this.runningCount < this.concurrency && this.queue.length > 0) {
      const queued = this.queue.shift()!
      queued.active = true
      this.runningCount += 1
      const current = queued.task.getState()
      const markRunning = () => {
        if (queued.task.getState().status !== "waiting") return
        queued.task.transition({ id: current.id, status: "running" })
        this.logState(queued.task.getState())
      }
      void queued.execute(queued.task.controller.signal, markRunning).then(
        (result) => {
          if (queued.task.getState().status === "cancelled") {
            queued.task.reject(new TextExtractionError("EXTRACTION_CANCELLED"))
            return
          }
          queued.task.transition({ id: current.id, status: "completed" })
          queued.task.resolve(result)
          this.logState(queued.task.getState())
        },
        (error: unknown) => {
          if (queued.task.getState().status === "cancelled") {
            queued.task.reject(new TextExtractionError("EXTRACTION_CANCELLED"))
            return
          }
          const serialized = serializeError(error)
          queued.task.transition({ id: current.id, status: "failed", error: serialized })
          queued.task.reject(error)
          this.logState(queued.task.getState())
        },
      ).finally(() => {
        this.runningCount -= 1
        this.tasks.delete(queued.task)
        this.scheduleDrain()
      })
    }
  }

  private logState(state: TextExtractionTaskState): void {
    const metadata = {
      taskId: state.id,
      status: state.status,
      queueSize: this.queue.length,
      runningCount: this.runningCount,
      ...(state.error ? { errorCode: state.error.code } : {}),
    }
    if (state.status === "failed") {
      this.logger?.warn("Text extraction task state changed.", metadata)
      return
    }
    this.logger?.info("Text extraction task state changed.", metadata)
  }
}

function serializeError(error: unknown): SerializedTextExtractionError {
  const normalized = isTextExtractionError(error)
    ? error
    : new TextExtractionError("EXTRACTION_FAILED", { cause: error })
  return { code: normalized.code, message: normalized.message }
}
