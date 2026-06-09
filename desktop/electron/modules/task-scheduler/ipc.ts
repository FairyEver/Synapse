import { BrowserWindow, dialog } from "electron"
import { readFile, writeFile } from "node:fs/promises"
import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard, PermissionAction } from "../../runtime/security"
import { createMainLogger } from "../../services/log-store"
import type { TaskSchedulerService } from "../../services/task-scheduler"

const logger = createMainLogger("task-scheduler.ipc")

type FilePermissionParams = {
  permissionGuard: PermissionGuard
  auditSink: AuditSink
  action: PermissionAction
  resource: string
  source: string
}

async function checkFilePermission({
  permissionGuard,
  auditSink,
  action,
  resource,
  source,
}: FilePermissionParams): Promise<void> {
  const permission = await permissionGuard.check({
    action,
    actor: { kind: "user" },
    resource,
    context: { source },
  })
  if (!permission.allowed) {
    auditSink.record({
      action,
      actor: { kind: "user" },
      resource,
      outcome: "denied",
      metadata: {
        source,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
  auditSink.record({
    action,
    actor: { kind: "user" },
    resource,
    outcome: "allowed",
    metadata: { source },
  })
}

function recordFilePermissionFailure(
  auditSink: AuditSink,
  action: PermissionAction,
  resource: string,
  source: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error)
  auditSink.record({
    action,
    actor: { kind: "user" },
    resource,
    outcome: "failed",
    metadata: {
      source,
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: message.length,
    },
  })
}

const taskScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }),
  z.object({ type: z.literal("project"), projectId: z.string().min(1) }),
])

const taskTriggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("builtin.cron"),
    config: z.object({
      expr: z.string().min(1),
      timezone: z.string().min(1).optional(),
    }),
  }),
  z.object({
    type: z.literal("builtin.interval"),
    config: z.object({
      everyMinutes: z.number().int().positive(),
      anchor: z.enum(["created_at", "last_completed_at"]).optional(),
    }),
  }),
])

const taskActionSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
})

const taskStatusSchema = z.enum(["success", "failed", "timeout", "cancelled", "skipped"])
const runStatusSchema = z.enum(["running", "success", "failed", "timeout", "cancelled", "skipped"])
const runTriggerSchema = z.enum(["schedule", "manual", "missed_run"])
const taskChangedReasonSchema = z.enum([
  "created",
  "updated",
  "deleted",
  "enabled",
  "disabled",
  "scheduled",
  "run-started",
  "run-finished",
  "run-skipped",
  "run-stopped",
])
const activeDaysSchema = z.array(z.number().int().min(0).max(6)).min(1)
const activeRunSchema = z.object({
  status: z.literal("running"),
  id: z.string().min(1).optional(),
})
const taskValidationSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("valid"),
    issues: z.tuple([]),
  }),
  z.object({
    status: z.literal("needs_update"),
    issues: z.array(z.object({
      field: z.string().min(1),
      message: z.string().min(1),
    })).min(1),
  }),
])
const actionRunResultSchema = z.object({
  status: z.enum(["success", "failed", "timeout", "cancelled"]),
  summary: z.string().optional(),
  logs: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  outputs: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  costUsd: z.number().optional(),
  costCny: z.number().optional(),
  costCurrency: z.literal("CNY").optional(),
  metrics: z.object({
    durationMs: z.number().optional(),
    exitCode: z.number().nullable().optional(),
    httpStatus: z.number().optional(),
  }).optional(),
})

const taskSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(2),
  name: z.string(),
  description: z.string().optional(),
  scope: taskScopeSchema,
  cwd: z.string().optional(),
  trigger: taskTriggerSchema,
  action: taskActionSchema,
  enabled: z.boolean(),
  activeDays: activeDaysSchema,
  missedRunPolicy: z.enum(["skip", "run_once"]),
  overlapPolicy: z.literal("skip"),
  createdAt: z.string(),
  updatedAt: z.string(),
  nextRunAt: z.string().optional(),
  lastRunAt: z.string().optional(),
  lastStatus: taskStatusSchema.optional(),
  activeRun: activeRunSchema.optional(),
  validation: taskValidationSchema.optional(),
  runCount: z.number(),
})

const runSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(2),
  taskId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: runStatusSchema,
  result: actionRunResultSchema.optional(),
  error: z.string().optional(),
  triggeredBy: runTriggerSchema,
})
const taskChangedEventPayloadSchema = z.object({
  taskId: z.string().optional(),
  runId: z.string().optional(),
  reason: taskChangedReasonSchema,
})
const taskChangedDomainEventSchema = z.object({
  domain: z.literal("scheduler"),
  type: z.literal("scheduler.taskChanged"),
  payload: taskChangedEventPayloadSchema,
  timestamp: z.string(),
})

const createTaskInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scope: taskScopeSchema,
  cwd: z.string().optional(),
  trigger: taskTriggerSchema,
  action: taskActionSchema,
  enabled: z.boolean().optional(),
  activeDays: activeDaysSchema.optional(),
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
  activeDays: activeDaysSchema.optional(),
  missedRunPolicy: z.enum(["skip", "run_once"]).optional(),
})

const updateTaskRequestSchema = z.object({
  id: z.string().min(1),
  patch: updateTaskPatchSchema,
})

const taskIdRequestSchema = z.object({
  taskId: z.string().min(1),
})
const migrateTaskResultSchema = z.object({
  automationId: z.string().min(1),
  deletedTaskId: z.string().min(1),
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
      handler: async (ctx) => loggedSchedulerIpc(
        "synapse:task-scheduler:tasks:list",
        "task-scheduler.ipc.list-tasks",
        {},
        () => ctx.resolve<TaskSchedulerService>("core.task-scheduler").schedulerTaskList(),
      ),
    },
    getTask: {
      channel: "synapse:task-scheduler:tasks:get",
      kind: "invoke",
      request: taskIdRequestSchema,
      response: taskSchema.nullable(),
      handler: async (ctx, request: TaskIdRequest) => loggedSchedulerIpc(
        "synapse:task-scheduler:tasks:get",
        "task-scheduler.ipc.get-task",
        { taskId: request.taskId },
        () => ctx.resolve<TaskSchedulerService>("core.task-scheduler").schedulerTaskGet(request.taskId),
      ),
    },
    createTask: {
      channel: "synapse:task-scheduler:tasks:create",
      kind: "invoke",
      request: createTaskInputSchema,
      response: taskSchema,
      handler: async (ctx, request: CreateTaskInput) => loggedSchedulerIpc(
        "synapse:task-scheduler:tasks:create",
        "task-scheduler.ipc.create-task",
        {
          actionType: request.action.type,
          triggerType: request.trigger.type,
          enabled: request.enabled,
          taskNameLength: request.name.length,
        },
        () => ctx.resolve<TaskSchedulerService>("core.task-scheduler").schedulerTaskCreate(request),
      ),
    },
    updateTask: {
      channel: "synapse:task-scheduler:tasks:update",
      kind: "invoke",
      request: updateTaskRequestSchema,
      response: taskSchema,
      handler: async (ctx, request: UpdateTaskRequest) => loggedSchedulerIpc(
        "synapse:task-scheduler:tasks:update",
        "task-scheduler.ipc.update-task",
        {
          taskId: request.id,
          patchKeys: Object.keys(request.patch),
        },
        () => ctx.resolve<TaskSchedulerService>("core.task-scheduler").schedulerTaskUpdate(request.id, request.patch),
      ),
    },
    deleteTask: {
      channel: "synapse:task-scheduler:tasks:delete",
      kind: "invoke",
      request: taskIdRequestSchema,
      response: z.object({ deleted: z.boolean() }),
      handler: async (ctx, request: TaskIdRequest) => loggedSchedulerIpc(
        "synapse:task-scheduler:tasks:delete",
        "task-scheduler.ipc.delete-task",
        { taskId: request.taskId },
        () => ctx.resolve<TaskSchedulerService>("core.task-scheduler").deleteTask(request.taskId),
      ),
    },
    migrateTaskToAutomation: {
      channel: "synapse:task-scheduler:tasks:migrate-to-automation",
      kind: "invoke",
      request: taskIdRequestSchema,
      response: migrateTaskResultSchema,
      handler: async (ctx, request: TaskIdRequest) => loggedSchedulerIpc(
        "synapse:task-scheduler:tasks:migrate-to-automation",
        "task-scheduler.ipc.migrate-task-to-automation",
        { taskId: request.taskId },
        () => ctx.resolve<TaskSchedulerService>("core.task-scheduler").migrateTaskToAutomation(request.taskId),
      ),
    },
    setTaskEnabled: {
      channel: "synapse:task-scheduler:tasks:set-enabled",
      kind: "invoke",
      request: taskIdRequestSchema.extend({ enabled: z.boolean() }),
      response: taskSchema,
      handler: async (ctx, request: SetTaskEnabledRequest) => loggedSchedulerIpc(
        "synapse:task-scheduler:tasks:set-enabled",
        "task-scheduler.ipc.set-task-enabled",
        { taskId: request.taskId, enabled: request.enabled },
        () => request.enabled
          ? ctx.resolve<TaskSchedulerService>("core.task-scheduler").schedulerTaskEnable(request.taskId)
          : ctx.resolve<TaskSchedulerService>("core.task-scheduler").schedulerTaskDisable(request.taskId),
      ),
    },
    runTask: {
      channel: "synapse:task-scheduler:tasks:run",
      kind: "invoke",
      request: taskIdRequestSchema,
      response: runSchema.nullable(),
      handler: async (ctx, request: TaskIdRequest) => {
        const startedAt = Date.now()
        try {
          return await ctx.resolve<TaskSchedulerService>("core.task-scheduler").runTaskNow(request.taskId)
        } catch (rawError) {
          logger.warn("Task scheduler manual run IPC failed.", {
            boundary: "task-scheduler.ipc.run-task",
            channel: "synapse:task-scheduler:tasks:run",
            taskId: request.taskId,
            durationMs: Date.now() - startedAt,
            ...errorDiagnostic(rawError),
          })
          throw rawError
        }
      },
    },
    stopRun: {
      channel: "synapse:task-scheduler:runs:stop",
      kind: "invoke",
      request: z.object({ runId: z.string().min(1) }),
      response: z.object({ stopped: z.boolean() }),
      handler: async (ctx, request: StopRunRequest) => loggedSchedulerIpc(
        "synapse:task-scheduler:runs:stop",
        "task-scheduler.ipc.stop-run",
        { runId: request.runId },
        () => ctx.resolve<TaskSchedulerService>("core.task-scheduler").stopRun(request.runId),
      ),
    },
    listRuns: {
      channel: "synapse:task-scheduler:runs:list",
      kind: "invoke",
      request: taskIdRequestSchema.extend({
        limit: z.number().int().positive().max(100).optional(),
      }),
      response: z.array(runSchema),
      handler: async (ctx, request: ListRunsRequest) => loggedSchedulerIpc(
        "synapse:task-scheduler:runs:list",
        "task-scheduler.ipc.list-runs",
        { taskId: request.taskId, limit: request.limit },
        () => ctx.resolve<TaskSchedulerService>("core.task-scheduler").schedulerRunList(request.taskId, { limit: request.limit }),
      ),
    },
    exportTasksToFile: {
      channel: "synapse:task-scheduler:tasks:export-to-file",
      kind: "invoke",
      request: z.object({ json: z.string() }),
      response: z.object({ success: z.boolean(), path: z.string().optional() }),
      handler: async (ctx, request: { json: string }) => {
        const parentWindow = BrowserWindow.getFocusedWindow()
          ?? BrowserWindow.getAllWindows().find(w => w.isVisible() && !w.isDestroyed())
          ?? undefined
        const defaultName = `synapse-tasks-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`
        const result = await dialog.showSaveDialog(parentWindow as unknown as Electron.BaseWindow, {
          title: "导出任务",
          defaultPath: defaultName,
          filters: [{ name: "JSON", extensions: ["json"] }],
        })
        if (result.canceled || !result.filePath) {
          return { success: false }
        }
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        const action: PermissionAction = "fs.write"
        const source = "task-scheduler.exportTasksToFile"
        await checkFilePermission({
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
          auditSink,
          action,
          resource: result.filePath,
          source,
        })
        try {
          await writeFile(result.filePath, request.json, "utf-8")
        } catch (error) {
          recordFilePermissionFailure(auditSink, action, result.filePath, source, error)
          throw error
        }
        return { success: true, path: result.filePath }
      },
    },
    importTasksFromFile: {
      channel: "synapse:task-scheduler:tasks:import-from-file",
      kind: "invoke",
      request: z.void().optional(),
      response: z.object({ success: z.boolean(), content: z.string().optional() }),
      handler: async (ctx) => {
        const parentWindow = BrowserWindow.getFocusedWindow()
          ?? BrowserWindow.getAllWindows().find(w => w.isVisible() && !w.isDestroyed())
          ?? undefined
        const result = await dialog.showOpenDialog(parentWindow as unknown as Electron.BaseWindow, {
          title: "导入任务",
          filters: [{ name: "JSON", extensions: ["json"] }],
          properties: ["openFile"],
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { success: false }
        }
        const filePath = result.filePaths[0]
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        const action: PermissionAction = "fs.read.outside-userdata"
        const source = "task-scheduler.importTasksFromFile"
        await checkFilePermission({
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
          auditSink,
          action,
          resource: filePath,
          source,
        })
        let content: string
        try {
          content = await readFile(filePath, "utf-8")
        } catch (error) {
          recordFilePermissionFailure(auditSink, action, filePath, source, error)
          throw error
        }
        return { success: true, content }
      },
    },
  },
  events: {
    changed: {
      kind: "event",
      channel: "synapse:events:scheduler",
      payload: taskChangedDomainEventSchema,
    },
  },
}

function errorDiagnostic(rawError: unknown): Record<string, unknown> {
  const message = rawError instanceof Error ? rawError.message : String(rawError)
  const errorLike = rawError as { readonly code?: unknown } | null
  const code = typeof errorLike?.code === "string" ? errorLike.code : undefined
  return {
    errorName: rawError instanceof Error ? rawError.name : typeof rawError,
    errorLength: message.length,
    ...(code ? { errorCode: code } : {}),
  }
}

async function loggedSchedulerIpc<T>(
  channel: string,
  boundary: string,
  metadata: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  logger.info("Task scheduler IPC request.", {
    boundary,
    channel,
    ...metadata,
  })
  try {
    const result = await run()
    logger.info("Task scheduler IPC completed.", {
      boundary,
      channel,
      durationMs: Date.now() - startedAt,
      ...metadata,
    })
    return result
  } catch (rawError) {
    logger.warn("Task scheduler IPC failed.", {
      boundary,
      channel,
      durationMs: Date.now() - startedAt,
      ...metadata,
      ...errorDiagnostic(rawError),
    })
    throw rawError
  }
}
