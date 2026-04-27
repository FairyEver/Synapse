import { shell } from "electron"
import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import type { ConversationEntryV1 } from "../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
  type AgentEvent,
} from "../../services/agent-runtime"
import { resolveLocalReference } from "../../services/agent-runtime/references"
import { whichBin } from "../../services/agent-runtime/binary-detect-service"
import {
  ProviderConfigService,
  PROVIDER_CONFIG_SERVICE_ID,
} from "../../services/provider-config"
import { configStore } from "../../services/config-store"
import { agentRuntimeDefinitions } from "../../services/definitions/generated/main-registry"

const projectRequestSchema = z.object({
  projectId: z.string().min(1),
})

const sessionsRequestSchema = projectRequestSchema.extend({
  historyLimit: z.number().int().positive().max(200).optional(),
})

const timelineRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  conversationId: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
})

const createSessionRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  name: z.string().optional(),
})

const switchSessionRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  conversationId: z.string().min(1),
})

const deleteSessionRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
})

const sendRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  content: z.string().min(1),
})

const respondPermissionRequestSchema = projectRequestSchema.extend({
  requestId: z.string().min(1),
  behavior: z.enum(["allow", "deny"]),
  message: z.string().optional(),
})

const openReferenceRequestSchema = projectRequestSchema.extend({
  reference: z.string().min(1),
})

const runtimeStatusRequestSchema = z.object({
  projectId: z.string().optional(),
})

const timelineEntrySchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  timestamp: z.string(),
})

const sessionSummarySchema = z.object({
  projectId: z.string(),
  id: z.string(),
  sessionKey: z.string(),
  name: z.string().optional(),
  platform: z.string().optional(),
  sourceLabel: z.string().optional(),
  agentType: z.string().optional(),
  agentSessionId: z.string().optional(),
  active: z.boolean(),
  historyCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessage: timelineEntrySchema.optional(),
})

const statusSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  agentType: z.string(),
  liveSessions: z.number(),
  busySessions: z.number(),
  queuedTurns: z.number(),
  pendingPermissions: z.number(),
})

const providerSummarySchema = z.object({
  id: z.string(),
  display: z.string().optional(),
  active: z.boolean(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  scope: z.enum(["global", "project"]),
})

const providerStateSchema = z.object({
  projectId: z.string(),
  agentType: z.string(),
  providers: z.array(providerSummarySchema),
  activeProviderId: z.string().optional(),
  activeModel: z.string().optional(),
  activeMode: z.string().optional(),
})

const runtimeStatusSchema = z.object({
  projectId: z.string().optional(),
  agents: z.array(z.object({
    id: z.string(),
    label: z.string(),
    ready: z.boolean(),
    cli: z.object({
      required: z.boolean(),
      binary: z.string().optional(),
      installed: z.boolean(),
      path: z.string().nullable(),
    }),
    provider: z.object({
      projectId: z.string().optional(),
      configured: z.boolean(),
      activeProviderId: z.string().optional(),
      activeModel: z.string().optional(),
    }).optional(),
    issues: z.array(z.string()),
  })),
})

const publishedCommandSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  source: z.enum(["builtin", "custom", "skill", "agent-native"]),
  kind: z.enum(["builtin", "prompt", "exec", "skill", "agent-native"]),
  adminOnly: z.boolean(),
  allowedPlatforms: z.array(z.string()).optional(),
})

const agentEventBaseSchema = {
  agentSessionId: z.string().optional(),
  threadId: z.string().optional(),
}

const agentEventTypeSchema = z.enum([
  "text",
  "thinking",
  "toolUse",
  "toolResult",
  "permissionRequest",
  "result",
  "error",
])

const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ ...agentEventBaseSchema, type: z.literal("text"), content: z.string() }),
  z.object({ ...agentEventBaseSchema, type: z.literal("thinking"), content: z.string() }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("toolUse"),
    toolName: z.string(),
    toolInput: z.string().optional(),
    toolInputRaw: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("toolResult"),
    toolName: z.string(),
    content: z.string().optional(),
    status: z.string().optional(),
    exitCode: z.number().optional(),
    success: z.boolean().optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("permissionRequest"),
    requestId: z.string(),
    toolName: z.string(),
    toolInput: z.string().optional(),
    toolInputRaw: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("result"),
    content: z.string(),
    done: z.literal(true),
    metadata: z.object({
      model: z.string().optional(),
      effort: z.string().optional(),
      contextRemainingPercent: z.number().optional(),
      workDir: z.string().optional(),
    }).optional(),
  }),
  z.object({ ...agentEventBaseSchema, type: z.literal("error"), message: z.string() }),
])

const agentEventScopeSchema = z.object({
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
  repositoryId: z.string().optional(),
}).optional()

const agentStreamDomainEventSchema = z.object({
  domain: z.literal("agent"),
  type: agentEventTypeSchema,
  payload: z.object({
    event: agentEventSchema,
    projectId: z.string(),
    sessionKey: z.string(),
    platform: z.string(),
  }),
  timestamp: z.string(),
  scope: agentEventScopeSchema,
})

const agentConversationUpdatedDomainEventSchema = z.object({
  domain: z.literal("agent"),
  type: z.literal("conversationUpdated"),
  payload: z.object({
    projectId: z.string(),
    sessionKey: z.string(),
    platform: z.string(),
    conversationId: z.string(),
  }),
  timestamp: z.string(),
  scope: agentEventScopeSchema,
})

const sendResultSchema = z.object({
  projectId: z.string(),
  sessionKey: z.string(),
  conversationId: z.string(),
  resultText: z.string(),
  events: z.array(agentEventSchema),
  agentSessionId: z.string().optional(),
  threadId: z.string().optional(),
  error: z.string().optional(),
})

const timelineResultSchema = z.object({
  projectId: z.string(),
  sessionKey: z.string(),
  conversationId: z.string().optional(),
  entries: z.array(timelineEntrySchema),
})

const pendingPermissionSchema = z.object({
  requestId: z.string(),
  projectId: z.string(),
  sessionKey: z.string(),
  conversationId: z.string(),
  toolName: z.string(),
  toolInput: z.string().optional(),
  toolInputRaw: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
})

const respondPermissionResultSchema = z.object({
  ok: z.literal(true),
})

const deleteSessionResultSchema = z.object({
  ok: z.boolean(),
})

const openReferenceResultSchema = z.object({
  ok: z.literal(true),
  path: z.string(),
})

type ProjectRequest = z.infer<typeof projectRequestSchema>
type SessionsRequest = z.infer<typeof sessionsRequestSchema>
type TimelineRequest = z.infer<typeof timelineRequestSchema>
type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>
type SwitchSessionRequest = z.infer<typeof switchSessionRequestSchema>
type DeleteSessionRequest = z.infer<typeof deleteSessionRequestSchema>
type SendRequest = z.infer<typeof sendRequestSchema>
type RespondPermissionRequest = z.infer<typeof respondPermissionRequestSchema>
type OpenReferenceRequest = z.infer<typeof openReferenceRequestSchema>

const DEFAULT_LOCAL_SESSION_KEY = "local:renderer"
const LOCAL_RENDERER_PLATFORM = "local-renderer"

export const agentIpcModule: IpcModule = {
  id: "agent",
  methods: {
    status: {
      kind: "invoke",
      channel: "synapse:agent:status",
      request: projectRequestSchema,
      response: statusSchema,
      handler: async (ctx, request: ProjectRequest) => {
        const { agent, project } = await resolveProjectAgent(ctx.resolve, request.projectId)
        return {
          ...agent.getStatus(),
          projectName: project.name,
        }
      },
    },
    listSessions: {
      kind: "invoke",
      channel: "synapse:agent:list-sessions",
      request: sessionsRequestSchema,
      response: z.array(sessionSummarySchema),
      handler: async (ctx, request: SessionsRequest) => {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const sessions = await agent.listSessions()
        return sessions.map((session) => sessionSummary(session))
      },
    },
    getTimeline: {
      kind: "invoke",
      channel: "synapse:agent:get-timeline",
      request: timelineRequestSchema,
      response: timelineResultSchema,
      handler: async (ctx, request: TimelineRequest) => {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const session = await resolveTimelineSession(agent, request)
        return {
          projectId: request.projectId,
          sessionKey: request.sessionKey ?? session?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY,
          conversationId: session?.id,
          entries: session ? historyEntries(session, request.limit) : [],
        }
      },
    },
    createSession: {
      kind: "invoke",
      channel: "synapse:agent:create-session",
      request: createSessionRequestSchema,
      response: sessionSummarySchema,
      handler: async (ctx, request: CreateSessionRequest) => {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const sessionKey = request.sessionKey?.trim() || DEFAULT_LOCAL_SESSION_KEY
        const session = await agent.createSession({
          sessionKey,
          platform: LOCAL_RENDERER_PLATFORM,
          name: request.name?.trim() || undefined,
        })
        return sessionSummary(session)
      },
    },
    switchSession: {
      kind: "invoke",
      channel: "synapse:agent:switch-session",
      request: switchSessionRequestSchema,
      response: sessionSummarySchema,
      handler: async (ctx, request: SwitchSessionRequest) => {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const sessionKey = request.sessionKey?.trim() || DEFAULT_LOCAL_SESSION_KEY
        const session = await agent.switchSession(
          sessionKey,
          request.conversationId,
          LOCAL_RENDERER_PLATFORM,
        )
        return sessionSummary(session)
      },
    },
    deleteSession: {
      kind: "invoke",
      channel: "synapse:agent:delete-session",
      request: deleteSessionRequestSchema,
      response: deleteSessionResultSchema,
      handler: async (ctx, request: DeleteSessionRequest) => {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        return { ok: await agent.deleteSession(request.conversationId) }
      },
    },
    send: {
      kind: "invoke",
      channel: "synapse:agent:send",
      request: sendRequestSchema,
      response: sendResultSchema,
      handler: async (ctx, request: SendRequest) => {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const sessionKey = request.sessionKey?.trim() || DEFAULT_LOCAL_SESSION_KEY
        const result = await agent.send({
          projectId: request.projectId,
          sessionKey,
          platform: LOCAL_RENDERER_PLATFORM,
          userId: "renderer",
          userName: "Renderer",
          content: request.content,
          replyCtx: {
            kind: LOCAL_RENDERER_PLATFORM,
            projectId: request.projectId,
            sessionKey,
          },
        })
        return {
          projectId: request.projectId,
          sessionKey,
          conversationId: result.conversationId,
          resultText: result.resultText,
          events: result.events as AgentEvent[],
          agentSessionId: result.agentSessionId,
          threadId: result.threadId,
          error: result.error,
        }
      },
    },
    listPendingPermissions: {
      kind: "invoke",
      channel: "synapse:agent:list-pending-permissions",
      request: projectRequestSchema,
      response: z.array(pendingPermissionSchema),
      handler: async (ctx, request: ProjectRequest) => {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        return agent.listPendingPermissions()
      },
    },
    respondPermission: {
      kind: "invoke",
      channel: "synapse:agent:respond-permission",
      request: respondPermissionRequestSchema,
      response: respondPermissionResultSchema,
      handler: async (ctx, request: RespondPermissionRequest) => {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        await agent.respondPermission({
          requestId: request.requestId,
          behavior: request.behavior,
          message: request.message,
          actor: { kind: "user" },
        })
        return { ok: true }
      },
    },
    getProviders: {
      kind: "invoke",
      channel: "synapse:agent:get-providers",
      request: projectRequestSchema,
      response: providerStateSchema,
      handler: async (ctx, request: ProjectRequest) => {
        const { providerConfig } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const agentType = await providerConfig.getActiveAgentType(request.projectId, "codex")
        const state = await providerConfig.getProjectProviderState(request.projectId, agentType)
        return {
          projectId: state.projectId,
          agentType: state.agentType,
          activeProviderId: state.activeProviderId,
          activeModel: state.activeModel,
          activeMode: state.activeMode,
          providers: state.providers.map((provider) => ({
            id: provider.id,
            display: provider.display,
            active: provider.id === state.activeProviderId,
            model: provider.model,
            baseUrl: provider.baseUrl,
            scope: provider.scope,
          })),
        }
      },
    },
    getRuntimeStatus: {
      kind: "invoke",
      channel: "synapse:agent:get-runtime-status",
      request: runtimeStatusRequestSchema,
      response: runtimeStatusSchema,
      handler: async (ctx, request: { projectId?: string }) => {
        const providerConfig = request.projectId
          ? (await resolveProjectAgent(ctx.resolve, request.projectId)).providerConfig
          : undefined
        const agents = await Promise.all(agentRuntimeDefinitions.map(async (definition) => {
          const binary = definition.runtime.binaries[0]
          const path = binary ? await whichBin(binary) : null
          const provider = request.projectId && providerConfig
            ? await providerConfig.getProjectProviderState(request.projectId, definition.id)
            : undefined
          const activeProvider = provider?.activeProvider
          const providerConfigured = Boolean(provider && provider.providers.length > 0)
          const issues: string[] = []
          if (binary && !path) issues.push("cli-not-installed")
          if (request.projectId && !providerConfigured) {
            issues.push("provider-not-configured")
          }
          if (request.projectId && activeProvider && !provider.activeModel) {
            issues.push("model-not-selected")
          }
          return {
            id: definition.id,
            label: definition.label,
            ready: issues.length === 0,
            cli: {
              required: definition.runtime.kind === "local-cli",
              binary,
              installed: path !== null,
              path,
            },
            provider: request.projectId ? {
              projectId: request.projectId,
              configured: providerConfigured,
              activeProviderId: activeProvider?.id,
              activeModel: activeProvider ? provider?.activeModel : undefined,
            } : undefined,
            issues,
          }
        }))
        return {
          projectId: request.projectId,
          agents,
        }
      },
    },
    listCommands: {
      kind: "invoke",
      channel: "synapse:agent:list-commands",
      request: projectRequestSchema,
      response: z.array(publishedCommandSchema),
      handler: async (ctx, request: ProjectRequest) => {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        return agent.listPublishedCommands(LOCAL_RENDERER_PLATFORM)
      },
    },
    openReference: {
      kind: "invoke",
      channel: "synapse:agent:open-reference",
      request: openReferenceRequestSchema,
      response: openReferenceResultSchema,
      handler: async (ctx, request: OpenReferenceRequest) => {
        const { project } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const reference = resolveLocalReference(request.reference, project.localPath)
        if (!reference) throw new Error("Reference is outside the workspace or invalid.")
        const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        const actor = { kind: "user" as const, id: "renderer" }
        const permission = await permissionGuard.check({
          action: "fs.read.outside-userdata",
          actor,
          resource: reference.path,
          context: {
            projectId: request.projectId,
            command: "open-reference",
          },
        })
        if (!permission.allowed) {
          auditSink.record({
            action: "fs.read.outside-userdata",
            actor,
            resource: reference.path,
            outcome: "denied",
            metadata: {
              projectId: request.projectId,
              reason: permission.reason,
              policyId: permission.policyId,
            },
          })
          throw new Error(permission.reason)
        }
        const error = await shell.openPath(reference.path)
        auditSink.record({
          action: "fs.read.outside-userdata",
          actor,
          resource: reference.path,
          outcome: error ? "failed" : "allowed",
          metadata: {
            projectId: request.projectId,
            command: "open-reference",
            line: reference.line,
            error: error || undefined,
          },
        })
        if (error) throw new Error(error)
        return { ok: true, path: reference.path }
      },
    },
  },
  events: {
    event: {
      kind: "event",
      channel: "synapse:events:agent",
      payload: z.discriminatedUnion("type", [
        agentStreamDomainEventSchema,
        agentConversationUpdatedDomainEventSchema,
      ]),
    },
  },
}

async function resolveProjectAgent(
  resolve: <T>(serviceId: string) => T,
  projectId: string,
): Promise<{
  readonly agent: AgentRuntimeService
  readonly providerConfig: ProviderConfigService
  readonly project: { readonly uuid: string; readonly name: string; readonly localPath: string }
}> {
  const config = await configStore.load()
  const project = resolveAgentProjectConfig(config, projectId)
  if (!project) {
    throw new Error("找不到当前项目。")
  }

  const containers = resolve<ProjectContainerRegistry>("core.project-containers")
  const container = await containers.open(project.uuid, {
    name: project.name,
    workspacePath: project.localPath,
  })
  return {
    agent: container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID),
    providerConfig: container.get<ProviderConfigService>(PROVIDER_CONFIG_SERVICE_ID),
    project,
  }
}

function resolveAgentProjectConfig(
  config: Awaited<ReturnType<typeof configStore.load>>,
  projectId: string,
): { readonly uuid: string; readonly name: string; readonly localPath: string } | null {
  const repository = config.repositories.find((item) => item.uuid === projectId)
  if (repository) {
    return repository
  }
  const project = config.global.projects.find((item) => item.id === projectId)
  if (!project) {
    return null
  }
  return {
    uuid: project.id,
    name: project.name,
    localPath: project.path,
  }
}

function sessionSummary(session: ConversationEntryV1) {
  const last = session.history.at(-1)
  return {
    projectId: session.projectId,
    id: session.id,
    sessionKey: session.sessionKey,
    name: session.name,
    platform: session.platform,
    sourceLabel: sessionSourceLabel(session),
    agentType: session.agentType,
    agentSessionId: session.agentSessionId,
    active: session.active,
    historyCount: session.history.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastMessage: last ? historyEntry(session.id, last, session.history.length - 1) : undefined,
  }
}

function sessionSourceLabel(session: ConversationEntryV1): string | undefined {
  const chatName = stringFromRecord(session.userMeta, "chatName")
  const userName = stringFromRecord(session.userMeta, "userName")
  if (chatName && userName) return `${chatName} / ${userName}`
  return chatName ?? userName ?? session.channelKey
}

function stringFromRecord(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const item = value?.[key]
  return typeof item === "string" && item.trim() ? item.trim() : undefined
}

async function resolveTimelineSession(
  agent: AgentRuntimeService,
  request: z.infer<typeof timelineRequestSchema>,
): Promise<ConversationEntryV1 | null> {
  if (request.conversationId) {
    return agent.getSession(request.conversationId)
  }
  const sessions = await agent.listSessions()
  if (request.sessionKey) {
    return sessions.find((session) => session.sessionKey === request.sessionKey && session.active)
      ?? sessions.find((session) => session.sessionKey === request.sessionKey)
      ?? null
  }
  return sessions.find((session) => session.sessionKey === DEFAULT_LOCAL_SESSION_KEY && session.active)
    ?? sessions[0]
    ?? null
}

function historyEntries(
  session: ConversationEntryV1,
  limit?: number,
) {
  const start = typeof limit === "number"
    ? Math.max(0, session.history.length - limit)
    : 0
  return session.history.slice(start).map((entry, index) =>
    historyEntry(session.id, entry, start + index))
}

function historyEntry(
  sessionId: string,
  entry: ConversationEntryV1["history"][number],
  index: number,
) {
  return {
    id: `${sessionId}:history:${index}`,
    role: entry.role,
    content: entry.content,
    timestamp: entry.timestamp,
  }
}
