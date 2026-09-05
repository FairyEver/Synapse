import {
  AGENT_RAW_DIAGNOSTIC_RETENTION_MS,
  DATA_MAINTENANCE_DELETE_BATCH_SIZE,
  DATA_MAINTENANCE_INTERVAL_MS,
  DATA_MAINTENANCE_MAX_DELETIONS_PER_RUN,
  DATA_MAINTENANCE_RUN_TIMEOUT_MS,
  REPLY_OUTBOX_SENT_RETENTION_LIMIT,
} from "../../config"
import type {
  DataMaintenanceCounts,
  DataMaintenanceExecution,
  DataMaintenanceExecutor,
  DataMaintenanceProgress,
  DataMaintenanceResult,
} from "../runtime/data-repo"
import type { StructuredLogger } from "../runtime/logging"
import type { AuditSink, PermissionGuard } from "../runtime/security"

export interface DataMaintenanceSnapshot {
  readonly status: "idle" | "scheduled" | "running" | "partial" | "completed" | "failed"
  readonly phase?: DataMaintenanceProgress["phase"]
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly nextRunAt?: string
  readonly deleted: DataMaintenanceCounts
  readonly databaseBytesBefore?: number
  readonly databaseBytesAfter?: number
  readonly freePagesBefore?: number
  readonly freePagesAfter?: number
  readonly errorName?: string
  readonly errorLength?: number
}

interface DataMaintenanceServiceOptions {
  readonly executor: DataMaintenanceExecutor
  readonly logger: Pick<StructuredLogger, "info" | "warn">
  readonly auditSink?: Pick<AuditSink, "record">
  readonly permissionGuard: Pick<PermissionGuard, "check">
  readonly now?: () => Date
  readonly initialDelayMs?: number
  readonly intervalMs?: number
  readonly partialDelayMs?: number
  readonly failureDelayMs?: number
  readonly timeoutMs?: number
}

const INITIAL_DELAY_MS = 2_000
const PARTIAL_DELAY_MS = 1_000
const FAILURE_DELAY_MS = 5 * 60 * 1_000

export class DataMaintenanceService {
  private readonly options: Required<Pick<
    DataMaintenanceServiceOptions,
    "now" | "initialDelayMs" | "intervalMs" | "partialDelayMs" | "failureDelayMs" | "timeoutMs"
  >> & Omit<DataMaintenanceServiceOptions, "now" | "initialDelayMs" | "intervalMs" | "partialDelayMs" | "failureDelayMs" | "timeoutMs">
  private timer: ReturnType<typeof setTimeout> | null = null
  private currentExecution: DataMaintenanceExecution | null = null
  private runningPromise: Promise<void> | null = null
  private stopped = false
  private snapshot: DataMaintenanceSnapshot = {
    status: "idle",
    deleted: emptyCounts(),
  }

  constructor(options: DataMaintenanceServiceOptions) {
    this.options = {
      ...options,
      now: options.now ?? (() => new Date()),
      initialDelayMs: options.initialDelayMs ?? INITIAL_DELAY_MS,
      intervalMs: options.intervalMs ?? DATA_MAINTENANCE_INTERVAL_MS,
      partialDelayMs: options.partialDelayMs ?? PARTIAL_DELAY_MS,
      failureDelayMs: options.failureDelayMs ?? FAILURE_DELAY_MS,
      timeoutMs: options.timeoutMs ?? DATA_MAINTENANCE_RUN_TIMEOUT_MS,
    }
  }

  start(): void {
    this.stopped = false
    this.schedule(this.options.initialDelayMs)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.currentExecution) {
      await this.currentExecution.terminate()
    }
    await this.runningPromise?.catch(() => undefined)
  }

  inspect(): DataMaintenanceSnapshot {
    return {
      ...this.snapshot,
      deleted: { ...this.snapshot.deleted },
    }
  }

  runNow(): Promise<void> {
    if (this.runningPromise) return this.runningPromise
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.runningPromise = this.runOnce().finally(() => {
      this.runningPromise = null
    })
    return this.runningPromise
  }

  private async runOnce(): Promise<void> {
    if (this.stopped) return
    const startedAt = this.options.now().toISOString()
    let denialPolicyId: string | undefined
    this.snapshot = { status: "running", startedAt, deleted: emptyCounts() }
    this.options.logger.info("Runtime data maintenance started.", { startedAt })
    try {
      const permission = await this.options.permissionGuard.check({
        action: "database.mutate",
        actor: { kind: "system", id: "data-maintenance" },
        resource: "runtime-data",
        context: { source: "core.data-maintenance" },
      })
      if (!permission.allowed) {
        denialPolicyId = permission.policyId
        throw new Error("Runtime data maintenance permission denied")
      }
      const execution = this.options.executor.run({
        maxDeletions: DATA_MAINTENANCE_MAX_DELETIONS_PER_RUN,
        batchSize: DATA_MAINTENANCE_DELETE_BATCH_SIZE,
        rawAgentDiagnosticCutoff: new Date(
          this.options.now().getTime() - AGENT_RAW_DIAGNOSTIC_RETENTION_MS,
        ).toISOString(),
        outboxSentRetentionLimit: REPLY_OUTBOX_SENT_RETENTION_LIMIT,
      }, (progress) => this.updateProgress(progress))
      this.currentExecution = execution
      const result = await withTimeout(execution, this.options.timeoutMs)
      this.currentExecution = null
      this.snapshot = snapshotFromResult(result)
      this.options.logger.info("Runtime data maintenance completed.", {
        status: result.status,
        durationMs: result.durationMs,
        deleted: result.deleted,
        freePagesBefore: result.freePagesBefore,
        freePagesAfter: result.freePagesAfter,
      })
      this.options.auditSink?.record({
        action: "database.mutate",
        actor: { kind: "system", id: "data-maintenance" },
        resource: "runtime-data",
        outcome: "allowed",
        metadata: {
          status: result.status,
          deleted: result.deleted,
          durationMs: result.durationMs,
        },
      })
      if (!this.stopped) {
        this.schedule(result.status === "partial" ? this.options.partialDelayMs : this.options.intervalMs)
      }
    } catch (error) {
      this.currentExecution = null
      if (this.stopped) return
      const diagnostic = errorDiagnostic(error)
      this.snapshot = {
        status: "failed",
        startedAt,
        finishedAt: this.options.now().toISOString(),
        deleted: { ...this.snapshot.deleted },
        ...diagnostic,
      }
      this.options.logger.warn("Runtime data maintenance failed.", diagnostic)
      this.options.auditSink?.record({
        action: "database.mutate",
        actor: { kind: "system", id: "data-maintenance" },
        resource: "runtime-data",
        outcome: denialPolicyId ? "denied" : "failed",
        metadata: { ...diagnostic, ...(denialPolicyId ? { policyId: denialPolicyId } : undefined) },
      })
      if (!this.stopped) this.schedule(this.options.failureDelayMs)
    }
  }

  private updateProgress(progress: DataMaintenanceProgress): void {
    if (this.snapshot.status !== "running") return
    this.snapshot = {
      ...this.snapshot,
      phase: progress.phase,
      deleted: { ...progress.deleted },
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return
    const nextRunAt = new Date(this.options.now().getTime() + delayMs).toISOString()
    this.snapshot = {
      ...this.snapshot,
      status: this.snapshot.status === "idle" ? "scheduled" : this.snapshot.status,
      nextRunAt,
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.runNow()
    }, delayMs)
    this.timer.unref?.()
  }
}

function snapshotFromResult(result: DataMaintenanceResult): DataMaintenanceSnapshot {
  return {
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    deleted: { ...result.deleted },
    databaseBytesBefore: result.databaseBytesBefore,
    databaseBytesAfter: result.databaseBytesAfter,
    freePagesBefore: result.freePagesBefore,
    freePagesAfter: result.freePagesAfter,
  }
}

function emptyCounts(): DataMaintenanceCounts {
  return {
    localOutbox: 0,
    retainedOutbox: 0,
    rawAgentDiagnostics: 0,
    orphanAgentEvents: 0,
  }
}

function withTimeout(execution: DataMaintenanceExecution, timeoutMs: number): Promise<DataMaintenanceResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void execution.terminate()
      reject(new Error(`Runtime data maintenance timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref?.()
    execution.result.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}
