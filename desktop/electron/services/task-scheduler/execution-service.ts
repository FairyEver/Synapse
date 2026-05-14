import type { MainActionRegistry } from "../../action-runtime/action-registry"
import type { AuditSink, PermissionGuard, PermissionRequest } from "../../runtime/security"
import { createMainLogger } from "../log-store"
import type { ScheduledTaskRunRepository } from "./run-repository"
import type { ScheduledTaskRepository } from "./task-repository"
import type {
  ScheduledTaskEntry,
  ScheduledTaskRunEntry,
  ScheduledTaskRunTrigger,
} from "./types"

export interface TaskSchedulerExecutionServiceDeps {
  readonly tasks: Pick<ScheduledTaskRepository, "markRunResult">
  readonly runs: Pick<ScheduledTaskRunRepository, "start" | "finish" | "listByTask">
  readonly actions: MainActionRegistry
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly defaultCwd: string
  readonly logger?: TaskSchedulerExecutionLogger
}

export interface TaskSchedulerExecutionLogger {
  warn(message: string, metadata: Record<string, unknown>): void
}

export class TaskSchedulerExecutionService {
  private readonly activeRuns = new Map<string, AbortController>()
  private readonly logger: TaskSchedulerExecutionLogger

  constructor(private readonly deps: TaskSchedulerExecutionServiceDeps) {
    this.logger = deps.logger ?? createMainLogger("service.task-scheduler.execution")
  }

  async runTask(
    task: ScheduledTaskEntry,
    triggeredBy: ScheduledTaskRunTrigger,
  ): Promise<ScheduledTaskRunEntry> {
    const run = await this.deps.runs.start(task.id, triggeredBy)
    const controller = new AbortController()
    this.activeRuns.set(run.id, controller)
    let permissionRequest: PermissionRequest | undefined
    let permissionAllowed = false
    let actionExecutePending = false
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
      permissionRequest = action.buildPermissionRequest({ config, context })
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
      permissionAllowed = true
      const previousOutputs = await this.getLastSuccessOutputs(task.id)
      actionExecutePending = true
      const result = await action.execute({ config, context, previousOutputs })
      actionExecutePending = false
      if (result.status !== "success") {
        const metadata = {
          source: "task-scheduler",
          taskId: task.id,
          runId: run.id,
          actionType: task.action.type,
          triggeredBy,
          boundary: "task-scheduler-action",
          status: result.status,
          ...resultErrorDiagnostic(result.error),
        }
        this.deps.auditSink.record({
          action: permissionRequest.action,
          actor: permissionRequest.actor,
          resource: permissionRequest.resource,
          outcome: "failed",
          metadata,
        })
        this.logger.warn("Scheduled task action failed.", metadata)
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
      const diagnostic = errorDiagnostic(error)
      const status = controller.signal.aborted ? "cancelled" : "failed"
      if (actionExecutePending && permissionAllowed && permissionRequest) {
        const metadata = {
          source: "task-scheduler",
          taskId: task.id,
          runId: run.id,
          actionType: task.action.type,
          triggeredBy,
          boundary: "task-scheduler-action",
          status,
          ...diagnostic,
        }
        this.deps.auditSink.record({
          action: permissionRequest.action,
          actor: permissionRequest.actor,
          resource: permissionRequest.resource,
          outcome: "failed",
          metadata,
        })
        this.logger.warn("Scheduled task action threw.", metadata)
      } else {
        this.logger.warn("Scheduled task preparation failed.", {
          source: "task-scheduler",
          boundary: "task-scheduler-pre-execution",
          taskId: task.id,
          runId: run.id,
          actionType: task.action.type,
          triggeredBy,
          status,
          ...diagnostic,
        })
      }
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

  private async getLastSuccessOutputs(taskId: string): Promise<Record<string, unknown> | undefined> {
    const runs = await this.deps.runs.listByTask(taskId, { limit: 10 })
    const lastSuccess = runs.find((r) => r.status === "success" && r.result?.outputs)
    return lastSuccess?.result?.outputs
  }
}

function resolveCwd(task: ScheduledTaskEntry, defaultCwd: string): string {
  const cwd = task.cwd?.trim()
  return cwd ? cwd : defaultCwd
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: errorMessage(error).length,
  }
}

function resultErrorDiagnostic(error: string | undefined): { readonly errorName?: string; readonly errorLength?: number } {
  if (!error) return {}
  return {
    errorName: "string",
    errorLength: error.length,
  }
}
