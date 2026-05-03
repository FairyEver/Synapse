import type {
  CapabilityDomainDefinition,
  McpToolDefinition,
} from "./types"
import { capabilityIdToMcpTool } from "./naming"

export type SchedulerSchedule =
  | {
      readonly type: "cron"
      readonly expr: string
      readonly timezone?: string
    }
  | {
      readonly type: "interval"
      readonly everyMinutes: number
      readonly anchor?: "created_at" | "last_completed_at"
    }

export type SchedulerTaskCreateParams = {
  readonly name: string
  readonly description?: string
  readonly scope: { readonly type: "global" } | { readonly type: "project"; readonly projectId: string }
  readonly cwd?: string
  readonly schedule: SchedulerSchedule
  readonly action: {
    readonly type: string
    readonly config: Record<string, unknown>
  }
  readonly enabled?: boolean
  readonly missedRunPolicy?: "skip" | "run_once"
}

export type SchedulerTaskUpdateParams = {
  readonly taskId: string
  readonly name?: string
  readonly description?: string
  readonly cwd?: string
  readonly schedule?: SchedulerSchedule
  readonly missedRunPolicy?: "skip" | "run_once"
}

export type SchedulerTaskRunsListParams = {
  readonly taskId: string
  readonly limit?: number
}

export type SchedulerTaskRuntimeStatusParams = {
  readonly taskId?: string
}

export type SchedulerTaskListParams = {
  readonly enabled?: boolean
  readonly limit?: number
}

export type SchedulerTaskIdParams = {
  readonly taskId: string
}

const taskIdProperty = {
  type: "string",
  description: "Scheduled task id. If only a task name is known, call scheduler_task_list first and use the returned id.",
}

const schedulerCapabilities = [
  { id: "scheduler.task.list", title: "List tasks", description: "List scheduled tasks.", mutates: false },
  { id: "scheduler.task.get", title: "Get task", description: "Get one scheduled task.", mutates: false },
  { id: "scheduler.task.create", title: "Create task", description: "Create one scheduled task.", mutates: true },
  { id: "scheduler.task.enable", title: "Enable task", description: "Enable one scheduled task.", mutates: true },
  { id: "scheduler.task.disable", title: "Disable task", description: "Disable one scheduled task.", mutates: true },
  { id: "scheduler.run.list", title: "List runs", description: "List recent runs for one scheduled task.", mutates: false },
  { id: "scheduler.runtime.inspect", title: "Inspect runtime", description: "Inspect Scheduler runtime state.", mutates: false },
  { id: "scheduler.action_type.list", title: "List action types", description: "List task action types.", mutates: false },
  { id: "scheduler.task.update", title: "Update task", description: "Update safe scheduled task fields.", mutates: true },
] as const

export const SCHEDULER_DOMAIN: CapabilityDomainDefinition = {
  id: "scheduler",
  capabilities: schedulerCapabilities,
}

export const SCHEDULER_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  schedulerCapabilities.map((capability) => [capabilityIdToMcpTool(capability.id), capability.id]),
)

export function buildSchedulerTools(): McpToolDefinition[] {
  return [
    {
      name: "scheduler_task_list",
      description: "List scheduled tasks. If only a task name is known, use this first to find the task id.",
      inputSchema: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "Optional filter for enabled or disabled tasks." },
          limit: { type: "number", description: "Optional maximum number of tasks to return." },
        },
      },
    },
    {
      name: "scheduler_task_get",
      description: "Get one scheduled task by taskId. Task names are not unique; use scheduler_task_list first if needed.",
      inputSchema: {
        type: "object",
        properties: { taskId: taskIdProperty },
        required: ["taskId"],
      },
    },
    {
      name: "scheduler_task_create",
      description: "Create a scheduled task. Supports cron and interval schedules and existing Action Runtime action types.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Task name." },
          description: { type: "string", description: "Optional task description." },
          scope: {
            anyOf: [
              { type: "object", properties: { type: { type: "string", enum: ["global"] } }, required: ["type"] },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["project"] },
                  projectId: { type: "string" },
                },
                required: ["type", "projectId"],
              },
            ],
          },
          cwd: { type: "string", description: "Optional working directory." },
          schedule: {
            anyOf: [
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["cron"] },
                  expr: { type: "string", description: "Five-field cron expression." },
                  timezone: { type: "string" },
                },
                required: ["type", "expr"],
              },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["interval"] },
                  everyMinutes: { type: "number", description: "Positive integer interval in minutes." },
                  anchor: { type: "string", enum: ["created_at", "last_completed_at"] },
                },
                required: ["type", "everyMinutes"],
              },
            ],
          },
          action: {
            type: "object",
            properties: {
              type: { type: "string", description: "Action type, such as builtin.command, builtin.script, or builtin.http-request." },
              config: { type: "object", description: "Action config validated by the existing action runtime." },
            },
            required: ["type", "config"],
          },
          enabled: { type: "boolean" },
          missedRunPolicy: { type: "string", enum: ["skip", "run_once"] },
        },
        required: ["name", "scope", "schedule", "action"],
      },
    },
    {
      name: "scheduler_task_enable",
      description: "Enable one scheduled task by taskId.",
      inputSchema: { type: "object", properties: { taskId: taskIdProperty }, required: ["taskId"] },
    },
    {
      name: "scheduler_task_disable",
      description: "Disable one scheduled task by taskId. This prevents future scheduled runs and does not stop a currently running run.",
      inputSchema: { type: "object", properties: { taskId: taskIdProperty }, required: ["taskId"] },
    },
    {
      name: "scheduler_task_runs_list",
      description: "List recent runs for one scheduled task. This is read-only and does not stop or start runs.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: taskIdProperty,
          limit: { type: "number", description: "Optional maximum number of runs. Defaults to 20 and caps at 100." },
        },
        required: ["taskId"],
      },
    },
    {
      name: "scheduler_task_runtime_status",
      description: "Inspect Scheduler runtime state. Pass taskId for one task, or omit it for all tasks.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Optional scheduled task id." },
        },
      },
    },
    {
      name: "scheduler_action_types_list",
      description: "List task action types that can be used when creating scheduled tasks, including public config fields and defaults.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "scheduler_task_update",
      description: "Conservatively update a scheduled task. Only name, description, cwd, schedule, and missedRunPolicy are accepted. Use scheduler_task_enable or scheduler_task_disable for enabled state. Task action, scope, delete, manual run, and stop-run are not exposed through MCP.",
      inputSchema: {
        type: "object",
        properties: {
          taskId: taskIdProperty,
          name: { type: "string", description: "Optional new task name." },
          description: { type: "string", description: "Optional new task description." },
          cwd: { type: "string", description: "Optional working directory." },
          schedule: {
            anyOf: [
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["cron"] },
                  expr: { type: "string", description: "Five-field cron expression." },
                  timezone: { type: "string" },
                },
                required: ["type", "expr"],
              },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["interval"] },
                  everyMinutes: { type: "number", description: "Positive integer interval in minutes." },
                  anchor: { type: "string", enum: ["created_at", "last_completed_at"] },
                },
                required: ["type", "everyMinutes"],
              },
            ],
          },
          missedRunPolicy: { type: "string", enum: ["skip", "run_once"] },
        },
        required: ["taskId"],
      },
    },
  ]
}
