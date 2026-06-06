import { computeNextRunAt, resolveStartupSchedule } from "./schedule-calculator"
import type { MainActionRegistry } from "../../action-runtime/action-registry"
import type { EventBus } from "../../runtime/event-bus"
import type { TaskSchedulerExecutionService } from "./execution-service"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { ScheduledTaskRunRepository } from "./run-repository"
import type { ScheduledTaskRepository } from "./task-repository"
import type {
  ScheduledTaskEntry,
  ScheduledTaskCreateInput,
  ScheduledTaskRunEntry,
  ScheduledTaskRunTrigger,
  ScheduledTaskUpdateInput,
  ScheduledTaskValidation,
} from "./types"

const TIMER_MAX_DELAY_MS = 2_147_483_647
const STOP_SETTLE_WAIT_MS = 3_000
const NEEDS_UPDATE_MESSAGE = "任务配置需要更新"
const INTERRUPTED_RUN_ERROR = "应用异常退出，运行已在启动恢复时标记为失败。"

export interface TaskSchedulerServiceDeps {
  readonly tasks: ScheduledTaskRepository
  readonly runs: ScheduledTaskRunRepository
  readonly actions: MainActionRegistry
  readonly execution: TaskSchedulerExecutionService
  readonly defaultCwd: string
  readonly eventBus?: Pick<EventBus, "emit">
  readonly logger?: StructuredLogger
  readonly now?: () => Date
}

type TaskSchedulerChangeReason =
  | "created"
  | "updated"
  | "deleted"
  | "enabled"
  | "disabled"
  | "scheduled"
  | "run-started"
  | "run-finished"
  | "run-skipped"
  | "run-stopped"

type TaskSchedulerChangedPayload = {
  readonly taskId?: string
  readonly runId?: string
  readonly reason: TaskSchedulerChangeReason
}

export class TaskSchedulerService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly runningTaskIds = new Set<string>()
  private started = false

  constructor(private readonly deps: TaskSchedulerServiceDeps) {}

  async start(): Promise<void> {
    if (this.started) return
    await this.recoverInterruptedRuns()
    const tasks = await this.deps.tasks.list()
    for (const task of tasks) {
      try {
        await this.scheduleOnStartup(task)
      } catch (error) {
        this.deps.logger?.warn?.("Scheduled task startup failed, skipping.", {
          taskId: task.id,
          name: task.name,
          boundary: "task-scheduler-startup",
          ...errorMetadata(error instanceof Error ? error : new Error(String(error))),
        })
      }
    }
    this.started = true
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const runs = await this.deps.runs.listRunning()
    let recoveredCount = 0
    for (const run of runs) {
      try {
        const finished = await this.deps.runs.finish(run.id, {
          status: "failed",
          error: INTERRUPTED_RUN_ERROR,
          result: {
            status: "failed",
            summary: "应用异常退出",
            error: INTERRUPTED_RUN_ERROR,
          },
        })
        recoveredCount += 1
        this.emitTaskChanged({ taskId: finished.taskId, runId: finished.id, reason: "run-finished" })
        try {
          await this.deps.tasks.markRunResult(finished.taskId, { status: "failed" })
        } catch (markError) {
          this.deps.logger?.warn("markRunResult failed after startup run recovery.", {
            source: "task-scheduler",
            taskId: finished.taskId,
            runId: finished.id,
            status: "failed",
            boundary: "task-scheduler-startup-run-recovery",
            ...errorMetadata(markError),
          })
        }
      } catch (error) {
        this.deps.logger?.warn("Scheduled task run startup recovery failed.", {
          taskId: run.taskId,
          runId: run.id,
          boundary: "task-scheduler-startup-run-recovery",
          ...errorMetadata(error),
        })
      }
    }
    if (recoveredCount > 0) {
      this.deps.logger?.info("Recovered interrupted scheduled task runs.", {
        boundary: "task-scheduler-startup-run-recovery",
        recoveredCount,
      })
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    await this.stopActiveRuns()
    this.started = false
  }

  async schedulerTaskList(): Promise<ScheduledTaskEntry[]> {
    const tasks = await this.deps.tasks.list()
    const result = await Promise.all(tasks.map((task) => this.withRuntimeState(task)))
    this.deps.logger?.info("Scheduled tasks listed.", {
      boundary: "task-scheduler.task-list",
      taskCount: result.length,
    })
    return result
  }

  async schedulerTaskGet(id: string): Promise<ScheduledTaskEntry | null> {
    const task = await this.deps.tasks.get(id)
    const result = task ? await this.withRuntimeState(task) : null
    this.deps.logger?.info("Scheduled task loaded.", {
      boundary: "task-scheduler.task-get",
      taskId: id,
      found: Boolean(result),
    })
    return result
  }

  async schedulerTaskCreate(input: ScheduledTaskCreateInput): Promise<ScheduledTaskEntry> {
    const startedAt = Date.now()
    try {
      const task = await this.deps.tasks.create(this.normalizeCreateInput(input))
      if (this.started && task.enabled && this.isTaskValid(task)) await this.schedule(task.id, task.nextRunAt)
      this.emitTaskChanged({ taskId: task.id, reason: "created" })
      this.deps.logger?.info("Scheduled task created.", {
        boundary: "task-scheduler.task-create",
        taskId: task.id,
        actionType: task.action.type,
        triggerType: task.trigger.type,
        enabled: task.enabled,
        durationMs: Date.now() - startedAt,
      })
      return this.withRuntimeState(task)
    } catch (error) {
      this.deps.logger?.warn("Scheduled task create failed.", {
        boundary: "task-scheduler.task-create",
        actionType: input.action.type,
        triggerType: input.trigger.type,
        enabled: input.enabled,
        durationMs: Date.now() - startedAt,
        ...errorMetadata(error),
      })
      throw error
    }
  }

  async schedulerTaskUpdate(id: string, patch: ScheduledTaskUpdateInput): Promise<ScheduledTaskEntry> {
    const startedAt = Date.now()
    const normalizedPatch = this.normalizeUpdateInput(patch)
    const oldTask = await this.deps.tasks.get(id)
    this.cancel(id)
    try {
      const task = await this.deps.tasks.update(id, normalizedPatch)
      if (this.started && task.enabled && this.isTaskValid(task)) await this.schedule(task.id, task.nextRunAt)
      this.emitTaskChanged({ taskId: task.id, reason: "updated" })
      this.deps.logger?.info("Scheduled task updated.", {
        boundary: "task-scheduler.task-update",
        taskId: task.id,
        patchKeys: Object.keys(patch),
        enabled: task.enabled,
        durationMs: Date.now() - startedAt,
      })
      return this.withRuntimeState(task)
    } catch (err) {
      if (this.started && oldTask?.enabled && oldTask.nextRunAt && this.isTaskValid(oldTask)) {
        await this.schedule(oldTask.id, oldTask.nextRunAt)
      }
      this.deps.logger?.warn("Scheduled task update failed.", {
        boundary: "task-scheduler.task-update",
        taskId: id,
        patchKeys: Object.keys(patch),
        durationMs: Date.now() - startedAt,
        ...errorMetadata(err),
      })
      throw err
    }
  }

  async deleteTask(id: string): Promise<{ readonly deleted: boolean }> {
    const startedAt = Date.now()
    if (this.runningTaskIds.has(id) || this.deps.execution.getActiveRunIdForTask(id)) {
      throw new Error("Task is currently running. Stop it before deleting.")
    }
    const oldTask = await this.deps.tasks.get(id)
    this.cancel(id)
    try {
      const deleted = await this.deps.tasks.delete(id)
      if (deleted) this.emitTaskChanged({ taskId: id, reason: "deleted" })
      this.deps.logger?.info("Scheduled task deleted.", {
        boundary: "task-scheduler.task-delete",
        taskId: id,
        deleted,
        durationMs: Date.now() - startedAt,
      })
      return { deleted }
    } catch (err) {
      if (this.started && oldTask?.enabled && oldTask.nextRunAt && this.isTaskValid(oldTask)) {
        await this.schedule(oldTask.id, oldTask.nextRunAt)
      }
      this.deps.logger?.warn("Scheduled task delete failed.", {
        boundary: "task-scheduler.task-delete",
        taskId: id,
        durationMs: Date.now() - startedAt,
        ...errorMetadata(err),
      })
      throw err
    }
  }

  async schedulerTaskEnable(id: string): Promise<ScheduledTaskEntry> {
    return this.setTaskEnabled(id, true)
  }

  async schedulerTaskDisable(id: string): Promise<ScheduledTaskEntry> {
    return this.setTaskEnabled(id, false)
  }

  private async setTaskEnabled(id: string, enabled: boolean): Promise<ScheduledTaskEntry> {
    const startedAt = Date.now()
    const oldTask = await this.deps.tasks.get(id)
    if (enabled && oldTask && !this.isTaskValid(oldTask)) {
      throw new Error(NEEDS_UPDATE_MESSAGE)
    }
    this.cancel(id)
    try {
      const task = await this.deps.tasks.setEnabled(id, enabled)
      if (this.started && task.enabled && this.isTaskValid(task)) await this.schedule(task.id, task.nextRunAt)
      this.emitTaskChanged({ taskId: task.id, reason: enabled ? "enabled" : "disabled" })
      this.deps.logger?.info("Scheduled task enabled state changed.", {
        boundary: "task-scheduler.task-set-enabled",
        taskId: task.id,
        enabled: task.enabled,
        durationMs: Date.now() - startedAt,
      })
      return this.withRuntimeState(task)
    } catch (err) {
      if (this.started && oldTask?.enabled && oldTask.nextRunAt && this.isTaskValid(oldTask)) {
        await this.schedule(oldTask.id, oldTask.nextRunAt)
      }
      this.deps.logger?.warn("Scheduled task enabled state change failed.", {
        boundary: "task-scheduler.task-set-enabled",
        taskId: id,
        enabled,
        durationMs: Date.now() - startedAt,
        ...errorMetadata(err),
      })
      throw err
    }
  }

  async runNow(id: string): Promise<ScheduledTaskRunEntry | null> {
    const startedAt = Date.now()
    const task = await this.deps.tasks.get(id)
    if (!task) {
      this.deps.logger?.info("Scheduled task manual run skipped because task was not found.", {
        boundary: "task-scheduler.task-run-now",
        taskId: id,
        found: false,
        durationMs: Date.now() - startedAt,
      })
      return null
    }
    if (!this.isTaskValid(task)) {
      throw new Error(NEEDS_UPDATE_MESSAGE)
    }
    this.cancel(id)
    try {
      const run = await this.executeOrSkip(task, "manual")
      this.deps.logger?.info("Scheduled task manual run requested.", {
        boundary: "task-scheduler.task-run-now",
        taskId: id,
        runId: run?.id,
        status: run?.status,
        durationMs: Date.now() - startedAt,
      })
      return run
    } catch (error) {
      this.deps.logger?.warn("Scheduled task manual run failed.", {
        boundary: "task-scheduler.task-run-now",
        taskId: id,
        durationMs: Date.now() - startedAt,
        ...errorMetadata(error),
      })
      throw error
    } finally {
      await this.rescheduleAfterManualRun(id)
    }
  }

  runTaskNow(id: string): Promise<ScheduledTaskRunEntry | null> {
    return this.runNow(id)
  }

  async stopRun(runId: string): Promise<{ readonly stopped: boolean }> {
    const run = await this.deps.runs.get(runId)
    const stopped = this.deps.execution.stopRun(runId)
    if (stopped) {
      await Promise.race([
        this.deps.execution.waitForRunToSettle(runId),
        delay(STOP_SETTLE_WAIT_MS),
      ])
    }
    this.deps.logger?.info("Scheduled task stop requested.", {
      ...(run ? { taskId: run.taskId } : {}),
      runId,
      stopped,
      runFound: Boolean(run),
      boundary: "task-scheduler-stop-run",
    })
    if (stopped || run) {
      this.emitTaskChanged({ taskId: run?.taskId, runId, reason: "run-stopped" })
    }
    return { stopped }
  }

  private async stopActiveRuns(): Promise<void> {
    const runIds = new Set(this.deps.execution.getActiveRunIds())
    for (const taskId of this.runningTaskIds) {
      const runId = this.deps.execution.getActiveRunIdForTask(taskId)
      if (runId) runIds.add(runId)
    }
    await Promise.all([...runIds].map((runId) => this.stopRun(runId)))
  }

  async schedulerRunList(
    taskId: string,
    options?: { readonly limit?: number },
  ): Promise<ScheduledTaskRunEntry[]> {
    try {
      const runs = await this.deps.runs.listByTask(taskId, options)
      this.deps.logger?.info("Scheduled task runs listed.", {
        boundary: "task-scheduler.run-list",
        taskId,
        runCount: runs.length,
        limit: options?.limit,
      })
      return runs
    } catch (error) {
      this.deps.logger?.warn("Scheduled task runs list failed.", {
        boundary: "task-scheduler.run-list",
        taskId,
        limit: options?.limit,
        ...errorMetadata(error),
      })
      throw error
    }
  }

  async triggerForTest(
    id: string,
    triggeredBy: ScheduledTaskRunTrigger,
  ): Promise<ScheduledTaskRunEntry | null> {
    return this.runScheduled(id, triggeredBy)
  }

  schedulerRuntimeInspect(): { readonly timers: readonly string[]; readonly runningTaskIds: readonly string[] } {
    return {
      timers: [...this.timers.keys()],
      runningTaskIds: [...this.runningTaskIds],
    }
  }

  private async scheduleOnStartup(task: ScheduledTaskEntry): Promise<void> {
    if (!this.isTaskValid(task)) return
    const decision = resolveStartupSchedule({
      enabled: task.enabled,
      nextRunAt: task.nextRunAt,
      missedRunPolicy: task.missedRunPolicy,
      trigger: task.trigger,
      createdAt: task.createdAt,
      now: this.now(),
    })
    this.deps.logger?.info?.("Scheduled task startup decision.", {
      taskId: task.id,
      action: decision.action,
      name: task.name,
      taskEnabled: task.enabled,
      ...(decision.action === "run_missed_once" ? { missedRunPolicy: task.missedRunPolicy } : {}),
      boundary: "task-scheduler-startup-decision",
    })
    if (decision.action === "none") return
    if (decision.action === "run_missed_once") {
      this.runScheduledInBackground(task.id, "missed_run")
      return
    }
    await this.schedule(task.id, task.nextRunAt)
  }

  private async rescheduleAfterManualRun(id: string): Promise<void> {
    if (!this.started) return
    this.cancel(id)
    const task = await this.deps.tasks.get(id)
    if (!task?.enabled) return
    if (!this.isTaskValid(task)) return
    await this.schedule(id)
  }

  private async schedule(id: string, preferredNextRunAt?: string): Promise<void> {
    this.cancel(id)
    const task = await this.deps.tasks.get(id)
    if (!task?.enabled) return
    if (!this.isTaskValid(task)) return
    const nextRunAt = this.resolveNextRunAt(task, preferredNextRunAt)
    try {
      await this.deps.tasks.markScheduled(id, nextRunAt.toISOString())
    } catch (error) {
      this.deps.logger?.warn?.("markScheduled failed, scheduling in memory only.", {
        taskId: id,
        boundary: "task-scheduler-schedule-fallback",
        ...errorMetadata(error),
      })
    }
    const delayMs = Math.min(
      TIMER_MAX_DELAY_MS,
      Math.max(0, nextRunAt.getTime() - this.now().getTime()),
    )
    const timer = setTimeout(() => {
      this.runScheduledInBackground(id, "schedule")
    }, delayMs)
    this.timers.set(id, timer)
    this.emitTaskChanged({ taskId: id, reason: "scheduled" })
    this.deps.logger?.info?.("Scheduled task timer set.", {
      taskId: id,
      nextRunAt: nextRunAt.toISOString(),
      delayMs,
      boundary: "task-scheduler-schedule-timer",
    })
  }

  private runScheduledInBackground(id: string, triggeredBy: ScheduledTaskRunTrigger): void {
    void this.runScheduled(id, triggeredBy).catch((error) => {
      this.deps.logger?.warn("Scheduled task background run failed.", {
        taskId: id,
        triggeredBy,
        boundary: "task-scheduler-background-run",
        ...errorMetadata(error),
      })
    })
  }

  private async runScheduled(
    id: string,
    triggeredBy: ScheduledTaskRunTrigger,
  ): Promise<ScheduledTaskRunEntry | null> {
    this.timers.delete(id)
    const task = await this.deps.tasks.get(id)
    if (!task) return null
    if (!task.enabled) {
      return this.recordSkipped(task.id, triggeredBy, "task is disabled")
    }
    if (!this.isTaskValid(task)) {
      return this.recordSkipped(task.id, triggeredBy, NEEDS_UPDATE_MESSAGE)
    }
    if (task.activeDays && task.activeDays.length < 7) {
      const timezone = task.trigger.type === "builtin.cron" ? task.trigger.config.timezone : undefined
      const currentDay = getWeekdayForDate(this.now(), timezone)
      if (!task.activeDays.includes(currentDay)) {
        await this.schedule(id)
        return this.recordSkipped(task.id, triggeredBy, "day not in activeDays")
      }
    }
    const deferSchedule =
      task.trigger.type === "builtin.interval" &&
      task.trigger.config.anchor === "last_completed_at"
    if (triggeredBy === "schedule" && !deferSchedule) await this.schedule(id)
    try {
      const result = await this.executeOrSkip(task, triggeredBy)
      return result
    } finally {
      if (
        (triggeredBy === "schedule" && deferSchedule) ||
        triggeredBy === "missed_run"
      ) {
        await this.schedule(id)
      }
    }
  }

  private async executeOrSkip(
    task: ScheduledTaskEntry,
    triggeredBy: ScheduledTaskRunTrigger,
  ): Promise<ScheduledTaskRunEntry> {
    if (this.runningTaskIds.has(task.id)) {
      return this.recordSkipped(task.id, triggeredBy, "task is already running")
    }
    this.runningTaskIds.add(task.id)
    this.emitTaskChanged({ taskId: task.id, reason: "run-started" })
    try {
      const run = await this.deps.execution.runTask(task, triggeredBy)
      this.emitTaskChanged({ taskId: task.id, runId: run.id, reason: "run-finished" })
      return run
    } finally {
      this.runningTaskIds.delete(task.id)
    }
  }

  private async recordSkipped(
    taskId: string,
    triggeredBy: ScheduledTaskRunTrigger,
    error: string,
  ): Promise<ScheduledTaskRunEntry> {
    const run = await this.deps.runs.start(taskId, triggeredBy)
    const finished = await this.deps.runs.finish(run.id, {
      status: "skipped",
      error,
    })
    try {
      await this.deps.tasks.markRunResult(taskId, { status: "skipped" })
    } catch (markError) {
      this.deps.logger?.warn("markRunResult failed after skipped task run.", {
        source: "task-scheduler",
        taskId,
        runId: run.id,
        triggeredBy,
        status: "skipped",
        boundary: "task-scheduler-mark-run-result",
        ...errorMetadata(markError),
      })
    }
    this.deps.logger?.info("Scheduled task run skipped.", {
      taskId,
      runId: run.id,
      triggeredBy,
      status: "skipped",
      boundary: "task-scheduler-skip-run",
      reason: error,
    })
    this.emitTaskChanged({ taskId, runId: finished.id, reason: "run-skipped" })
    return finished
  }

  private emitTaskChanged(payload: TaskSchedulerChangedPayload): void {
    this.deps.eventBus?.emit({
      domain: "scheduler",
      type: "scheduler.taskChanged",
      payload,
      timestamp: this.now().toISOString(),
    }, { backpressure: "coalesce" })
  }

  private resolveNextRunAt(task: ScheduledTaskEntry, preferredNextRunAt?: string): Date {
    if (preferredNextRunAt) {
      const preferred = new Date(preferredNextRunAt)
      if (preferred.getTime() > this.now().getTime()) return preferred
    }
    return computeNextRunAt({
      trigger: task.trigger,
      from: this.now(),
      createdAt: task.createdAt,
      activeDays: task.activeDays,
    })
  }

  private cancel(id: string): void {
    const timer = this.timers.get(id)
    if (!timer) return
    clearTimeout(timer)
    this.timers.delete(id)
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private async withRuntimeState(task: ScheduledTaskEntry): Promise<ScheduledTaskEntry> {
    const validation = this.validateTask(task)
    const baseTask = validation.status === "valid"
      ? task
      : await this.disableInvalidTask(task, validation)
    if (!this.runningTaskIds.has(task.id)) return baseTask
    const runId = this.deps.execution.getActiveRunIdForTask(task.id)
    return {
      ...baseTask,
      activeRun: { status: "running", id: runId },
    }
  }

  private async disableInvalidTask(
    task: ScheduledTaskEntry,
    validation: ScheduledTaskValidation,
  ): Promise<ScheduledTaskEntry> {
    if (!task.enabled) return { ...task, enabled: false, validation }
    this.cancel(task.id)
    try {
      const disabledTask = await this.deps.tasks.setEnabled(task.id, false)
      this.emitTaskChanged({ taskId: task.id, reason: "disabled" })
      return { ...disabledTask, validation }
    } catch (error) {
      this.deps.logger?.warn?.("Failed to persist disabled state for invalid scheduled task.", {
        taskId: task.id,
        boundary: "task-scheduler-disable-invalid",
        ...errorMetadata(error),
      })
      return { ...task, enabled: false, validation }
    }
  }

  private isTaskValid(task: ScheduledTaskEntry): boolean {
    return this.validateTask(task).status === "valid"
  }

  private validateTask(task: ScheduledTaskEntry): ScheduledTaskValidation {
    return this.deps.actions.validateStoredConfig(task.action.type, task.action.config)
  }

  private normalizeCreateInput(input: ScheduledTaskCreateInput): ScheduledTaskCreateInput {
    return { ...input, action: this.normalizeAction(input.action) }
  }

  private normalizeUpdateInput(patch: ScheduledTaskUpdateInput): ScheduledTaskUpdateInput {
    if (!patch.action) return patch
    return { ...patch, action: this.normalizeAction(patch.action) }
  }

  private normalizeAction(action: ScheduledTaskCreateInput["action"]): ScheduledTaskCreateInput["action"] {
    return {
      type: action.type,
      config: this.deps.actions.parseConfig(action.type, action.config),
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMetadata(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

function getWeekdayForDate(date: Date, timezone?: string): number {
  if (!timezone) return date.getDay()
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).formatToParts(date)
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? ""
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[weekdayStr] ?? date.getDay()
}
