import { randomUUID } from "node:crypto"
import type { StructuredLogger } from "../../../electron/runtime/service-registry"
import {
  DocumentTextExtractionError,
  isDocumentTextExtractionError,
} from "../shared/errors"

export type DocumentTextExtractionTaskStatus =
  | "waiting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type SerializedDocumentTextExtractionError = {
  readonly code: DocumentTextExtractionError["code"]
  readonly message: string
}

export type DocumentTextExtractionTaskState = {
  readonly id: string
  readonly status: DocumentTextExtractionTaskStatus
  readonly error?: SerializedDocumentTextExtractionError
}

export type DocumentTextExtractionTask<Result> = {
  readonly result: Promise<Result>
  getState(): DocumentTextExtractionTaskState
  subscribe(listener: (state: DocumentTextExtractionTaskState) => void): () => void
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

class ScheduledTask<Result> implements DocumentTextExtractionTask<Result> {
  readonly result: Promise<Result>
  readonly controller = new AbortController()
  private readonly listeners = new Set<(state: DocumentTextExtractionTaskState) => void>()
  private readonly resolveResult: (result: Result) => void
  private readonly rejectResult: (error: unknown) => void
  private state: DocumentTextExtractionTaskState
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

  getState(): DocumentTextExtractionTaskState {
    return this.state
  }

  subscribe(listener: (state: DocumentTextExtractionTaskState) => void): () => void {
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

  transition(state: DocumentTextExtractionTaskState): void {
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

export class DocumentTextExtractionScheduler {
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
  ) => Promise<Result>): DocumentTextExtractionTask<Result> {
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

  private transitionToCancelled(task: ScheduledTask<unknown>): DocumentTextExtractionError {
    const error = new DocumentTextExtractionError("EXTRACTION_CANCELLED")
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
            queued.task.reject(new DocumentTextExtractionError("EXTRACTION_CANCELLED"))
            return
          }
          queued.task.transition({ id: current.id, status: "completed" })
          queued.task.resolve(result)
          this.logState(queued.task.getState())
        },
        (error: unknown) => {
          if (queued.task.getState().status === "cancelled") {
            queued.task.reject(new DocumentTextExtractionError("EXTRACTION_CANCELLED"))
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

  private logState(state: DocumentTextExtractionTaskState): void {
    const metadata = {
      taskId: state.id,
      status: state.status,
      queueSize: this.queue.length,
      runningCount: this.runningCount,
      ...(state.error ? { errorCode: state.error.code } : {}),
    }
    if (state.status === "failed") {
      this.logger?.warn("Document text extraction task state changed.", metadata)
      return
    }
    this.logger?.info("Document text extraction task state changed.", metadata)
  }
}

function serializeError(error: unknown): SerializedDocumentTextExtractionError {
  const normalized = isDocumentTextExtractionError(error)
    ? error
    : new DocumentTextExtractionError("EXTRACTION_FAILED", { cause: error })
  return { code: normalized.code, message: normalized.message }
}
