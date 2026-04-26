import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import type { FeishuConnectorService } from "../../services/connectors"
import type { HeartbeatService, SchedulerService } from "../../services/scheduler"

const projectRequestSchema = z.object({
  projectId: z.string().min(1),
})

const setupPollRequestSchema = z.object({
  setupId: z.string().min(1),
})

const manualCredentialsRequestSchema = projectRequestSchema.extend({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  ownerOpenId: z.string().optional(),
})

const connectorAllowlistSchema = z.object({
  mode: z.enum(["all", "users"]),
  userIds: z.array(z.string()).optional(),
  adminIds: z.array(z.string()).optional(),
})

const sessionKeyPolicySchema = z.object({
  mode: z.enum(["per-user", "per-channel", "thread"]),
  format: z.string().optional(),
})

const reconnectSchema = z.object({
  attempts: z.number(),
  lastConnectedAt: z.string().optional(),
  nextRetryAt: z.string().optional(),
  lastError: z.string().optional(),
})

const dedupeSchema = z.object({
  ttlMs: z.number(),
  lastMessageIds: z.array(z.string()).optional(),
  ignoreBefore: z.string().optional(),
})

const workspaceConfigSchema = z.object({
  enabled: z.boolean(),
  baseDir: z.string().optional(),
  autoBindByChannelName: z.boolean().optional(),
  idleTimeoutMs: z.number().optional(),
})

const feishuConnectorSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  platform: z.literal("feishu"),
  appId: z.string().optional(),
  ownerOpenId: z.string().optional(),
  status: z.enum(["disabled", "connecting", "connected", "degraded", "error"]),
  allowlist: connectorAllowlistSchema,
  sessionKeyPolicy: sessionKeyPolicySchema,
  reconnect: reconnectSchema.optional(),
  dedupe: dedupeSchema.optional(),
  workspaceConfig: workspaceConfigSchema.optional(),
  lastConnectedAt: z.string().optional(),
  lastError: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

const feishuStatusSchema = z.object({
  projectId: z.string(),
  configured: z.boolean(),
  running: z.boolean(),
  connector: feishuConnectorSummarySchema.optional(),
})

const workspaceConfigUpdateRequestSchema = projectRequestSchema.extend({
  enabled: z.boolean(),
  baseDir: z.string().optional(),
  autoBindByChannelName: z.boolean().optional(),
  idleTimeoutMs: z.number().optional(),
})

const workspaceBindingScopeSchema = z.enum(["project", "shared"])

const workspaceBindingSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  projectId: z.string().optional(),
  scope: workspaceBindingScopeSchema,
  platform: z.literal("feishu"),
  channelKey: z.string(),
  channelName: z.string().optional(),
  workspacePath: z.string(),
  baseDir: z.string().optional(),
  boundBy: z.string().optional(),
  boundAt: z.string(),
  updatedAt: z.string(),
})

const workspaceBindingsSummarySchema = z.object({
  project: z.array(workspaceBindingSchema),
  shared: z.array(workspaceBindingSchema),
})

const routeWorkspaceBindingRequestSchema = projectRequestSchema.extend({
  scope: workspaceBindingScopeSchema,
  channelKey: z.string().min(1),
  workspacePath: z.string().min(1),
  channelName: z.string().optional(),
})

const unbindWorkspaceBindingRequestSchema = projectRequestSchema.extend({
  scope: workspaceBindingScopeSchema,
  channelKey: z.string().min(1),
})

const beginSetupResultSchema = z.object({
  setupId: z.string(),
  deviceCode: z.string(),
  qrUrl: z.string(),
  intervalSeconds: z.number(),
  expiresAt: z.string(),
})

const pollSetupResultSchema = z.object({
  status: z.enum([
    "pending",
    "slow_down",
    "denied",
    "expired",
    "completed",
    "unsupported_platform",
    "error",
  ]),
  intervalSeconds: z.number().optional(),
  appId: z.string().optional(),
  ownerOpenId: z.string().optional(),
  message: z.string().optional(),
})

const scheduledJobSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  projectId: z.string(),
  platform: z.literal("feishu"),
  connectorId: z.string(),
  sessionKey: z.string(),
  channelKey: z.string().optional(),
  channelName: z.string().optional(),
  workspaceKey: z.string().optional(),
  workspacePath: z.string().optional(),
  replyCtx: z.record(z.string(), z.unknown()).optional(),
  kind: z.enum(["prompt", "exec"]),
  cronExpr: z.string(),
  prompt: z.string().optional(),
  exec: z.string().optional(),
  workDir: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean(),
  silent: z.boolean(),
  mute: z.boolean(),
  sessionMode: z.enum(["reuse", "new_per_run"]),
  modeOverride: z.string().optional(),
  timeoutMins: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().optional(),
  lastRunAt: z.string().optional(),
  lastError: z.string().optional(),
  lastStatus: z.enum(["success", "failed", "timeout", "skipped"]).optional(),
  nextRunAt: z.string().optional(),
  runCount: z.number(),
})

const scheduledJobCreateRequestSchema = projectRequestSchema.extend({
  connectorId: z.string().min(1),
  sessionKey: z.string().min(1),
  channelKey: z.string().optional(),
  channelName: z.string().optional(),
  workspaceKey: z.string().optional(),
  workspacePath: z.string().optional(),
  kind: z.enum(["prompt", "exec"]),
  cronExpr: z.string().min(1),
  prompt: z.string().optional(),
  exec: z.string().optional(),
  workDir: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  silent: z.boolean().optional(),
  mute: z.boolean().optional(),
  sessionMode: z.enum(["reuse", "new_per_run", "new-per-run"]).optional(),
  modeOverride: z.string().optional(),
  timeoutMins: z.number().optional(),
})

const scheduledJobIdRequestSchema = projectRequestSchema.extend({
  id: z.string().min(1),
})

const scheduledJobEnabledRequestSchema = scheduledJobIdRequestSchema.extend({
  enabled: z.boolean(),
})

const scheduledJobMutedRequestSchema = scheduledJobIdRequestSchema.extend({
  mute: z.boolean(),
})

const heartbeatSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  projectId: z.string(),
  platform: z.literal("feishu"),
  connectorId: z.string(),
  sessionKey: z.string(),
  channelKey: z.string().optional(),
  workspaceKey: z.string().optional(),
  workspacePath: z.string().optional(),
  replyCtx: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean(),
  paused: z.boolean(),
  intervalMins: z.number(),
  prompt: z.string(),
  silent: z.boolean(),
  mute: z.boolean(),
  timeoutMins: z.number().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().optional(),
  lastError: z.string().optional(),
  lastStatus: z.enum(["success", "failed", "timeout", "skipped"]).optional(),
  nextRunAt: z.string().optional(),
  runCount: z.number(),
})

const heartbeatUpsertRequestSchema = projectRequestSchema.extend({
  connectorId: z.string().min(1),
  sessionKey: z.string().min(1),
  channelKey: z.string().optional(),
  workspaceKey: z.string().optional(),
  workspacePath: z.string().optional(),
  intervalMins: z.number(),
  prompt: z.string().optional(),
  enabled: z.boolean().optional(),
  paused: z.boolean().optional(),
  silent: z.boolean().optional(),
  mute: z.boolean().optional(),
  timeoutMins: z.number().optional(),
})

const heartbeatIdRequestSchema = projectRequestSchema.extend({
  id: z.string().min(1),
})

type ProjectRequest = z.infer<typeof projectRequestSchema>
type SetupPollRequest = z.infer<typeof setupPollRequestSchema>
type ManualCredentialsRequest = z.infer<typeof manualCredentialsRequestSchema>
type WorkspaceConfigUpdateRequest = z.infer<typeof workspaceConfigUpdateRequestSchema>
type RouteWorkspaceBindingRequest = z.infer<typeof routeWorkspaceBindingRequestSchema>
type UnbindWorkspaceBindingRequest = z.infer<typeof unbindWorkspaceBindingRequestSchema>
type ScheduledJobCreateRequest = z.infer<typeof scheduledJobCreateRequestSchema>
type ScheduledJobIdRequest = z.infer<typeof scheduledJobIdRequestSchema>
type ScheduledJobEnabledRequest = z.infer<typeof scheduledJobEnabledRequestSchema>
type ScheduledJobMutedRequest = z.infer<typeof scheduledJobMutedRequestSchema>
type HeartbeatUpsertRequest = z.infer<typeof heartbeatUpsertRequestSchema>
type HeartbeatIdRequest = z.infer<typeof heartbeatIdRequestSchema>

export const connectorsIpcModule: IpcModule = {
  id: "connectors",
  methods: {
    feishuBeginSetup: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:begin-setup",
      request: projectRequestSchema,
      response: beginSetupResultSchema,
      handler: (ctx, request: ProjectRequest) =>
        resolveFeishuConnector(ctx.resolve).beginSetup(request.projectId),
    },
    feishuPollSetup: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:poll-setup",
      request: setupPollRequestSchema,
      response: pollSetupResultSchema,
      handler: (ctx, request: SetupPollRequest) =>
        resolveFeishuConnector(ctx.resolve).pollSetup(request.setupId),
    },
    feishuSaveSetup: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:save-setup",
      request: setupPollRequestSchema,
      response: feishuConnectorSummarySchema,
      handler: (ctx, request: SetupPollRequest) =>
        resolveFeishuConnector(ctx.resolve).saveSetup(request.setupId),
    },
    feishuSaveManualCredentials: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:save-manual-credentials",
      request: manualCredentialsRequestSchema,
      response: feishuConnectorSummarySchema,
      handler: (ctx, request: ManualCredentialsRequest) =>
        resolveFeishuConnector(ctx.resolve).saveManualCredentials(request),
    },
    feishuGetStatus: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:get-status",
      request: projectRequestSchema,
      response: feishuStatusSchema,
      handler: (ctx, request: ProjectRequest) =>
        resolveFeishuConnector(ctx.resolve).getStatus(request.projectId),
    },
    feishuStart: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:start",
      request: projectRequestSchema,
      response: feishuStatusSchema,
      handler: (ctx, request: ProjectRequest) =>
        resolveFeishuConnector(ctx.resolve).startProject(request.projectId),
    },
    feishuStop: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:stop",
      request: projectRequestSchema,
      response: feishuStatusSchema,
      handler: (ctx, request: ProjectRequest) =>
        resolveFeishuConnector(ctx.resolve).stopProject(request.projectId),
    },
    feishuList: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:list",
      request: projectRequestSchema,
      response: z.array(feishuConnectorSummarySchema),
      handler: (ctx, request: ProjectRequest) =>
        resolveFeishuConnector(ctx.resolve).list(request.projectId),
    },
    feishuGetWorkspaceConfig: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:workspace-config:get",
      request: projectRequestSchema,
      response: workspaceConfigSchema,
      handler: (ctx, request: ProjectRequest) =>
        resolveFeishuConnector(ctx.resolve).getWorkspaceConfig(request.projectId),
    },
    feishuUpdateWorkspaceConfig: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:workspace-config:update",
      request: workspaceConfigUpdateRequestSchema,
      response: workspaceConfigSchema,
      handler: (ctx, request: WorkspaceConfigUpdateRequest) =>
        resolveFeishuConnector(ctx.resolve).updateWorkspaceConfig(request),
    },
    feishuListWorkspaceBindings: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:workspace-bindings:list",
      request: projectRequestSchema,
      response: workspaceBindingsSummarySchema,
      handler: (ctx, request: ProjectRequest) =>
        resolveFeishuConnector(ctx.resolve).listWorkspaceBindings(request.projectId),
    },
    feishuRouteWorkspaceBinding: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:workspace-bindings:route",
      request: routeWorkspaceBindingRequestSchema,
      response: workspaceBindingSchema,
      handler: (ctx, request: RouteWorkspaceBindingRequest) =>
        resolveFeishuConnector(ctx.resolve).routeWorkspaceBinding(request),
    },
    feishuUnbindWorkspaceBinding: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:workspace-bindings:unbind",
      request: unbindWorkspaceBindingRequestSchema,
      response: z.object({ ok: z.literal(true) }),
      handler: (ctx, request: UnbindWorkspaceBindingRequest) =>
        resolveFeishuConnector(ctx.resolve).unbindWorkspaceBinding(request),
    },
    feishuListScheduledJobs: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:scheduled-jobs:list",
      request: projectRequestSchema,
      response: z.array(scheduledJobSchema),
      handler: (ctx, request: ProjectRequest) =>
        resolveScheduler(ctx.resolve).listByProject(request.projectId),
    },
    feishuCreateScheduledJob: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:scheduled-jobs:create",
      request: scheduledJobCreateRequestSchema,
      response: scheduledJobSchema,
      handler: (ctx, request: ScheduledJobCreateRequest) =>
        resolveScheduler(ctx.resolve).create({
          ...request,
          platform: "feishu",
        }),
    },
    feishuDeleteScheduledJob: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:scheduled-jobs:delete",
      request: scheduledJobIdRequestSchema,
      response: z.object({ ok: z.literal(true) }),
      handler: async (ctx, request: ScheduledJobIdRequest) => {
        await resolveScheduler(ctx.resolve).delete(request.id)
        return { ok: true }
      },
    },
    feishuSetScheduledJobEnabled: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:scheduled-jobs:set-enabled",
      request: scheduledJobEnabledRequestSchema,
      response: scheduledJobSchema,
      handler: (ctx, request: ScheduledJobEnabledRequest) =>
        resolveScheduler(ctx.resolve).setEnabled(request.id, request.enabled),
    },
    feishuSetScheduledJobMuted: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:scheduled-jobs:set-muted",
      request: scheduledJobMutedRequestSchema,
      response: scheduledJobSchema,
      handler: (ctx, request: ScheduledJobMutedRequest) =>
        resolveScheduler(ctx.resolve).setMuted(request.id, request.mute),
    },
    feishuRunScheduledJob: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:scheduled-jobs:run",
      request: scheduledJobIdRequestSchema,
      response: scheduledJobSchema.nullable(),
      handler: (ctx, request: ScheduledJobIdRequest) =>
        resolveScheduler(ctx.resolve).runNow(request.id),
    },
    feishuListHeartbeats: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:heartbeats:list",
      request: projectRequestSchema,
      response: z.array(heartbeatSchema),
      handler: (ctx, request: ProjectRequest) =>
        resolveHeartbeat(ctx.resolve).listByProject(request.projectId),
    },
    feishuUpsertHeartbeat: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:heartbeats:upsert",
      request: heartbeatUpsertRequestSchema,
      response: heartbeatSchema,
      handler: (ctx, request: HeartbeatUpsertRequest) =>
        resolveHeartbeat(ctx.resolve).upsert({
          ...request,
          platform: "feishu",
        }),
    },
    feishuPauseHeartbeat: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:heartbeats:pause",
      request: heartbeatIdRequestSchema,
      response: heartbeatSchema,
      handler: (ctx, request: HeartbeatIdRequest) =>
        resolveHeartbeat(ctx.resolve).pause(request.id),
    },
    feishuResumeHeartbeat: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:heartbeats:resume",
      request: heartbeatIdRequestSchema,
      response: heartbeatSchema,
      handler: (ctx, request: HeartbeatIdRequest) =>
        resolveHeartbeat(ctx.resolve).resume(request.id),
    },
    feishuRunHeartbeat: {
      kind: "invoke",
      channel: "synapse:connectors:feishu:heartbeats:run",
      request: heartbeatIdRequestSchema,
      response: heartbeatSchema.nullable(),
      handler: (ctx, request: HeartbeatIdRequest) =>
        resolveHeartbeat(ctx.resolve).runNow(request.id),
    },
  },
  events: {},
}

function resolveFeishuConnector(resolve: <T>(serviceId: string) => T): FeishuConnectorService {
  return resolve<FeishuConnectorService>("core.feishu-connector")
}

function resolveScheduler(resolve: <T>(serviceId: string) => T): SchedulerService {
  return resolve<SchedulerService>("core.scheduler")
}

function resolveHeartbeat(resolve: <T>(serviceId: string) => T): HeartbeatService {
  return resolve<HeartbeatService>("core.heartbeat")
}
