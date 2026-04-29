import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import type { TaskSchedulerService } from "../../services/task-scheduler"

const taskScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }),
  z.object({ type: z.literal("project"), projectId: z.string().min(1) }),
])

const taskTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cron"),
    expr: z.string().min(1),
    timezone: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("interval"),
    everyMinutes: z.number().int().positive(),
    anchor: z.enum(["created_at", "last_completed_at"]).optional(),
  }),
])

const shellTaskActionSchema = z.object({
  type: z.literal("shell_command"),
  mode: z.enum(["command", "script"]),
  content: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
})

const taskActionSchema = shellTaskActionSchema

const taskStatusSchema = z.enum(["success", "failed", "timeout", "cancelled", "skipped"])
const runStatusSchema = z.enum(["running", "success", "failed", "timeout", "cancelled", "skipped"])
const runTriggerSchema = z.enum(["schedule", "manual", "missed_run"])

const taskSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  name: z.string(),
  description: z.string().optional(),
  scope: taskScopeSchema,
  cwd: z.string().optional(),
  trigger: taskTriggerSchema,
  action: taskActionSchema,
  enabled: z.boolean(),
  missedRunPolicy: z.enum(["skip", "run_once"]),
  overlapPolicy: z.literal("skip"),
  createdAt: z.string(),
  updatedAt: z.string(),
  nextRunAt: z.string().optional(),
  lastRunAt: z.string().optional(),
  lastStatus: taskStatusSchema.optional(),
  runCount: z.number(),
})

const runSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  taskId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: runStatusSchema,
  exitCode: z.number().nullable().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  error: z.string().optional(),
  triggeredBy: runTriggerSchema,
})

const createTaskInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scope: taskScopeSchema,
  cwd: z.string().optional(),
  trigger: taskTriggerSchema,
  action: taskActionSchema,
  enabled: z.boolean().optional(),
  missedRunPolicy: z.enum(["skip", "run_once"]).optional(),
})

const updateTaskPatchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  scope: taskScopeSchema.optional(),
  cwd: z.string().optional(),
  trigger: taskTriggerSchema.optional(),
  action: taskActionSchema.optional(),
  enabled: z.boolean().optional(),
  missedRunPolicy: z.enum(["skip", "run_once"]).optional(),
})

const updateTaskRequestSchema = z.object({
  id: z.string().min(1),
  patch: updateTaskPatchSchema,
})

const taskIdRequestSchema = z.object({
  taskId: z.string().min(1),
})

type TaskIdRequest = z.infer<typeof taskIdRequestSchema>
type CreateTaskInput = z.infer<typeof createTaskInputSchema>
type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>
type SetTaskEnabledRequest = TaskIdRequest & { readonly enabled: boolean }
type StopRunRequest = { readonly runId: string }
type ListRunsRequest = TaskIdRequest & { readonly limit?: number }

export const taskSchedulerIpcModule: IpcModule = {
  id: "task-scheduler",
  methods: {
    listTasks: {
      channel: "synapse:task-scheduler:tasks:list",
      kind: "invoke",
      request: z.void().optional(),
      response: z.array(taskSchema),
      handler: async (ctx) => ctx.resolve<TaskSchedulerService>("core.task-scheduler").listTasks(),
    },
    getTask: {
      channel: "synapse:task-scheduler:tasks:get",
      kind: "invoke",
      request: taskIdRequestSchema,
      response: taskSchema.nullable(),
      handler: async (ctx, request: TaskIdRequest) =>
        ctx.resolve<TaskSchedulerService>("core.task-scheduler").getTask(request.taskId),
    },
    createTask: {
      channel: "synapse:task-scheduler:tasks:create",
      kind: "invoke",
      request: createTaskInputSchema,
      response: taskSchema,
      handler: async (ctx, request: CreateTaskInput) =>
        ctx.resolve<TaskSchedulerService>("core.task-scheduler").createTask(request),
    },
    updateTask: {
      channel: "synapse:task-scheduler:tasks:update",
      kind: "invoke",
      request: updateTaskRequestSchema,
      response: taskSchema,
      handler: async (ctx, request: UpdateTaskRequest) =>
        ctx.resolve<TaskSchedulerService>("core.task-scheduler").updateTask(request.id, request.patch),
    },
    deleteTask: {
      channel: "synapse:task-scheduler:tasks:delete",
      kind: "invoke",
      request: taskIdRequestSchema,
      response: z.object({ deleted: z.boolean() }),
      handler: async (ctx, request: TaskIdRequest) =>
        ctx.resolve<TaskSchedulerService>("core.task-scheduler").deleteTask(request.taskId),
    },
    setTaskEnabled: {
      channel: "synapse:task-scheduler:tasks:set-enabled",
      kind: "invoke",
      request: taskIdRequestSchema.extend({ enabled: z.boolean() }),
      response: taskSchema,
      handler: async (ctx, request: SetTaskEnabledRequest) =>
        ctx.resolve<TaskSchedulerService>("core.task-scheduler").setTaskEnabled(request.taskId, request.enabled),
    },
    runTask: {
      channel: "synapse:task-scheduler:tasks:run",
      kind: "invoke",
      request: taskIdRequestSchema,
      response: runSchema.nullable(),
      handler: async (ctx, request: TaskIdRequest) =>
        ctx.resolve<TaskSchedulerService>("core.task-scheduler").runTaskNow(request.taskId),
    },
    stopRun: {
      channel: "synapse:task-scheduler:runs:stop",
      kind: "invoke",
      request: z.object({ runId: z.string().min(1) }),
      response: z.object({ stopped: z.boolean() }),
      handler: async (ctx, request: StopRunRequest) =>
        ctx.resolve<TaskSchedulerService>("core.task-scheduler").stopRun(request.runId),
    },
    listRuns: {
      channel: "synapse:task-scheduler:runs:list",
      kind: "invoke",
      request: taskIdRequestSchema.extend({
        limit: z.number().int().positive().max(100).optional(),
      }),
      response: z.array(runSchema),
      handler: async (ctx, request: ListRunsRequest) =>
        ctx.resolve<TaskSchedulerService>("core.task-scheduler").listRuns(request.taskId, { limit: request.limit }),
    },
  },
  events: {},
}
