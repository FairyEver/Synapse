import { computeNextRunAt, resolveStartupSchedule } from "./schedule-calculator"
import type { TaskSchedulerExecutionService } from "./execution-service"
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

export interface TaskSchedulerServiceDeps {
  readonly tasks: ScheduledTaskRepository
  readonly runs: ScheduledTaskRunRepository
  readonly execution: TaskSchedulerExecutionService
  readonly defaultCwd: string
  readonly now?: () => Date
}

export class TaskSchedulerService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly runningTaskIds = new Set<string>()
  private started = false

  constructor(private readonly deps: TaskSchedulerServiceDeps) {}

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    for (const task of await this.deps.tasks.list()) {
      await this.scheduleOnStartup(task)
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.started = false
  }

  listTasks(): Promise<ScheduledTaskEntry[]> {
    return this.deps.tasks.list()
  }

  getTask(id: string): Promise<ScheduledTaskEntry | null> {
    return this.deps.tasks.get(id)
  }

  async createTask(input: ScheduledTaskCreateInput): Promise<ScheduledTaskEntry> {
    const task = await this.deps.tasks.create(input)
    if (this.started && task.enabled) await this.schedule(task.id, task.nextRunAt)
    return task
  }

  async updateTask(id: string, patch: ScheduledTaskUpdateInput): Promise<ScheduledTaskEntry> {
    this.cancel(id)
    const task = await this.deps.tasks.update(id, patch)
    if (this.started && task.enabled) await this.schedule(task.id, task.nextRunAt)
    return task
  }

  async deleteTask(id: string): Promise<{ readonly deleted: boolean }> {
    this.cancel(id)
    return { deleted: await this.deps.tasks.delete(id) }
  }

  async setTaskEnabled(id: string, enabled: boolean): Promise<ScheduledTaskEntry> {
    this.cancel(id)
    const task = await this.deps.tasks.setEnabled(id, enabled)
    if (this.started && task.enabled) await this.schedule(task.id, task.nextRunAt)
    return task
  }

  async runNow(id: string): Promise<ScheduledTaskRunEntry | null> {
    const task = await this.deps.tasks.get(id)
    if (!task) return null
    return this.executeOrSkip(task, "manual")
  }

  runTaskNow(id: string): Promise<ScheduledTaskRunEntry | null> {
    return this.runNow(id)
  }

  stopRun(runId: string): { readonly stopped: boolean } {
    return { stopped: this.deps.execution.stopRun(runId) }
  }

  listRuns(
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

  inspect(): { readonly timers: readonly string[]; readonly runningTaskIds: readonly string[] } {
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
    if (decision.action === "none") return
    if (decision.action === "run_missed_once") {
      void this.runScheduled(task.id, "missed_run")
      return
    }
    await this.schedule(task.id, task.nextRunAt)
  }

  private async schedule(id: string, preferredNextRunAt?: string): Promise<void> {
    this.cancel(id)
    const task = await this.deps.tasks.get(id)
    if (!task?.enabled) return
    const nextRunAt = this.resolveNextRunAt(task, preferredNextRunAt)
    await this.deps.tasks.markScheduled(id, nextRunAt.toISOString())
    const delayMs = Math.min(
      TIMER_MAX_DELAY_MS,
      Math.max(0, nextRunAt.getTime() - this.now().getTime()),
    )
    const timer = setTimeout(() => {
      void this.runScheduled(id, "schedule")
    }, delayMs)
    this.timers.set(id, timer)
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
    if (triggeredBy === "schedule") await this.schedule(id)
    return this.executeOrSkip(task, triggeredBy)
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
}
