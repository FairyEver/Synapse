import type {
  MainActionDefinition,
  MainActionRegistry,
  RegisteredMainActionDefinition,
} from "../../action-runtime/action-registry"
import { buildAutomationTemplateVariables } from "../../action-runtime/template-variables"
import { ControlledProcessPermissionError } from "../../runtime/process"
import type { AuditSink, PermissionGuard, PermissionRequest } from "../../runtime/security"
import { sanitizePersistableActionRunResult } from "../action-run-result-sanitize"
import { sanitizeError } from "../error-sanitize"
import { createMainLogger } from "../log-store"
import type { AutomationItemRepository } from "./item-repository"
import type { AutomationRunRepository } from "./run-repository"
import type {
  AutomationItem,
  AutomationRun,
  AutomationRunFinishInput,
  AutomationRunTrigger,
  AutomationTriggerRuntimeContext,
} from "./types"

export interface AutomationExecutionServiceDeps {
  readonly items: Pick<AutomationItemRepository, "markRunResult">
  readonly runs: Pick<AutomationRunRepository, "start" | "finish" | "listByAutomation">
  readonly actions: MainActionRegistry
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly defaultCwd: string
  readonly resolveProjectWorkspacePath?: (projectId: string) => Promise<string | null>
  readonly logger?: AutomationExecutionLogger
}

export interface AutomationExecutionLogger {
  info?(message: string, metadata: Record<string, unknown>): void
  warn(message: string, metadata: Record<string, unknown>): void
}

export interface AutomationRunItemOptions {
  readonly onRunStarted?: (run: AutomationRun) => void
}

export class AutomationExecutionService {
  private readonly activeRuns = new Map<string, AbortController>()
  private readonly activeRunCompletions = new Map<string, Promise<void>>()
  private readonly automationToRunId = new Map<string, string>()
  private readonly logger: AutomationExecutionLogger

  constructor(private readonly deps: AutomationExecutionServiceDeps) {
    this.logger = deps.logger ?? createMainLogger("service.automation.execution")
  }

  async runItem(
    item: AutomationItem,
    triggeredBy: AutomationRunTrigger,
    options: AutomationRunItemOptions = {},
    triggerContext?: AutomationTriggerRuntimeContext,
  ): Promise<AutomationRun> {
    const run = await this.deps.runs.start(item.id, triggeredBy, {
      triggerType: item.trigger.type,
      executorType: item.executor.type,
    })
    const controller = new AbortController()
    let completeRun: (() => void) | undefined
    const completion = new Promise<void>((resolve) => {
      completeRun = resolve
    })
    this.activeRuns.set(run.id, controller)
    this.activeRunCompletions.set(run.id, completion)
    this.automationToRunId.set(item.id, run.id)
    this.logger.info?.("Automation execution started.", {
      source: "automation",
      automationId: item.id,
      runId: run.id,
      triggerType: item.trigger.type,
      executorType: item.executor.type,
      triggeredBy,
      boundary: "automation-execution-start",
    })

    let permissionRequest: PermissionRequest | undefined
    let permissionAllowed = false
    let permissionDenied = false
    let executorPending = false
    try {
      options.onRunStarted?.(run)
      const executor = this.deps.actions.get(item.executor.type)
      const config = executor.manifest.configSchema.parse(item.executor.config)
      const nowIso = new Date().toISOString()
      const effectiveTriggerContext = triggerContext ?? {
        triggeredBy,
        triggeredAt: nowIso,
        scheduledAt: nowIso,
      }
      const templateVariables = buildAutomationTemplateVariables({
        triggerType: item.trigger.type,
        triggerConfig: item.trigger.config,
        triggeredBy: effectiveTriggerContext.triggeredBy,
        triggeredAt: effectiveTriggerContext.triggeredAt,
        scheduledAt: effectiveTriggerContext.scheduledAt,
        automationId: item.id,
        automationName: item.name,
        event: effectiveTriggerContext.event,
      })
      const context = {
        taskId: item.id,
        taskName: item.name,
        runId: run.id,
        triggeredBy: actionTriggeredBy(triggeredBy),
        cwd: await resolveCwd(item, this.deps.defaultCwd, this.deps.resolveProjectWorkspacePath),
        actor: { kind: "user", id: "automation", display: "Automation" } as const,
        abortSignal: controller.signal,
        configVersion: item.configVersion ?? 0,
        templateVariables,
        triggerInput: effectiveTriggerContext.event ?? {
          triggeredBy: effectiveTriggerContext.triggeredBy,
          triggeredAt: effectiveTriggerContext.triggeredAt,
          scheduledAt: effectiveTriggerContext.scheduledAt,
        },
      }
      if (requiresAuthorization(executor)) {
        const request = executor.buildPermissionRequest({ config, context })
        permissionRequest = request
        const permission = await this.deps.permissionGuard.check(request)
        if (!permission.allowed) {
          this.deps.auditSink.record({
            action: request.action,
            actor: request.actor,
            resource: request.resource,
            outcome: "denied",
            metadata: {
              source: "automation",
              automationId: item.id,
              runId: run.id,
              triggerType: item.trigger.type,
              executorType: item.executor.type,
              triggeredBy,
              reason: permission.reason,
            },
          })
          permissionDenied = true
          throw new Error(permission.reason)
        }

        this.deps.auditSink.record({
          action: request.action,
          actor: request.actor,
          resource: request.resource,
          outcome: "allowed",
          metadata: {
            source: "automation",
            automationId: item.id,
            runId: run.id,
            triggerType: item.trigger.type,
            executorType: item.executor.type,
            triggeredBy,
          },
        })
        permissionAllowed = true
      }
      const previousOutputs = executor.manifest.previousOutputs === "none"
        ? undefined
        : await this.getLastSuccessOutputs(item.id)
      executorPending = true
      const result = await executor.execute({ config, context, previousOutputs })
      if (controller.signal.aborted) {
        throw new AutomationRunCancelledError()
      }
      executorPending = false
      if (result.status !== "success") {
        const metadata = {
          source: "automation",
          automationId: item.id,
          runId: run.id,
          triggerType: item.trigger.type,
          executorType: item.executor.type,
          triggeredBy,
          boundary: "automation-executor",
          status: result.status,
          ...resultErrorDiagnostic(result.error),
        }
        if (permissionRequest) {
          this.deps.auditSink.record({
            action: permissionRequest.action,
            actor: permissionRequest.actor,
            resource: permissionRequest.resource,
            outcome: "failed",
            metadata,
          })
        }
        this.logger.warn("Automation executor failed.", metadata)
      }
      const persistenceField = executor.manifest.automationPolicy?.runContentPersistenceConfigField
      const shouldPersistRunContent = !persistenceField
        || (config as Record<string, unknown>)[persistenceField] !== false
      const historyResult = shouldPersistRunContent
        ? result
        : {
            ...result,
            logs: undefined,
            outputs: undefined,
            usage: undefined,
          }
      const sanitizedResult = executor.manifest.resultPersistence === "raw"
        ? historyResult
        : sanitizePersistableActionRunResult(historyResult)
      const persistableResult = sanitizedResult.error
        ? { ...sanitizedResult, error: persistableActionError(sanitizedResult.error) }
        : sanitizedResult
      const finished = await this.deps.runs.finish(run.id, {
        status: result.status,
        result: persistableResult,
        error: persistableResult.error,
      })
      await this.markRunResult(item, run.id, result.status, triggeredBy)
      if (result.status === "success") {
        this.logger.info?.("Automation executor completed.", {
          source: "automation",
          automationId: item.id,
          runId: run.id,
          triggerType: item.trigger.type,
          executorType: item.executor.type,
          triggeredBy,
          boundary: "automation-executor",
          status: result.status,
          hasOutputs: Boolean(result.outputs),
          summaryLength: result.summary?.length ?? 0,
        })
      }
      return finished
    } catch (error) {
      const diagnostic = errorDiagnostic(error)
      const status = controller.signal.aborted ? "cancelled" : "failed"
      if (executorPending && permissionAllowed && permissionRequest) {
        const metadata = {
          source: "automation",
          automationId: item.id,
          runId: run.id,
          triggerType: item.trigger.type,
          executorType: item.executor.type,
          triggeredBy,
          boundary: "automation-executor",
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
        this.logger.warn("Automation executor threw.", metadata)
      } else {
        if (permissionRequest && !permissionAllowed && !permissionDenied) {
          this.deps.auditSink.record({
            action: permissionRequest.action,
            actor: permissionRequest.actor,
            resource: permissionRequest.resource,
            outcome: "failed",
            metadata: {
              source: "automation",
              automationId: item.id,
              runId: run.id,
              triggerType: item.trigger.type,
              executorType: item.executor.type,
              triggeredBy,
              boundary: "automation-pre-execution",
              status,
              ...diagnostic,
            },
          })
        }
        this.logger.warn("Automation preparation failed.", {
          source: "automation",
          automationId: item.id,
          runId: run.id,
          triggerType: item.trigger.type,
          executorType: item.executor.type,
          triggeredBy,
          boundary: "automation-pre-execution",
          status,
          ...diagnostic,
        })
      }
      const innerPermissionError = status === "failed" ? innerPermissionFailureMessage(error) : null
      const visibleError = permissionDenied
        ? errorMessage(error)
        : innerPermissionError ?? visibleFailureMessage(status, diagnostic.errorName)
      const finishInput: AutomationRunFinishInput = {
        status,
        error: visibleError,
        result: {
          status,
          error: visibleError,
          summary: status === "cancelled" ? "已停止" : "执行失败",
        },
      }
      const finished = await this.finishFailedRun(run, finishInput, {
        automationId: item.id,
        executorType: item.executor.type,
        triggeredBy,
        status,
      })
      await this.markRunResult(item, run.id, status, triggeredBy)
      return finished
    } finally {
      this.activeRuns.delete(run.id)
      this.activeRunCompletions.delete(run.id)
      this.automationToRunId.delete(item.id)
      completeRun?.()
    }
  }

  stopRun(runId: string): boolean {
    const controller = this.activeRuns.get(runId)
    if (!controller) return false
    controller.abort()
    return true
  }

  getActiveRunIdForItem(itemId: string): string | undefined {
    return this.automationToRunId.get(itemId)
  }

  getActiveRunIds(): string[] {
    return [...this.activeRuns.keys()]
  }

  waitForRunToSettle(runId: string): Promise<boolean> {
    const completion = this.activeRunCompletions.get(runId)
    if (!completion) return Promise.resolve(false)
    return completion.then(() => true)
  }

  private async getLastSuccessOutputs(automationId: string): Promise<Record<string, unknown> | undefined> {
    const runs = await this.deps.runs.listByAutomation(automationId)
    const lastSuccess = runs.find((run) => run.status === "success" && run.result?.outputs)
    return lastSuccess?.result?.outputs
  }

  private async finishFailedRun(
    run: AutomationRun,
    input: AutomationRunFinishInput,
    context: {
      readonly automationId: string
      readonly executorType: string
      readonly triggeredBy: AutomationRunTrigger
      readonly status: AutomationRunFinishInput["status"]
    },
  ): Promise<AutomationRun> {
    try {
      return await this.deps.runs.finish(run.id, input)
    } catch (error) {
      this.logger.warn("automation runs.finish failed after failed execution; retrying once.", {
        source: "automation",
        automationId: context.automationId,
        runId: run.id,
        executorType: context.executorType,
        triggeredBy: context.triggeredBy,
        status: context.status,
        boundary: "automation-finish-failed-run",
        ...errorDiagnostic(error),
      })
    }

    try {
      return await this.deps.runs.finish(run.id, input)
    } catch (error) {
      this.logger.warn("automation runs.finish retry failed after failed execution.", {
        source: "automation",
        automationId: context.automationId,
        runId: run.id,
        executorType: context.executorType,
        triggeredBy: context.triggeredBy,
        status: context.status,
        boundary: "automation-finish-failed-run",
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

  private async markRunResult(
    item: AutomationItem,
    runId: string,
    status: AutomationRunFinishInput["status"],
    triggeredBy: AutomationRunTrigger,
  ): Promise<void> {
    try {
      await this.deps.items.markRunResult(item.id, { status })
    } catch (error) {
      this.logger.warn("markRunResult failed after automation execution.", {
        source: "automation",
        automationId: item.id,
        runId,
        executorType: item.executor.type,
        triggeredBy,
        status,
        boundary: "automation-mark-run-result",
        ...errorDiagnostic(error),
      })
    }
  }
}

function requiresAuthorization(
  action: RegisteredMainActionDefinition,
): action is MainActionDefinition {
  return action.manifest.authorization !== "none"
}

async function resolveCwd(
  item: AutomationItem,
  defaultCwd: string,
  resolveProjectWorkspacePath?: (projectId: string) => Promise<string | null>,
): Promise<string> {
  const cwd = item.cwd?.trim()
  if (cwd) return cwd
  if (item.scope.type === "project") {
    const projectPath = await resolveProjectWorkspacePath?.(item.scope.projectId)
    if (projectPath) return projectPath
  }
  return defaultCwd
}

function actionTriggeredBy(triggeredBy: AutomationRunTrigger): "schedule" | "manual" | "missed_run" {
  return triggeredBy === "trigger" ? "schedule" : triggeredBy
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

function resultErrorDiagnostic(error: string | undefined): {
  readonly errorName?: string
  readonly errorLength?: number
  readonly diagnosticMessage?: string
} {
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

class AutomationRunCancelledError extends Error {
  constructor() {
    super("Automation run was stopped")
    this.name = "AutomationRunCancelledError"
  }
}

function visibleFailureMessage(status: "failed" | "cancelled", errorName: string): string {
  if (status === "cancelled") return "已停止"
  return `执行失败（${errorName}）`
}
