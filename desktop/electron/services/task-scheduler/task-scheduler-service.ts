import { computeNextRunAt, resolveStartupSchedule } from "./schedule-calculator"
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
} from "./types"

const TIMER_MAX_DELAY_MS = 2_147_483_647
const STOP_SETTLE_WAIT_MS = 3_000

export interface TaskSchedulerServiceDeps {
  readonly tasks: ScheduledTaskRepository
  readonly runs: ScheduledTaskRunRepository
  readonly execution: TaskSchedulerExecutionService
  readonly defaultCwd: string
  readonly logger?: StructuredLogger
  readonly now?: () => Date
}

export class TaskSchedulerService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly runningTaskIds = new Set<string>()
  private started = false

  constructor(private readonly deps: TaskSchedulerServiceDeps) {}

  async start(): Promise<void> {
    if (this.started) return
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

  stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.started = false
  }

  async schedulerTaskList(): Promise<ScheduledTaskEntry[]> {
    const tasks = await this.deps.tasks.list()
    return tasks.map((task) => this.withRuntimeState(task))
  }

  async schedulerTaskGet(id: string): Promise<ScheduledTaskEntry | null> {
    const task = await this.deps.tasks.get(id)
    return task ? this.withRuntimeState(task) : null
  }

  async schedulerTaskCreate(input: ScheduledTaskCreateInput): Promise<ScheduledTaskEntry> {
    const task = await this.deps.tasks.create(input)
    if (this.started && task.enabled) await this.schedule(task.id, task.nextRunAt)
    return task
  }

  async schedulerTaskUpdate(id: string, patch: ScheduledTaskUpdateInput): Promise<ScheduledTaskEntry> {
    const oldTask = await this.deps.tasks.get(id)
    this.cancel(id)
    try {
      const task = await this.deps.tasks.update(id, patch)
      if (this.started && task.enabled) await this.schedule(task.id, task.nextRunAt)
      return task
    } catch (err) {
      if (this.started && oldTask?.enabled && oldTask.nextRunAt) {
        await this.schedule(oldTask.id, oldTask.nextRunAt)
      }
      throw err
    }
  }

  async deleteTask(id: string): Promise<{ readonly deleted: boolean }> {
    const oldTask = await this.deps.tasks.get(id)
    this.cancel(id)
    try {
      return { deleted: await this.deps.tasks.delete(id) }
    } catch (err) {
      if (this.started && oldTask?.enabled && oldTask.nextRunAt) {
        await this.schedule(oldTask.id, oldTask.nextRunAt)
      }
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
    const oldTask = await this.deps.tasks.get(id)
    this.cancel(id)
    try {
      const task = await this.deps.tasks.setEnabled(id, enabled)
      if (this.started && task.enabled) await this.schedule(task.id, task.nextRunAt)
      return task
    } catch (err) {
      if (this.started && oldTask?.enabled && oldTask.nextRunAt) {
        await this.schedule(oldTask.id, oldTask.nextRunAt)
      }
      throw err
    }
  }

  async runNow(id: string): Promise<ScheduledTaskRunEntry | null> {
    const task = await this.deps.tasks.get(id)
    if (!task) return null
    return this.executeOrSkip(task, "manual")
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
    return { stopped }
  }

  schedulerRunList(
    taskId: string,
    options?: { readonly limit?: number },
  ): Promise<ScheduledTaskRunEntry[]> {
    return this.deps.runs.listByTask(taskId, options)
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

  private async schedule(id: string, preferredNextRunAt?: string): Promise<void> {
    this.cancel(id)
    const task = await this.deps.tasks.get(id)
    if (!task?.enabled) return
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
    try {
      return await this.deps.execution.runTask(task, triggeredBy)
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
    await this.deps.tasks.markRunResult(taskId, { status: "skipped" })
    this.deps.logger?.info("Scheduled task run skipped.", {
      taskId,
      runId: run.id,
      triggeredBy,
      status: "skipped",
      boundary: "task-scheduler-skip-run",
      reason: error,
    })
    return finished
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

  private withRuntimeState(task: ScheduledTaskEntry): ScheduledTaskEntry {
    if (!this.runningTaskIds.has(task.id)) return task
    const runId = this.deps.execution.getActiveRunIdForTask(task.id)
    return {
      ...task,
      activeRun: { status: "running", id: runId },
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
