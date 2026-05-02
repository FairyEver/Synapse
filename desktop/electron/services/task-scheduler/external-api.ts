import type {
  SchedulerTaskCreateParams,
  SchedulerTaskIdParams,
  SchedulerTaskListParams,
} from "../../../synapse-capabilities/shared/scheduler-domain"
import type { DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { TaskSchedulerService } from "./task-scheduler-service"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskEntry,
  TaskTrigger,
} from "./types"

type SchedulerServicePort = Pick<
  TaskSchedulerService,
  "listTasks" | "getTask" | "createTask" | "setTaskEnabled"
>

export type SchedulerTaskSummary = {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly enabled: boolean
  readonly schedule: SchedulerTaskCreateParams["schedule"]
  readonly action: { readonly type: string }
  readonly nextRunAt?: string
  readonly lastRunAt?: string
  readonly lastStatus?: string
  readonly runCount: number
}

export async function dispatchSchedulerAction(
  service: SchedulerServicePort,
  action: string,
  params: Record<string, unknown>,
): Promise<DispatchResult> {
  switch (action) {
    case "schedulerTaskList": {
      const input = parseListParams(params)
      const tasks = await service.listTasks()
      const filtered = tasks
        .filter((task) => input.enabled === undefined || task.enabled === input.enabled)
        .slice(0, input.limit ?? tasks.length)
        .map(toPublicTaskSummary)
      return { ok: true, data: filtered, total: filtered.length }
    }

    case "schedulerTaskGet": {
      const { taskId } = parseTaskIdParams(params)
      return { ok: true, data: await service.getTask(taskId) }
    }

    case "schedulerTaskCreate": {
      const input = toCreateInput(parseCreateParams(params))
      return { ok: true, data: await service.createTask(input) }
    }

    case "schedulerTaskEnable": {
      const { taskId } = parseTaskIdParams(params)
      return { ok: true, data: await service.setTaskEnabled(taskId, true) }
    }

    case "schedulerTaskDisable": {
      const { taskId } = parseTaskIdParams(params)
      return { ok: true, data: await service.setTaskEnabled(taskId, false) }
    }

    default:
      throw new Error(`Unknown scheduler action: ${action}`)
  }
}

export function toPublicTaskSummary(task: ScheduledTaskEntry): SchedulerTaskSummary {
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    enabled: task.enabled,
    schedule: fromTrigger(task.trigger),
    action: { type: task.action.type },
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    lastStatus: task.lastStatus,
    runCount: task.runCount,
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
  return {
    enabled: enabled as boolean | undefined,
    limit: limit as number | undefined,
  }
}

function parseTaskIdParams(params: Record<string, unknown>): SchedulerTaskIdParams {
  const taskId = params.taskId
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("Missing or invalid 'taskId': expected non-empty string")
  }
  return { taskId }
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
  }
}

function toCreateInput(input: SchedulerTaskCreateParams): ScheduledTaskCreateInput {
  return {
    name: input.name,
    description: input.description,
    scope: input.scope,
    cwd: input.cwd,
    trigger: toTrigger(input.schedule),
    action: input.action,
    enabled: input.enabled,
    missedRunPolicy: input.missedRunPolicy,
  }
}

function toTrigger(schedule: SchedulerTaskCreateParams["schedule"]): TaskTrigger {
  if (schedule.type === "cron") {
    return { type: "builtin.cron", config: { expr: schedule.expr, timezone: schedule.timezone } }
  }
  return { type: "builtin.interval", config: { everyMinutes: schedule.everyMinutes, anchor: schedule.anchor } }
}

function fromTrigger(trigger: TaskTrigger): SchedulerTaskCreateParams["schedule"] {
  if (trigger.type === "builtin.cron") {
    return { type: "cron", expr: trigger.config.expr, timezone: trigger.config.timezone }
  }
  return {
    type: "interval",
    everyMinutes: trigger.config.everyMinutes,
    anchor: trigger.config.anchor,
  }
}

function parseScope(scope: Record<string, unknown>): SchedulerTaskCreateParams["scope"] {
  if (scope.type === "global") return { type: "global" }
  if (scope.type === "project" && typeof scope.projectId === "string" && scope.projectId.trim()) {
    return { type: "project", projectId: scope.projectId }
  }
  throw new Error("Missing or invalid 'scope': expected global or project scope")
}

function parseSchedule(schedule: Record<string, unknown>): SchedulerTaskCreateParams["schedule"] {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
