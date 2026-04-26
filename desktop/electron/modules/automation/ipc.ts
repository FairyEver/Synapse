import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { configStore } from "../../services/config-store"
import type { AutomationCronStoreService } from "../../services/automation-cron-store-service"
import type { AutomationRuntimeStoreService } from "../../services/automation-runtime-store-service"

const cronModeSchema = z.enum(["", "default", "bypassPermissions", "acceptEdits", "plan", "auto", "dontAsk"])
const cronSessionModeSchema = z.enum(["", "new_per_run"])

const cronJobSchema = z.object({
  id: z.string(),
  project: z.string(),
  sessionKey: z.string(),
  cronExpr: z.string(),
  prompt: z.string(),
  exec: z.string(),
  workDir: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  silent: z.boolean(),
  mute: z.boolean(),
  sessionMode: cronSessionModeSchema,
  mode: cronModeSchema,
  timeoutMins: z.number().nullable(),
  createdAt: z.string(),
  lastRun: z.string().nullable(),
  lastError: z.string(),
  nextRunAt: z.string().nullable(),
  scheduleText: z.string(),
  requiresPermission: z.boolean(),
})

const listCronRequestSchema = z.object({
  project: z.string().optional(),
}).optional()

const listCronResponseSchema = z.object({
  jobs: z.array(cronJobSchema),
})

const cronDraftSchema = z.object({
  project: z.string(),
  sessionKey: z.string(),
  cronExpr: z.string(),
  prompt: z.string(),
  exec: z.string(),
  workDir: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  silent: z.boolean().optional(),
  mute: z.boolean().optional(),
  sessionMode: cronSessionModeSchema.optional(),
  mode: cronModeSchema.optional(),
  timeoutMins: z.number().nullable().optional(),
  permissionDecision: z.enum(["allow", "deny"]).optional(),
})

const cronMutationResponseSchema = z.object({
  status: z.enum(["ok", "permission_required", "denied"]),
  job: cronJobSchema.nullable(),
  error: z.string().nullable(),
})

const updateCronRequestSchema = z.object({
  id: z.string(),
  patch: cronDraftSchema.partial(),
})

const toggleCronRequestSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
})

const deleteCronRequestSchema = z.object({
  id: z.string(),
})

const heartbeatStatusSchema = z.object({
  project: z.string(),
  enabled: z.boolean(),
  paused: z.boolean(),
  intervalMins: z.number(),
  onlyWhenIdle: z.boolean(),
  sessionKey: z.string(),
  prompt: z.string(),
  silent: z.boolean(),
  timeoutMins: z.number(),
  workDir: z.string(),
  runCount: z.number(),
  errorCount: z.number(),
  skippedBusy: z.number(),
  lastRun: z.string().nullable(),
  lastError: z.string(),
})

const heartbeatListResponseSchema = z.object({
  heartbeats: z.array(heartbeatStatusSchema),
})

const heartbeatDraftSchema = z.object({
  project: z.string(),
  enabled: z.boolean().optional(),
  intervalMins: z.number().optional(),
  onlyWhenIdle: z.boolean().optional(),
  sessionKey: z.string().optional(),
  prompt: z.string().optional(),
  silent: z.boolean().optional(),
  timeoutMins: z.number().optional(),
  workDir: z.string().optional(),
})

const heartbeatProjectRequestSchema = z.object({
  project: z.string(),
})

const heartbeatIntervalRequestSchema = z.object({
  project: z.string(),
  intervalMins: z.number(),
})

const heartbeatRunResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("completed"), prompt: z.string(), silent: z.boolean() }),
  z.object({ status: z.literal("skipped_busy"), sessionKey: z.string() }),
  z.object({ status: z.literal("not_found"), project: z.string() }),
  z.object({ status: z.literal("failed"), error: z.string(), prompt: z.string() }),
  z.object({ status: z.literal("timed_out"), error: z.string(), prompt: z.string() }),
])

const hookEventSchema = z.enum([
  "*",
  "message.received",
  "message.sent",
  "session.started",
  "session.ended",
  "cron.triggered",
  "permission.requested",
  "error",
])
const hookConcreteEventSchema = z.enum([
  "message.received",
  "message.sent",
  "session.started",
  "session.ended",
  "cron.triggered",
  "permission.requested",
  "error",
])
const hookTypeSchema = z.enum(["command", "http"])

const hookSchema = z.object({
  id: z.string(),
  project: z.string(),
  event: hookEventSchema,
  type: hookTypeSchema,
  command: z.string(),
  url: z.string(),
  timeout: z.number().nullable(),
  async: z.boolean(),
  createdAt: z.string(),
  lastRun: z.string().nullable(),
  lastError: z.string(),
  lastResult: z.string(),
})

const hookDraftSchema = z.object({
  project: z.string(),
  event: hookEventSchema,
  type: hookTypeSchema,
  command: z.string().optional(),
  url: z.string().optional(),
  timeout: z.number().nullable().optional(),
  async: z.boolean().optional(),
})

const hookListRequestSchema = z.object({
  project: z.string().optional(),
}).optional()

const hookListResponseSchema = z.object({
  hooks: z.array(hookSchema),
})

const updateHookRequestSchema = z.object({
  id: z.string(),
  patch: hookDraftSchema.partial(),
})

const hookIdRequestSchema = z.object({
  id: z.string(),
})

const hookRunResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("permission_required"),
    type: z.literal("command"),
    event: z.string(),
    command: z.string(),
    env: z.record(z.string(), z.string()),
    timeoutMs: z.number(),
    requiresPermission: z.literal(true),
  }),
  z.object({
    status: z.literal("delivered"),
    type: z.literal("http"),
    event: z.string(),
    url: z.string(),
    statusCode: z.number(),
    timeoutMs: z.number(),
  }),
  z.object({
    status: z.literal("failed"),
    type: hookTypeSchema,
    event: z.string(),
    error: z.string(),
    statusCode: z.number().optional(),
    timeoutMs: z.number(),
  }),
  z.object({
    status: z.literal("queued"),
    type: hookTypeSchema,
    event: z.string(),
  }),
])

const testHookRequestSchema = z.object({
  id: z.string(),
  event: hookConcreteEventSchema.optional(),
})

const testHookResponseSchema = z.object({
  results: z.array(hookRunResultSchema),
})

type ListCronRequest = z.infer<typeof listCronRequestSchema>
type CronDraft = z.infer<typeof cronDraftSchema>
type UpdateCronRequest = z.infer<typeof updateCronRequestSchema>
type ToggleCronRequest = z.infer<typeof toggleCronRequestSchema>
type DeleteCronRequest = z.infer<typeof deleteCronRequestSchema>
type HeartbeatDraft = z.infer<typeof heartbeatDraftSchema>
type HeartbeatProjectRequest = z.infer<typeof heartbeatProjectRequestSchema>
type HeartbeatIntervalRequest = z.infer<typeof heartbeatIntervalRequestSchema>
type HookDraft = z.infer<typeof hookDraftSchema>
type HookListRequest = z.infer<typeof hookListRequestSchema>
type UpdateHookRequest = z.infer<typeof updateHookRequestSchema>
type HookIdRequest = z.infer<typeof hookIdRequestSchema>
type TestHookRequest = z.infer<typeof testHookRequestSchema>

async function projects(ctx: IpcHandlerContext) {
  const config = await ctx.resolve<typeof configStore>("core.config").load()
  return config.global.projects
}

function cronService(ctx: IpcHandlerContext): AutomationCronStoreService {
  return ctx.resolve<AutomationCronStoreService>("automation.cron")
}

function runtimeService(ctx: IpcHandlerContext): AutomationRuntimeStoreService {
  return ctx.resolve<AutomationRuntimeStoreService>("automation.runtime")
}

export const automationIpcModule: IpcModule = {
  id: "automation",
  methods: {
    listCron: {
      kind: "invoke",
      channel: "synapse:automation:list-cron",
      request: listCronRequestSchema,
      response: listCronResponseSchema,
      handler: (ctx, input: ListCronRequest) => cronService(ctx).list(input ?? {}),
    },
    createCron: {
      kind: "invoke",
      channel: "synapse:automation:create-cron",
      request: cronDraftSchema,
      response: cronMutationResponseSchema,
      handler: async (ctx, input: CronDraft) => cronService(ctx).create(await projects(ctx), input),
    },
    updateCron: {
      kind: "invoke",
      channel: "synapse:automation:update-cron",
      request: updateCronRequestSchema,
      response: cronMutationResponseSchema,
      handler: (ctx, input: UpdateCronRequest) => cronService(ctx).update(input),
    },
    toggleCron: {
      kind: "invoke",
      channel: "synapse:automation:toggle-cron",
      request: toggleCronRequestSchema,
      response: cronJobSchema,
      handler: (ctx, input: ToggleCronRequest) => cronService(ctx).toggle(input),
    },
    deleteCron: {
      kind: "invoke",
      channel: "synapse:automation:delete-cron",
      request: deleteCronRequestSchema,
      response: z.object({ status: z.literal("ok") }),
      handler: (ctx, input: DeleteCronRequest) => cronService(ctx).delete(input),
    },
    listHeartbeat: {
      kind: "invoke",
      channel: "synapse:automation:list-heartbeat",
      request: z.undefined().optional(),
      response: heartbeatListResponseSchema,
      handler: async (ctx) => runtimeService(ctx).listHeartbeat(await projects(ctx)),
    },
    upsertHeartbeat: {
      kind: "invoke",
      channel: "synapse:automation:upsert-heartbeat",
      request: heartbeatDraftSchema,
      response: heartbeatStatusSchema,
      handler: async (ctx, input: HeartbeatDraft) => runtimeService(ctx).upsertHeartbeat(await projects(ctx), input),
    },
    pauseHeartbeat: {
      kind: "invoke",
      channel: "synapse:automation:pause-heartbeat",
      request: heartbeatProjectRequestSchema,
      response: heartbeatStatusSchema,
      handler: (ctx, input: HeartbeatProjectRequest) => runtimeService(ctx).pauseHeartbeat(input),
    },
    resumeHeartbeat: {
      kind: "invoke",
      channel: "synapse:automation:resume-heartbeat",
      request: heartbeatProjectRequestSchema,
      response: heartbeatStatusSchema,
      handler: (ctx, input: HeartbeatProjectRequest) => runtimeService(ctx).resumeHeartbeat(input),
    },
    setHeartbeatInterval: {
      kind: "invoke",
      channel: "synapse:automation:set-heartbeat-interval",
      request: heartbeatIntervalRequestSchema,
      response: heartbeatStatusSchema,
      handler: (ctx, input: HeartbeatIntervalRequest) => runtimeService(ctx).setHeartbeatInterval(input),
    },
    triggerHeartbeat: {
      kind: "invoke",
      channel: "synapse:automation:trigger-heartbeat",
      request: heartbeatProjectRequestSchema,
      response: heartbeatRunResultSchema,
      handler: (ctx, input: HeartbeatProjectRequest) => runtimeService(ctx).triggerHeartbeat(input),
    },
    listHooks: {
      kind: "invoke",
      channel: "synapse:automation:list-hooks",
      request: hookListRequestSchema,
      response: hookListResponseSchema,
      handler: (ctx, input: HookListRequest) => runtimeService(ctx).listHooks(input ?? {}),
    },
    createHook: {
      kind: "invoke",
      channel: "synapse:automation:create-hook",
      request: hookDraftSchema,
      response: hookSchema,
      handler: async (ctx, input: HookDraft) => runtimeService(ctx).createHook(await projects(ctx), input),
    },
    updateHook: {
      kind: "invoke",
      channel: "synapse:automation:update-hook",
      request: updateHookRequestSchema,
      response: hookSchema,
      handler: (ctx, input: UpdateHookRequest) => runtimeService(ctx).updateHook(input),
    },
    deleteHook: {
      kind: "invoke",
      channel: "synapse:automation:delete-hook",
      request: hookIdRequestSchema,
      response: z.object({ status: z.literal("ok") }),
      handler: (ctx, input: HookIdRequest) => runtimeService(ctx).deleteHook(input),
    },
    testHook: {
      kind: "invoke",
      channel: "synapse:automation:test-hook",
      request: testHookRequestSchema,
      response: testHookResponseSchema,
      handler: (ctx, input: TestHookRequest) => runtimeService(ctx).testHook(input),
    },
  },
  events: {},
}
