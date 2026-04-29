import { shell } from "electron"
import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
} from "../../services/agent-runtime"
import type { AutomationIngressService } from "../../services/automation-ingress"
import { configStore } from "../../services/config-store"
import type { ExecutionIsolationService } from "../../services/execution-isolation"
import { logStore } from "../../services/log-store"
import type { AgentRelayService } from "../../services/relay"
import { collectOpsStatus } from "./status"

const diagnosticsRequestSchema = z.object({
  projectId: z.string().optional(),
})

const projectRequestSchema = z.object({
  projectId: z.string().min(1),
})

const runAsUpdateSchema = projectRequestSchema.extend({
  enabled: z.boolean().optional(),
  user: z.string().optional(),
  envAllowlist: z.array(z.string()).optional(),
  requirePreflight: z.boolean().optional(),
})

const webhookUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  bindAddress: z.string().optional(),
  preferredPort: z.number().optional(),
  path: z.string().optional(),
  maxBodyBytes: z.number().optional(),
  rateLimitPerMinute: z.number().optional(),
  resetToken: z.boolean().optional(),
})

const relayBindingIdSchema = z.object({
  id: z.string().min(1),
})

const compressUpdateSchema = projectRequestSchema.extend({
  agentType: z.string().optional(),
  enabled: z.boolean().optional(),
  maxTokens: z.number().optional(),
  minGapMins: z.number().optional(),
})

const statusSchema = z.object({
  appVersion: z.string(),
  singleInstanceLocked: z.boolean(),
  logPath: z.string(),
  sideChannel: z.object({
    enabled: z.boolean(),
    bindAddress: z.string().optional(),
    port: z.number().optional(),
    sendPath: z.string(),
    cronAddPath: z.string(),
    relaySendPath: z.string(),
  }).optional(),
  webhook: z.object({
    enabled: z.boolean(),
    bindAddress: z.string(),
    path: z.string(),
    preferredPort: z.number().optional(),
    assignedPort: z.number().optional(),
    maxBodyBytes: z.number(),
    rateLimitPerMinute: z.number(),
    serviceRestartRequired: z.boolean().optional(),
    lastError: z.string().optional(),
  }).optional(),
  relay: z.object({
    bindingCount: z.number(),
    recentRunCount: z.number(),
  }).optional(),
  agent: z.object({
    projectId: z.string(),
    agentType: z.string(),
    liveSessions: z.number(),
    busySessions: z.number(),
    queuedTurns: z.number(),
    pendingPermissions: z.number(),
  }).optional(),
  feishu: z.object({
    projectId: z.string(),
    configured: z.boolean(),
    running: z.boolean(),
  }).optional(),
})

type DiagnosticsRequest = z.infer<typeof diagnosticsRequestSchema>
type ProjectRequest = z.infer<typeof projectRequestSchema>
type RunAsUpdateRequest = z.infer<typeof runAsUpdateSchema>
type WebhookUpdateRequest = z.infer<typeof webhookUpdateSchema>
type RelayBindingIdRequest = z.infer<typeof relayBindingIdSchema>
type CompressUpdateRequest = z.infer<typeof compressUpdateSchema>

export const opsIpcModule: IpcModule = {
  id: "ops",
  methods: {
    diagnostics: {
      kind: "invoke",
      channel: "synapse:ops:diagnostics",
      request: diagnosticsRequestSchema,
      response: statusSchema,
      handler: async (ctx, request: DiagnosticsRequest) =>
        collectOpsStatus(ctx.resolve, request),
    },
    openLogDirectory: {
      kind: "invoke",
      channel: "synapse:ops:open-log-directory",
      request: z.void(),
      response: z.object({ ok: z.literal(true) }),
      handler: async (ctx) => {
        const logPath = logStore.getLogDirectory()
        const permission = await ctx.resolve<PermissionGuard>("core.permission-guard").check({
          action: "fs.read.outside-userdata",
          actor: { kind: "user" },
          resource: logPath,
          context: { source: "ops.openLogDirectory" },
        })
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        if (!permission.allowed) {
          auditSink.record({
            action: "fs.read.outside-userdata",
            actor: { kind: "user" },
            resource: logPath,
            outcome: "denied",
            metadata: {
              source: "ops.openLogDirectory",
              reason: permission.reason,
              policyId: permission.policyId,
            },
          })
          throw new Error(permission.reason)
        }
        auditSink.record({
          action: "fs.read.outside-userdata",
          actor: { kind: "user" },
          resource: logPath,
          outcome: "allowed",
          metadata: { source: "ops.openLogDirectory" },
        })
        await shell.openPath(logPath)
        return { ok: true }
      },
    },
    runAsGet: {
      kind: "invoke",
      channel: "synapse:ops:run-as:get",
      request: projectRequestSchema,
      response: z.record(z.string(), z.unknown()),
      handler: (ctx, request: ProjectRequest) =>
        resolveRunAs(ctx.resolve).getConfig(request.projectId),
    },
    runAsUpdate: {
      kind: "invoke",
      channel: "synapse:ops:run-as:update",
      request: runAsUpdateSchema,
      response: z.record(z.string(), z.unknown()),
      handler: (ctx, request: RunAsUpdateRequest) =>
        resolveRunAs(ctx.resolve).updateConfig(request),
    },
    runAsPreflight: {
      kind: "invoke",
      channel: "synapse:ops:run-as:preflight",
      request: projectRequestSchema,
      response: z.record(z.string(), z.unknown()),
      handler: async (ctx, request: ProjectRequest) => {
        const project = await projectById(request.projectId)
        return resolveRunAs(ctx.resolve).preflight(request.projectId, project?.path)
      },
    },
    runAsAuditProbe: {
      kind: "invoke",
      channel: "synapse:ops:run-as:audit-probe",
      request: projectRequestSchema,
      response: z.record(z.string(), z.unknown()),
      handler: async (ctx, request: ProjectRequest) => {
        const project = await projectById(request.projectId)
        return resolveRunAs(ctx.resolve).auditProbe(request.projectId, project?.path)
      },
    },
    webhookStatus: {
      kind: "invoke",
      channel: "synapse:ops:webhook:status",
      request: z.void(),
      response: z.record(z.string(), z.unknown()),
      handler: (ctx) => resolveWebhook(ctx.resolve).getStatus(),
    },
    webhookUpdate: {
      kind: "invoke",
      channel: "synapse:ops:webhook:update",
      request: webhookUpdateSchema,
      response: z.record(z.string(), z.unknown()),
      handler: (ctx, request: WebhookUpdateRequest) =>
        resolveWebhook(ctx.resolve).updateConfig(request),
    },
    webhookRuns: {
      kind: "invoke",
      channel: "synapse:ops:webhook:runs",
      request: z.object({ projectId: z.string().optional() }),
      response: z.array(z.record(z.string(), z.unknown())),
      handler: (ctx, request: { projectId?: string }) =>
        resolveWebhook(ctx.resolve).listRuns(request.projectId),
    },
    relayBindings: {
      kind: "invoke",
      channel: "synapse:ops:relay:bindings",
      request: z.object({ projectId: z.string().optional() }),
      response: z.array(z.record(z.string(), z.unknown())),
      handler: (ctx, request: { projectId?: string }) =>
        resolveRelay(ctx.resolve).listBindings(request.projectId),
    },
    relayRuns: {
      kind: "invoke",
      channel: "synapse:ops:relay:runs",
      request: z.object({ projectId: z.string().optional() }),
      response: z.array(z.record(z.string(), z.unknown())),
      handler: (ctx, request: { projectId?: string }) =>
        resolveRelay(ctx.resolve).listRuns(request.projectId),
    },
    relayUnbind: {
      kind: "invoke",
      channel: "synapse:ops:relay:unbind",
      request: relayBindingIdSchema,
      response: z.object({ ok: z.boolean() }),
      handler: async (ctx, request: RelayBindingIdRequest) => ({
        ok: await resolveRelay(ctx.resolve).unbind(request.id),
      }),
    },
    compressGet: {
      kind: "invoke",
      channel: "synapse:ops:compress:get",
      request: projectRequestSchema,
      response: z.record(z.string(), z.unknown()),
      handler: async (ctx, request: ProjectRequest) => {
        const agent = await resolveProjectAgent(ctx.resolve, request.projectId)
        return agent.getCompressionState()
      },
    },
    compressUpdate: {
      kind: "invoke",
      channel: "synapse:ops:compress:update",
      request: compressUpdateSchema,
      response: z.record(z.string(), z.unknown()),
      handler: async (ctx, request: CompressUpdateRequest) => {
        const agent = await resolveProjectAgent(ctx.resolve, request.projectId)
        return agent.updateCompressionState(request)
      },
    },
  },
  events: {},
}

async function projectById(projectId: string) {
  const config = await configStore.load()
  return config.global.projects.find((item) => item.id === projectId)
}

async function resolveProjectAgent(
  resolve: <T>(serviceId: string) => T,
  projectId: string,
): Promise<AgentRuntimeService> {
  const containers = resolve<ProjectContainerRegistry>("core.project-containers")
  const project = await projectById(projectId)
  if (!project) throw new Error("Project was not found")
  const container = await containers.open(project.id, {
    name: project.name,
    workspacePath: project.path,
  })
  return container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
}

function optional<T>(
  resolve: <U>(serviceId: string) => U,
  serviceId: string,
): T | undefined {
  try {
    return resolve<T>(serviceId)
  } catch {
    return undefined
  }
}

function resolveRunAs(resolve: <T>(serviceId: string) => T): ExecutionIsolationService {
  return resolve<ExecutionIsolationService>("core.execution-isolation")
}

function resolveWebhook(resolve: <T>(serviceId: string) => T): AutomationIngressService {
  return resolve<AutomationIngressService>("core.automation-ingress")
}

function resolveRelay(resolve: <T>(serviceId: string) => T): AgentRelayService {
  return resolve<AgentRelayService>("core.relay")
}
