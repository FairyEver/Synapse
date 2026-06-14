import type { UiConfig } from './config.js'
import { BatchLogger, type WorkerLogger } from './logger.js'
import { runWorker, type WorkerResult, type WorkerUpdate, type WorkerOutputCallback } from './runner.js'
import { redactSensitiveText } from './redact.js'

export type SchedulerStatus = 'idle' | 'running' | 'draining' | 'stopped' | 'error'

export interface WorkerRun {
  slotId: number
  sequence: number
  logger: WorkerLogger
}

export type WorkerRunner = (
  config: UiConfig,
  run: WorkerRun,
  onUpdate?: WorkerUpdate,
  onOutput?: WorkerOutputCallback
) => Promise<WorkerResult>

export interface RunTotals {
  started: number
  success: number
  error: number
  timeout: number
}

export interface SlotSnapshot {
  slotId: number
  sequence: number
  worker: WorkerResult | null
}

export interface RunSessionSnapshot {
  id: string
  startedAt: string
  durationMs: number
  slots: SlotSnapshot[]
  recentRuns: WorkerResult[]
  totals: RunTotals
  summaryPath: string
}

export interface SchedulerSnapshot {
  status: SchedulerStatus
  drainAfterCurrent: boolean
  activeConfig: UiConfig | null
  session: RunSessionSnapshot | null
  error: string
}

export type SchedulerListener = (snapshot: SchedulerSnapshot) => void

const RECENT_RUN_LIMIT = 50

const defaultWorkerRunner: WorkerRunner = (config, run, onUpdate, onOutput) =>
  runWorker(config, run.slotId, run.logger, onUpdate, onOutput)

function runningWorker(slotId: number, sequence: number, logPath: string): WorkerResult {
  return {
    id: slotId,
    status: 'running',
    durationMs: 0,
    exitCode: null,
    logPath,
    lastMessage: `run ${sequence}`,
  }
}

function failedWorker(slotId: number, sequence: number, logPath: string, err: unknown): WorkerResult {
  return {
    id: slotId,
    status: 'error',
    durationMs: 0,
    exitCode: 1,
    logPath,
    lastMessage: redactSensitiveText(err instanceof Error ? err.message : String(err)),
  }
}

export class AutoScheduler {
  private status: SchedulerStatus = 'idle'
  private drainAfterCurrent = false
  private activeConfig: UiConfig | null = null
  private session: RunSessionSnapshot | null = null
  private error = ''
  private listeners = new Set<SchedulerListener>()
  private outputListeners = new Set<WorkerOutputCallback>()
  private runningPromise: Promise<void> | null = null
  private nextSequence = 1
  private activeSlots = 0

  constructor(private readonly workerRunner: WorkerRunner = defaultWorkerRunner) {}

  getSnapshot(): SchedulerSnapshot {
    if (this.session) {
      this.session.durationMs = Date.now() - new Date(this.session.startedAt).getTime()
    }
    return {
      status: this.status,
      drainAfterCurrent: this.drainAfterCurrent,
      activeConfig: this.activeConfig,
      session: this.session,
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
    this.runningPromise = this.runPool(config).finally(() => {
      this.runningPromise = null
    })
    return this.runningPromise
  }

  stopAfterCurrent(): void {
    this.drainAfterCurrent = true
    if (this.status === 'running') this.status = 'draining'
    if (this.status === 'idle') this.status = 'stopped'
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

  async waitForRunCount(count: number): Promise<void> {
    if ((this.session?.totals.started ?? 0) >= count) return
    await new Promise<void>(resolve => {
      const unsubscribe = this.subscribe(snapshot => {
        if ((snapshot.session?.totals.started ?? 0) >= count) {
          unsubscribe()
          resolve()
        }
      })
    })
  }

  private async runPool(config: UiConfig): Promise<void> {
    try {
      const started = new Date()
      const batchLogger = new BatchLogger(started)
      this.nextSequence = 1
      this.activeSlots = config.concurrency
      this.status = 'running'
      this.session = {
        id: started.toISOString(),
        startedAt: started.toISOString(),
        durationMs: 0,
        slots: Array.from({ length: config.concurrency }, (_, index) => ({
          slotId: index + 1,
          sequence: 0,
          worker: null,
        })),
        recentRuns: [],
        totals: { started: 0, success: 0, error: 0, timeout: 0 },
        summaryPath: '',
      }
      this.emit()
      await Promise.all(this.session.slots.map(slot => this.runSlot(config, batchLogger, slot.slotId)))
    } catch (err) {
      this.status = 'error'
      this.error = redactSensitiveText(err instanceof Error ? err.message : String(err))
      this.emit()
    }
  }

  private async runSlot(config: UiConfig, batchLogger: BatchLogger, slotId: number): Promise<void> {
    while (!this.drainAfterCurrent) {
      const sequence = this.nextSequence++
      const logger = batchLogger.createWorkerLogger(slotId, sequence)
      this.markSlotRunning(slotId, sequence, logger.path)
      let result: WorkerResult
      try {
        result = await this.workerRunner(config, { slotId, sequence, logger }, update => {
          this.updateSlot(slotId, sequence, update)
        }, line => {
          for (const listener of this.outputListeners) listener({ ...line, workerId: slotId, sequence })
        })
      } catch (err) {
        result = failedWorker(slotId, sequence, logger.path, err)
      }
      this.finishRun(slotId, sequence, result)
    }
    this.markSlotIdle(slotId)
  }

  private markSlotRunning(slotId: number, sequence: number, logPath: string): void {
    const slot = this.session?.slots.find(item => item.slotId === slotId)
    if (!slot || !this.session) return
    slot.sequence = sequence
    slot.worker = runningWorker(slotId, sequence, logPath)
    this.session.totals.started++
    this.emit()
  }

  private updateSlot(slotId: number, sequence: number, update: WorkerResult): void {
    const slot = this.session?.slots.find(item => item.slotId === slotId)
    if (!slot || slot.sequence !== sequence) return
    slot.worker = update
    this.emit()
  }

  private finishRun(slotId: number, sequence: number, result: WorkerResult): void {
    const slot = this.session?.slots.find(item => item.slotId === slotId)
    if (!slot || slot.sequence !== sequence || !this.session) return
    slot.worker = result
    if (result.status === 'success') {
      this.session.totals.success++
    } else if (result.status === 'timeout') {
      this.session.totals.timeout++
    } else {
      this.session.totals.error++
    }
    this.session.recentRuns = [result, ...this.session.recentRuns].slice(0, RECENT_RUN_LIMIT)
    this.emit()
  }

  private markSlotIdle(slotId: number): void {
    const slot = this.session?.slots.find(item => item.slotId === slotId)
    if (slot) slot.worker = null
    this.activeSlots--
    if (this.activeSlots === 0) {
      this.status = 'stopped'
    }
    this.emit()
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
