import type { MainActionRegistry } from "../../action-runtime/action-registry"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { ScheduledTaskRunRepository } from "./run-repository"
import type { ScheduledTaskRepository } from "./task-repository"
import type {
  ScheduledTaskEntry,
  ScheduledTaskRunEntry,
  ScheduledTaskRunTrigger,
} from "./types"

export interface TaskSchedulerExecutionServiceDeps {
  readonly tasks: Pick<ScheduledTaskRepository, "markRunResult">
  readonly runs: Pick<ScheduledTaskRunRepository, "start" | "finish">
  readonly actions: MainActionRegistry
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly defaultCwd: string
}

export class TaskSchedulerExecutionService {
  private readonly activeRuns = new Map<string, AbortController>()

  constructor(private readonly deps: TaskSchedulerExecutionServiceDeps) {}

  async runTask(
    task: ScheduledTaskEntry,
    triggeredBy: ScheduledTaskRunTrigger,
  ): Promise<ScheduledTaskRunEntry> {
    const run = await this.deps.runs.start(task.id, triggeredBy)
    const controller = new AbortController()
    this.activeRuns.set(run.id, controller)
    try {
      const action = this.deps.actions.get(task.action.type)
      const config = action.manifest.configSchema.parse(task.action.config)
      const context = {
        taskId: task.id,
        runId: run.id,
        triggeredBy,
        cwd: resolveCwd(task, this.deps.defaultCwd),
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" } as const,
        abortSignal: controller.signal,
      }
      const permissionRequest = action.buildPermissionRequest({ config, context })
      const permission = await this.deps.permissionGuard.check(permissionRequest)
      if (!permission.allowed) {
        this.deps.auditSink.record({
          action: permissionRequest.action,
          actor: permissionRequest.actor,
          resource: permissionRequest.resource,
          outcome: "denied",
          metadata: {
            source: "task-scheduler",
            taskId: task.id,
            runId: run.id,
            actionType: task.action.type,
            triggeredBy,
            reason: permission.reason,
          },
        })
        throw new Error(permission.reason)
      }
      this.deps.auditSink.record({
        action: permissionRequest.action,
        actor: permissionRequest.actor,
        resource: permissionRequest.resource,
        outcome: "allowed",
        metadata: {
          source: "task-scheduler",
          taskId: task.id,
          runId: run.id,
          actionType: task.action.type,
          triggeredBy,
        },
      })
      const result = await action.execute({ config, context })
      if (result.status !== "success") {
        this.deps.auditSink.record({
          action: permissionRequest.action,
          actor: permissionRequest.actor,
          resource: permissionRequest.resource,
          outcome: "failed",
          metadata: {
            source: "task-scheduler",
            taskId: task.id,
            runId: run.id,
            actionType: task.action.type,
            triggeredBy,
            status: result.status,
            error: result.error,
          },
        })
      }
      const finished = await this.deps.runs.finish(run.id, {
        status: result.status,
        result,
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
        result: {
          status,
          error: message,
          summary: status === "cancelled" ? "已停止" : "执行失败",
        },
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

function resolveCwd(task: ScheduledTaskEntry, defaultCwd: string): string {
  const cwd = task.cwd?.trim()
  return cwd ? cwd : defaultCwd
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
