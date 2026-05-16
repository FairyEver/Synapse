import type { UiConfig } from './config.js'
import { runBatch, type BatchResult, type BatchSnapshot, type WorkerOutputCallback } from './runner.js'

export type SchedulerStatus = 'idle' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'error'
export type BatchRunner = (config: UiConfig, onUpdate?: (snapshot: BatchSnapshot) => void, onOutput?: WorkerOutputCallback) => Promise<BatchResult>
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
  private outputListeners = new Set<WorkerOutputCallback>()
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

  subscribeOutput(listener: WorkerOutputCallback): () => void {
    this.outputListeners.add(listener)
    return () => this.outputListeners.delete(listener)
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
    let round = 0
    try {
      while (true) {
        round++
        console.log(`[scheduler] round ${round} starting (interval=${config.intervalSeconds}s)`)
        this.status = this.drainAfterCurrent ? 'stopping' : 'running'
        this.currentBatch = null
        this.emit()
        const batch = await this.batchRunner(config, snapshot => {
          this.currentBatch = snapshot
          this.emit()
        }, line => {
          for (const listener of this.outputListeners) listener(line)
        })
        console.log(`[scheduler] round ${round} finished: ${batch.status}`)
        this.currentBatch = batch
        this.lastBatch = batch
        this.emit()
        if (this.drainAfterCurrent) {
          this.status = 'stopped'
          this.currentBatch = null
          this.emit()
          console.log(`[scheduler] stopped after round ${round}`)
          return
        }
        this.status = 'waiting'
        this.currentBatch = null
        this.emit()
        console.log(`[scheduler] waiting ${config.intervalSeconds}s before round ${round + 1}`)
        this.waitAbortController = new AbortController()
        await this.wait(config.intervalSeconds * 1_000, this.waitAbortController.signal)
        this.waitAbortController = null
        console.log(`[scheduler] wait complete, drainAfterCurrent=${this.drainAfterCurrent}`)
        if (this.drainAfterCurrent) {
          this.status = 'stopped'
          this.emit()
          console.log(`[scheduler] stopped during wait`)
          return
        }
      }
    } catch (err) {
      this.status = 'error'
      this.error = err instanceof Error ? err.message : String(err)
      console.error(`[scheduler] loop error at round ${round}:`, err)
      this.emit()
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
