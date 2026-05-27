import type { MainActionRegistry } from "../../action-runtime/action-registry"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type {
  SchedulerSchedule,
  SchedulerTaskCreateParams,
  SchedulerTaskIdParams,
  SchedulerTaskListParams,
  SchedulerTaskRunsListParams,
  SchedulerTaskRuntimeStatusParams,
  SchedulerTaskUpdateParams,
} from "../../../synapse-capabilities/shared/scheduler-domain"
import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { TaskSchedulerService } from "./task-scheduler-service"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskEntry,
  ScheduledTaskRunEntry,
  ScheduledTaskUpdateInput,
  TaskTrigger,
} from "./types"

type SchedulerServicePort = Pick<
  TaskSchedulerService,
  | "schedulerTaskList"
  | "schedulerTaskGet"
  | "schedulerTaskCreate"
  | "schedulerTaskUpdate"
  | "schedulerTaskEnable"
  | "schedulerTaskDisable"
  | "schedulerRunList"
  | "schedulerRuntimeInspect"
>

export type SchedulerTaskSummary = {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly enabled: boolean
  readonly scope: { readonly type: "global" } | { readonly type: "project"; readonly projectId: string }
  readonly schedule: SchedulerSchedule
  readonly action: { readonly type: string }
  readonly activeDays: readonly number[]
  readonly nextRunAt?: string
  readonly lastRunAt?: string
  readonly lastStatus?: string
  readonly runCount: number
}

export type SchedulerDispatchSecurityDeps = {
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
}

type SchedulerMutationSecurity = {
  readonly actor: { kind: "user"; id: string }
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

const MUTATING_SCHEDULER_ACTIONS = new Set([
  "scheduler.task.create",
  "scheduler.task.enable",
  "scheduler.task.disable",
  "scheduler.task.update",
])

export async function dispatchSchedulerAction(
  service: SchedulerServicePort,
  actions: MainActionRegistry,
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext = {},
  securityDeps: SchedulerDispatchSecurityDeps = {},
): Promise<DispatchResult> {
  const security = schedulerMutationSecurity(action, params, context)
  if (security) await authorizeSchedulerMutation(securityDeps, security)

  try {
    let result: DispatchResult
    switch (action) {
      case "scheduler.task.list": {
        const input = parseListParams(params)
        const tasks = await service.schedulerTaskList()
        const filtered = tasks
          .filter((task) => input.enabled === undefined || task.enabled === input.enabled)
          .filter((task) => {
            if (!input.scope) return true
            if (input.scope.type !== task.scope.type) return false
            if (input.scope.type === "project" && input.scope.projectId) {
              return task.scope.type === "project" && task.scope.projectId === input.scope.projectId
            }
            return true
          })
          .slice(0, input.limit ?? tasks.length)
          .map(toPublicTaskSummary)
        result = { ok: true, data: filtered, total: filtered.length }
        break
      }

      case "scheduler.task.get": {
        const { taskId } = parseTaskIdParams(params)
        const task = await service.schedulerTaskGet(taskId)
        result = { ok: true, data: task ? toPublicTaskSummary(task) : null }
        break
      }

      case "scheduler.task.create": {
        const input = toCreateInput(parseCreateParams(params), actions)
        result = { ok: true, data: toPublicTaskSummary(await service.schedulerTaskCreate(input)) }
        break
      }

      case "scheduler.task.enable": {
        const { taskId } = parseTaskIdParams(params)
        result = { ok: true, data: toPublicTaskSummary(await service.schedulerTaskEnable(taskId)) }
        break
      }

      case "scheduler.task.disable": {
        const { taskId } = parseTaskIdParams(params)
        result = { ok: true, data: toPublicTaskSummary(await service.schedulerTaskDisable(taskId)) }
        break
      }

      case "scheduler.run.list": {
        const input = parseRunsListParams(params)
        const task = await service.schedulerTaskGet(input.taskId)
        if (!task) throw new Error(`Scheduled task "${input.taskId}" was not found`)
        const runs = await service.schedulerRunList(input.taskId, { limit: input.limit })
        result = { ok: true, data: runs.map(toRunSummary), total: runs.length }
        break
      }

      case "scheduler.runtime.inspect": {
        const input = parseRuntimeStatusParams(params)
        result = { ok: true, data: await buildRuntimeStatus(service, input) }
        break
      }

      case "scheduler.action_type.list": {
        const summaries = actions.list().map((definition) => ({
          type: definition.manifest.id,
          title: definition.manifest.title,
          permissions: [...definition.manifest.permissions],
          defaultConfig: definition.manifest.defaultConfig,
          configFields: definition.manifest.configFields,
        }))
        result = { ok: true, data: summaries, total: summaries.length }
        break
      }

      case "scheduler.task.update": {
        const input = parseUpdateParams(params)
        result = { ok: true, data: toPublicTaskSummary(await service.schedulerTaskUpdate(input.taskId, toUpdatePatch(input))) }
        break
      }

      default:
        throw new Error(`Unknown scheduler action: ${action}`)
    }

    if (security) {
      securityDeps.auditSink?.record({
        action: "scheduler.mutate",
        actor: security.actor,
        resource: security.resource,
        outcome: "allowed",
        metadata: security.metadata,
      })
    }
    return result
  } catch (error) {
    if (security) {
      securityDeps.auditSink?.record({
        action: "scheduler.mutate",
        actor: security.actor,
        resource: security.resource,
        outcome: "failed",
        metadata: {
          ...security.metadata,
          errorName: error instanceof Error ? error.name : typeof error,
          errorLength: String(error).length,
        },
      })
    }
    throw error
  }
}

async function authorizeSchedulerMutation(
  deps: SchedulerDispatchSecurityDeps,
  security: SchedulerMutationSecurity,
): Promise<void> {
  const permission = await deps.permissionGuard?.check({
    action: "scheduler.mutate",
    actor: security.actor,
    resource: security.resource,
    context: security.metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: "scheduler.mutate",
      actor: security.actor,
      resource: security.resource,
      outcome: "denied",
      metadata: {
        ...security.metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
}

function schedulerMutationSecurity(
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
): SchedulerMutationSecurity | null {
  if (!MUTATING_SCHEDULER_ACTIONS.has(action)) return null
  const source = context.source ?? "api"
  const taskId = typeof params.taskId === "string" && params.taskId.trim()
    ? params.taskId.trim()
    : action
  return {
    actor: { kind: "user", id: `scheduler-dispatch:${source}` },
    resource: `scheduler:${taskId}`,
    metadata: {
      source,
      schedulerAction: action,
      taskId,
    },
  }
}

export function toPublicTaskSummary(task: ScheduledTaskEntry): SchedulerTaskSummary {
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    enabled: task.enabled,
    scope: task.scope,
    schedule: fromTrigger(task.trigger),
    action: { type: task.action.type },
    activeDays: task.activeDays,
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    lastStatus: task.lastStatus,
    runCount: task.runCount,
  }
}

function toRunSummary(run: ScheduledTaskRunEntry) {
  return {
    id: run.id,
    taskId: run.taskId,
    status: run.status,
    triggeredBy: run.triggeredBy,
    startedAt: run.startedAt,
    ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
    ...(run.error === undefined ? {} : { error: run.error }),
    ...(run.result?.summary === undefined ? {} : { summary: run.result.summary }),
    ...(run.result?.metrics === undefined ? {} : { metrics: run.result.metrics }),
  }
}

async function buildRuntimeStatus(
  service: SchedulerServicePort,
  input: SchedulerTaskRuntimeStatusParams,
) {
  const inspect = service.schedulerRuntimeInspect()
  const runningTaskIds = [...inspect.runningTaskIds]
  const scheduledTaskIds = [...inspect.timers]
  const tasks = input.taskId
    ? [await service.schedulerTaskGet(input.taskId)]
    : await service.schedulerTaskList()
  if (input.taskId && !tasks[0]) {
    throw new Error(`Scheduled task "${input.taskId}" was not found`)
  }
  return {
    runningTaskIds,
    scheduledTaskIds,
    tasks: tasks
      .filter((task): task is ScheduledTaskEntry => task !== null)
      .map((task) => ({
        id: task.id,
        name: task.name,
        enabled: task.enabled,
        running: runningTaskIds.includes(task.id),
        scheduled: scheduledTaskIds.includes(task.id),
        nextRunAt: task.nextRunAt,
        lastRunAt: task.lastRunAt,
        lastStatus: task.lastStatus,
      })),
  }
}

function parseListParams(params: Record<string, unknown>): SchedulerTaskListParams {
  const enabled = params.enabled
  const limit = params.limit
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new Error("Missing or invalid 'enabled': expected boolean")
  }
  if (limit !== undefined && (!Number.isInteger(limit) || Number(limit) < 1)) {
    throw new Error("Missing or invalid 'limit': expected positive integer")
  }
  const scope = parseOptionalScope(params.scope)
  return { enabled: enabled as boolean | undefined, limit: limit as number | undefined, scope }
}

function parseOptionalScope(value: unknown): SchedulerTaskListParams["scope"] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("Missing or invalid 'scope': expected object")
  if (value.type === "global") return { type: "global" }
  if (value.type === "project") {
    const projectId = value.projectId
    if (projectId !== undefined && (typeof projectId !== "string" || !projectId.trim())) {
      throw new Error("Missing or invalid 'scope.projectId': expected non-empty string")
    }
    return { type: "project", projectId: projectId as string | undefined }
  }
  throw new Error("Missing or invalid 'scope.type': expected global or project")
}

function parseTaskIdParams(params: Record<string, unknown>): SchedulerTaskIdParams {
  const taskId = params.taskId
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("Missing or invalid 'taskId': expected non-empty string")
  }
  return { taskId }
}

function parseRunsListParams(params: Record<string, unknown>): SchedulerTaskRunsListParams {
  const { taskId } = parseTaskIdParams(params)
  const rawLimit = params.limit
  if (rawLimit !== undefined && (!Number.isInteger(rawLimit) || Number(rawLimit) < 1)) {
    throw new Error("Missing or invalid 'limit': expected positive integer")
  }
  const limit = rawLimit === undefined ? 20 : Math.min(rawLimit as number, 100)
  return { taskId, limit }
}

function parseRuntimeStatusParams(params: Record<string, unknown>): SchedulerTaskRuntimeStatusParams {
  if (params.taskId === undefined) return {}
  return parseTaskIdParams(params)
}

function parseCreateParams(params: Record<string, unknown>): SchedulerTaskCreateParams {
  const name = params.name
  const scope = params.scope
  const schedule = params.schedule
  const action = params.action
  if (typeof name !== "string" || !name.trim()) throw new Error("Missing or invalid 'name': expected non-empty string")
  if (!isRecord(scope)) throw new Error("Missing or invalid 'scope': expected object")
  if (!isRecord(schedule)) throw new Error("Missing or invalid 'schedule': expected object")
  if (!isRecord(action)) throw new Error("Missing or invalid 'action': expected object")
  return {
    name,
    description: optionalString(params.description, "description"),
    scope: parseScope(scope),
    cwd: optionalString(params.cwd, "cwd"),
    schedule: parseSchedule(schedule),
    action: parseAction(action),
    enabled: optionalBoolean(params.enabled, "enabled"),
    missedRunPolicy: parseMissedRunPolicy(params.missedRunPolicy),
    activeDays: parseOptionalActiveDays(params.activeDays),
  }
}

function parseUpdateParams(params: Record<string, unknown>): SchedulerTaskUpdateParams {
  const allowed = new Set(["taskId", "name", "description", "cwd", "schedule", "activeDays", "missedRunPolicy"])
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) throw new Error(`Forbidden scheduler update field: ${key}`)
  }
  const { taskId } = parseTaskIdParams(params)
  const input: SchedulerTaskUpdateParams = {
    taskId,
    name: optionalString(params.name, "name"),
    description: optionalString(params.description, "description"),
    cwd: optionalString(params.cwd, "cwd"),
    schedule: params.schedule === undefined ? undefined : parseSchedule(requireRecord(params.schedule, "schedule")),
    activeDays: parseOptionalActiveDays(params.activeDays),
    missedRunPolicy: parseMissedRunPolicy(params.missedRunPolicy),
  }
  if (
    input.name === undefined
    && input.description === undefined
    && input.cwd === undefined
    && input.schedule === undefined
    && input.activeDays === undefined
    && input.missedRunPolicy === undefined
  ) {
    throw new Error("scheduler.task.update requires at least one field to update")
  }
  return input
}

function toCreateInput(input: SchedulerTaskCreateParams, actions: MainActionRegistry): ScheduledTaskCreateInput {
  const parsedConfig = actions.parseConfig(input.action.type, input.action.config)
  return {
    name: input.name,
    description: input.description,
    scope: input.scope,
    cwd: input.cwd,
    trigger: toTrigger(input.schedule),
    action: { type: input.action.type, config: parsedConfig },
    enabled: input.enabled,
    missedRunPolicy: input.missedRunPolicy,
    ...(input.activeDays !== undefined ? { activeDays: [...input.activeDays] } : {}),
  }
}

function toUpdatePatch(input: SchedulerTaskUpdateParams): ScheduledTaskUpdateInput {
  return {
    name: input.name,
    description: input.description,
    cwd: input.cwd,
    ...(input.schedule !== undefined ? { trigger: toTrigger(input.schedule) } : {}),
    missedRunPolicy: input.missedRunPolicy,
    ...(input.activeDays !== undefined ? { activeDays: [...input.activeDays] } : {}),
  }
}

function toTrigger(schedule: SchedulerSchedule): TaskTrigger {
  if (schedule.type === "cron") {
    return { type: "builtin.cron", config: { expr: schedule.expr, timezone: schedule.timezone } }
  }
  return { type: "builtin.interval", config: { everyMinutes: schedule.everyMinutes, anchor: schedule.anchor } }
}

function fromTrigger(trigger: TaskTrigger): SchedulerSchedule {
  if (trigger.type === "builtin.cron") {
    return { type: "cron", expr: trigger.config.expr, timezone: trigger.config.timezone }
  }
  return { type: "interval", everyMinutes: trigger.config.everyMinutes, anchor: trigger.config.anchor }
}

function parseScope(scope: Record<string, unknown>): SchedulerTaskCreateParams["scope"] {
  if (scope.type === "global") return { type: "global" }
  if (scope.type === "project" && typeof scope.projectId === "string" && scope.projectId.trim()) {
    return { type: "project", projectId: scope.projectId }
  }
  throw new Error("Missing or invalid 'scope': expected global or project scope")
}

function parseSchedule(schedule: Record<string, unknown>): SchedulerSchedule {
  if (schedule.type === "cron") {
    if (typeof schedule.expr !== "string" || !schedule.expr.trim()) {
      throw new Error("Missing or invalid 'schedule.expr': expected non-empty string")
    }
    return {
      type: "cron",
      expr: schedule.expr,
      timezone: optionalString(schedule.timezone, "schedule.timezone"),
    }
  }
  if (schedule.type === "interval") {
    if (!Number.isInteger(schedule.everyMinutes) || Number(schedule.everyMinutes) < 1) {
      throw new Error("Missing or invalid 'schedule.everyMinutes': expected positive integer")
    }
    if (
      schedule.anchor !== undefined
      && schedule.anchor !== "created_at"
      && schedule.anchor !== "last_completed_at"
    ) {
      throw new Error("Missing or invalid 'schedule.anchor': expected created_at or last_completed_at")
    }
    return {
      type: "interval",
      everyMinutes: schedule.everyMinutes as number,
      anchor: schedule.anchor as "created_at" | "last_completed_at" | undefined,
    }
  }
  throw new Error("Missing or invalid 'schedule.type': expected cron or interval")
}

function parseAction(action: Record<string, unknown>): SchedulerTaskCreateParams["action"] {
  if (typeof action.type !== "string" || !action.type.trim()) {
    throw new Error("Missing or invalid 'action.type': expected non-empty string")
  }
  if (!isRecord(action.config)) throw new Error("Missing or invalid 'action.config': expected object")
  return { type: action.type, config: action.config }
}

function parseMissedRunPolicy(value: unknown): "skip" | "run_once" | undefined {
  if (value === undefined) return undefined
  if (value === "skip" || value === "run_once") return value
  throw new Error("Missing or invalid 'missedRunPolicy': expected skip or run_once")
}

function parseOptionalActiveDays(value: unknown): readonly number[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("Missing or invalid 'activeDays': expected array")
  if (value.length === 0) throw new Error("'activeDays' must contain at least one day (0-6)")
  for (const item of value) {
    if (!Number.isInteger(item) || item < 0 || item > 6) {
      throw new Error("'activeDays' values must be integers 0-6")
    }
  }
  return value as number[]
}

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  throw new Error(`Missing or invalid '${key}': expected string`)
}

function optionalBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === "boolean") return value
  throw new Error(`Missing or invalid '${key}': expected boolean`)
}

function requireRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Missing or invalid '${key}': expected object`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
