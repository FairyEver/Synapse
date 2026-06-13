import type { MainActionRegistry } from "../../action-runtime/action-registry"
import { ControlledProcessPermissionError } from "../../runtime/process"
import type { ActorIdentity, AuditSink, PermissionGuard, PermissionRequest } from "../../runtime/security"
import { sanitizeError } from "../error-sanitize"
import { createMainLogger } from "../log-store"
import type { ScheduledTaskRunRepository } from "./run-repository"
import type { ScheduledTaskRepository } from "./task-repository"
import type {
  ScheduledTaskEntry,
  ScheduledTaskRunEntry,
  ScheduledTaskRunFinishInput,
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
  info?(message: string, metadata: Record<string, unknown>): void
  warn(message: string, metadata: Record<string, unknown>): void
}

export class TaskSchedulerExecutionService {
  private readonly activeRuns = new Map<string, AbortController>()
  private readonly activeRunCompletions = new Map<string, Promise<void>>()
  private readonly taskToRunId = new Map<string, string>()
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
    let completeRun: (() => void) | undefined
    const completion = new Promise<void>((resolve) => {
      completeRun = resolve
    })
    this.activeRuns.set(run.id, controller)
    this.activeRunCompletions.set(run.id, completion)
    this.taskToRunId.set(task.id, run.id)
    this.logger.info?.("Scheduled task execution started.", {
      source: "task-scheduler",
      taskId: task.id,
      runId: run.id,
      actionType: task.action.type,
      triggeredBy,
      boundary: "task-scheduler-execution-start",
    })
    let permissionRequest: PermissionRequest | undefined
    let permissionAllowed = false
    let permissionDenied = false
    let actionExecutePending = false
    try {
      const action = this.deps.actions.get(task.action.type)
      const config = action.manifest.configSchema.parse(task.action.config)
      const context = {
        taskId: task.id,
        taskName: task.name,
        runId: run.id,
        triggeredBy,
        cwd: resolveCwd(task, this.deps.defaultCwd),
        actor: actorForTask(task),
        abortSignal: controller.signal,
        configVersion: task.configVersion ?? 0,
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
            taskSource: task.provenance?.source,
            taskId: task.id,
            runId: run.id,
            actionType: task.action.type,
            triggeredBy,
            reason: permission.reason,
          },
        })
        permissionDenied = true
        throw new Error(permission.reason)
      }
      this.deps.auditSink.record({
        action: permissionRequest.action,
        actor: permissionRequest.actor,
        resource: permissionRequest.resource,
        outcome: "allowed",
        metadata: {
          source: "task-scheduler",
          taskSource: task.provenance?.source,
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
      if (controller.signal.aborted) {
        throw new TaskRunCancelledError()
      }
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
      const persistableResult = result.error
        ? { ...result, error: persistableActionError(result.error) }
        : result
      const finished = await this.deps.runs.finish(run.id, {
        status: result.status,
        result: persistableResult,
        error: persistableResult.error,
      })
      try {
        await this.deps.tasks.markRunResult(task.id, { status: result.status })
      } catch (markError) {
        this.logger.warn("markRunResult failed after successful run persistence.", {
          source: "task-scheduler",
          taskId: task.id,
          runId: run.id,
          status: result.status,
          boundary: "task-scheduler-mark-run-result",
          ...errorDiagnostic(markError),
        })
      }
      if (result.status === "success") {
        this.logger.info?.("Scheduled task action completed.", {
          source: "task-scheduler",
          taskId: task.id,
          runId: run.id,
          actionType: task.action.type,
          triggeredBy,
          boundary: "task-scheduler-action",
          status: result.status,
          hasOutputs: Boolean(result.outputs),
          summaryLength: result.summary?.length ?? 0,
        })
      }
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
      const innerPermissionError = status === "failed" ? innerPermissionFailureMessage(error) : null
      const visibleError = permissionDenied
        ? message
        : innerPermissionError ?? visibleFailureMessage(status, diagnostic.errorName)
      const finishInput: ScheduledTaskRunFinishInput = {
        status,
        error: visibleError,
        result: {
          status,
          error: visibleError,
          summary: status === "cancelled" ? "已停止" : "执行失败",
        },
      }
      const finished = await this.finishFailedRun(run, finishInput, {
        actionType: task.action.type,
        status,
        taskId: task.id,
        triggeredBy,
      })
      await this.markFailedRunResult(task.id, run.id, status, task.action.type, triggeredBy)
      return finished
    } finally {
      this.activeRuns.delete(run.id)
      this.taskToRunId.delete(task.id)
      this.activeRunCompletions.delete(run.id)
      completeRun?.()
    }
  }

  stopRun(runId: string): boolean {
    const controller = this.activeRuns.get(runId)
    if (!controller) return false
    controller.abort()
    return true
  }

  getActiveRunIdForTask(taskId: string): string | undefined {
    return this.taskToRunId.get(taskId)
  }

  getActiveRunIds(): string[] {
    return [...this.activeRuns.keys()]
  }

  waitForRunToSettle(runId: string): Promise<boolean> {
    const completion = this.activeRunCompletions.get(runId)
    if (!completion) return Promise.resolve(false)
    return completion.then(() => true)
  }

  private async getLastSuccessOutputs(taskId: string): Promise<Record<string, unknown> | undefined> {
    const runs = await this.deps.runs.listByTask(taskId)
    const lastSuccess = runs.find((r) => r.status === "success" && r.result?.outputs)
    return lastSuccess?.result?.outputs
  }

  private async finishFailedRun(
    run: ScheduledTaskRunEntry,
    input: ScheduledTaskRunFinishInput,
    context: {
      readonly actionType: string
      readonly status: ScheduledTaskRunFinishInput["status"]
      readonly taskId: string
      readonly triggeredBy: ScheduledTaskRunTrigger
    },
  ): Promise<ScheduledTaskRunEntry> {
    try {
      return await this.deps.runs.finish(run.id, input)
    } catch (error) {
      this.logger.warn("runs.finish failed after failed task execution; retrying once.", {
        source: "task-scheduler",
        taskId: context.taskId,
        runId: run.id,
        actionType: context.actionType,
        triggeredBy: context.triggeredBy,
        status: context.status,
        boundary: "task-scheduler-finish-failed-run",
        ...errorDiagnostic(error),
      })
    }

    try {
      return await this.deps.runs.finish(run.id, input)
    } catch (error) {
      this.logger.warn("runs.finish retry failed after failed task execution.", {
        source: "task-scheduler",
        taskId: context.taskId,
        runId: run.id,
        actionType: context.actionType,
        triggeredBy: context.triggeredBy,
        status: context.status,
        boundary: "task-scheduler-finish-failed-run",
        ...errorDiagnostic(error),
      })
      return {
        ...run,
        status: input.status,
        result: input.result,
        error: input.error,
      }
    }
  }

  private async markFailedRunResult(
    taskId: string,
    runId: string,
    status: ScheduledTaskRunFinishInput["status"],
    actionType: string,
    triggeredBy: ScheduledTaskRunTrigger,
  ): Promise<void> {
    try {
      await this.deps.tasks.markRunResult(taskId, { status })
    } catch (error) {
      this.logger.warn("markRunResult failed after failed task execution.", {
        source: "task-scheduler",
        taskId,
        runId,
        actionType,
        triggeredBy,
        status,
        boundary: "task-scheduler-mark-run-result",
        ...errorDiagnostic(error),
      })
    }
  }
}

function resolveCwd(task: ScheduledTaskEntry, defaultCwd: string): string {
  const cwd = task.cwd?.trim()
  return cwd ? cwd : defaultCwd
}

function actorForTask(task: ScheduledTaskEntry): ActorIdentity {
  const source = task.provenance?.source
  if (source) {
    return { kind: "connector", id: `scheduler:${source}` }
  }
  return { kind: "user", id: "task-scheduler", display: "Task Scheduler" }
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

function resultErrorDiagnostic(error: string | undefined): { readonly errorName?: string; readonly errorLength?: number; readonly diagnosticMessage?: string } {
  if (!error) return {}
  const sanitized = sanitizePersistableError(error)
  if (sanitized) {
    const truncated = sanitized.length <= 120 ? sanitized : sanitized.slice(0, 120) + "..."
    return { errorName: "action_error", errorLength: error.length, diagnosticMessage: truncated }
  }
  return { errorName: "action_error", errorLength: error.length }
}

function persistableActionError(error: string | undefined): string | undefined {
  if (!error) return undefined
  const sanitized = sanitizePersistableError(error)
  if (!sanitized) return `执行失败（${error.length} 字）`
  const truncated = sanitized.length <= 120 ? sanitized : sanitized.slice(0, 120) + "..."
  return `执行失败：${truncated}`
}

function innerPermissionFailureMessage(error: unknown): string | null {
  if (!(error instanceof ControlledProcessPermissionError) || error.result.allowed) {
    return null
  }
  return persistableActionError(error.result.reason) ?? visibleFailureMessage("failed", error.name)
}

function sanitizePersistableError(value: string): string {
  return sanitizeError(value)
}

class TaskRunCancelledError extends Error {
  constructor() {
    super("Scheduled task run was stopped")
    this.name = "TaskRunCancelledError"
  }
}

function visibleFailureMessage(status: "failed" | "cancelled", errorName: string): string {
  if (status === "cancelled") return "已停止"
  return `执行失败（${errorName}）`
}
