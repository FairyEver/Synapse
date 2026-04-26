import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { configStore } from "../../services/config-store"
import type { AutomationCronStoreService } from "../../services/automation-cron-store-service"

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

type ListCronRequest = z.infer<typeof listCronRequestSchema>
type CronDraft = z.infer<typeof cronDraftSchema>
type UpdateCronRequest = z.infer<typeof updateCronRequestSchema>
type ToggleCronRequest = z.infer<typeof toggleCronRequestSchema>
type DeleteCronRequest = z.infer<typeof deleteCronRequestSchema>

async function projects(ctx: IpcHandlerContext) {
  const config = await ctx.resolve<typeof configStore>("core.config").load()
  return config.global.projects
}

function cronService(ctx: IpcHandlerContext): AutomationCronStoreService {
  return ctx.resolve<AutomationCronStoreService>("automation.cron")
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
  },
  events: {},
}
