import type { ScheduledTaskEntryV1, ScheduledTaskRunEntryV1 } from "../../runtime/data-repo"
import type { TaskActionRegistry } from "./action-registry"
import type { ScheduledTaskRunRepository } from "./run-repository"
import type { ScheduledTaskRepository } from "./task-repository"
import type { ScheduledTaskRunTrigger } from "./types"

export interface TaskSchedulerExecutionServiceDeps {
  readonly tasks: Pick<ScheduledTaskRepository, "markRunResult">
  readonly runs: Pick<ScheduledTaskRunRepository, "start" | "finish">
  readonly actions: TaskActionRegistry
  readonly defaultCwd: string
}

export class TaskSchedulerExecutionService {
  private readonly activeRuns = new Map<string, AbortController>()

  constructor(private readonly deps: TaskSchedulerExecutionServiceDeps) {}

  async runTask(
    task: ScheduledTaskEntryV1,
    triggeredBy: ScheduledTaskRunTrigger,
  ): Promise<ScheduledTaskRunEntryV1> {
    const run = await this.deps.runs.start(task.id, triggeredBy)
    const controller = new AbortController()
    this.activeRuns.set(run.id, controller)
    try {
      const result = await this.deps.actions.get(task.action.type).execute({
        task,
        runId: run.id,
        cwd: resolveCwd(task, this.deps.defaultCwd),
        abortSignal: controller.signal,
      })
      const finished = await this.deps.runs.finish(run.id, {
        status: result.status,
        exitCode: result.process?.exitCode,
        stdout: result.process?.stdout,
        stderr: result.process?.stderr,
        error: result.error,
      })
      await this.deps.tasks.markRunResult(task.id, { status: result.status })
      return finished
    } catch (error) {
      const message = errorMessage(error)
      const status = controller.signal.aborted ? "cancelled" : "failed"
      const finished = await this.deps.runs.finish(run.id, {
        status,
        error: message,
      })
      await this.deps.tasks.markRunResult(task.id, { status })
      return finished
    } finally {
      this.activeRuns.delete(run.id)
    }
  }

  stopRun(runId: string): boolean {
    const controller = this.activeRuns.get(runId)
    if (!controller) return false
    controller.abort()
    return true
  }
}

function resolveCwd(task: ScheduledTaskEntryV1, defaultCwd: string): string {
  const cwd = task.cwd?.trim()
  return cwd ? cwd : defaultCwd
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
