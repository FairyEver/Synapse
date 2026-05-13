import type { UiConfig } from './config.js'
import { runBatch, type BatchResult, type BatchSnapshot } from './runner.js'

export type SchedulerStatus = 'idle' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'error'
export type BatchRunner = (config: UiConfig, onUpdate?: (snapshot: BatchSnapshot) => void) => Promise<BatchResult>
export type SchedulerWait = (ms: number, signal: AbortSignal) => Promise<void>

export interface SchedulerSnapshot {
  status: SchedulerStatus
  drainAfterCurrent: boolean
  activeConfig: UiConfig | null
  currentBatch: BatchSnapshot | null
  lastBatch: BatchResult | null
  error: string
}

export type SchedulerListener = (snapshot: SchedulerSnapshot) => void

export interface SchedulerOptions {
  wait?: SchedulerWait
}

export class AutoScheduler {
  private status: SchedulerStatus = 'idle'
  private drainAfterCurrent = false
  private activeConfig: UiConfig | null = null
  private currentBatch: BatchSnapshot | null = null
  private lastBatch: BatchResult | null = null
  private error = ''
  private listeners = new Set<SchedulerListener>()
  private wait: SchedulerWait
  private waitAbortController: AbortController | null = null
  private runningPromise: Promise<void> | null = null

  constructor(
    private readonly batchRunner: BatchRunner = runBatch,
    options: SchedulerOptions = {}
  ) {
    this.wait = options.wait ?? ((ms, signal) => new Promise(resolve => {
      const timeout = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => {
        clearTimeout(timeout)
        resolve()
      }, { once: true })
    }))
  }

  getSnapshot(): SchedulerSnapshot {
    return {
      status: this.status,
      drainAfterCurrent: this.drainAfterCurrent,
      activeConfig: this.activeConfig,
      currentBatch: this.currentBatch,
      lastBatch: this.lastBatch,
      error: this.error,
    }
  }

  subscribe(listener: SchedulerListener): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => this.listeners.delete(listener)
  }

  async start(config: UiConfig): Promise<void> {
    if (this.runningPromise) return this.runningPromise
    this.activeConfig = config
    this.drainAfterCurrent = false
    this.error = ''
    this.runningPromise = this.loop(config).finally(() => {
      this.runningPromise = null
    })
    return this.runningPromise
  }

  stopAfterCurrent(): void {
    this.drainAfterCurrent = true
    if (this.status === 'running') this.status = 'stopping'
    if (this.status === 'waiting') {
      this.status = 'stopped'
      this.waitAbortController?.abort()
    }
    this.emit()
  }

  async waitForStatus(status: SchedulerStatus): Promise<void> {
    if (this.status === status) return
    await new Promise<void>(resolve => {
      const unsubscribe = this.subscribe(snapshot => {
        if (snapshot.status === status) {
          unsubscribe()
          resolve()
        }
      })
    })
  }

  private async loop(config: UiConfig): Promise<void> {
    try {
      while (true) {
        this.status = this.drainAfterCurrent ? 'stopping' : 'running'
        this.currentBatch = null
        this.emit()
        const batch = await this.batchRunner(config, snapshot => {
          this.currentBatch = snapshot
          this.emit()
        })
        this.currentBatch = batch
        this.lastBatch = batch
        this.emit()
        if (this.drainAfterCurrent) {
          this.status = 'stopped'
          this.currentBatch = null
          this.emit()
          return
        }
        this.status = 'waiting'
        this.currentBatch = null
        this.emit()
        this.waitAbortController = new AbortController()
        await this.wait(config.intervalMinutes * 60_000, this.waitAbortController.signal)
        this.waitAbortController = null
        if (this.drainAfterCurrent) {
          this.status = 'stopped'
          this.emit()
          return
        }
      }
    } catch (err) {
      this.status = 'error'
      this.error = err instanceof Error ? err.message : String(err)
      this.emit()
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
