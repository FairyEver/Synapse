import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import type { ConversationEntryV1 } from "../../runtime/data-repo"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
  type AgentEvent,
} from "../../services/agent-runtime"
import {
  ProviderConfigService,
  PROVIDER_CONFIG_SERVICE_ID,
} from "../../services/provider-config"
import { configStore } from "../../services/config-store"

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

const sendRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  content: z.string().min(1),
})

const respondPermissionRequestSchema = projectRequestSchema.extend({
  requestId: z.string().min(1),
  behavior: z.enum(["allow", "deny"]),
  message: z.string().optional(),
})

const timelineEntrySchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  timestamp: z.string(),
})

const sessionSummarySchema = z.object({
  id: z.string(),
  sessionKey: z.string(),
  name: z.string().optional(),
  platform: z.string().optional(),
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

const agentEventBaseSchema = {
  agentSessionId: z.string().optional(),
  threadId: z.string().optional(),
}

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
  }),
  z.object({ ...agentEventBaseSchema, type: z.literal("error"), message: z.string() }),
])

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

type ProjectRequest = z.infer<typeof projectRequestSchema>
type SessionsRequest = z.infer<typeof sessionsRequestSchema>
type TimelineRequest = z.infer<typeof timelineRequestSchema>
type SendRequest = z.infer<typeof sendRequestSchema>
type RespondPermissionRequest = z.infer<typeof respondPermissionRequestSchema>

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
          entries: session ? historyEntries(session, request.limit ?? 100) : [],
        }
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
        const state = await providerConfig.getProjectProviderState(request.projectId, "codex")
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
  },
  events: {
    event: {
      kind: "event",
      channel: "synapse:events:agent",
      payload: z.object({
        domain: z.literal("agent"),
        type: z.string(),
        payload: z.object({
          event: agentEventSchema,
          projectId: z.string(),
          sessionKey: z.string(),
          platform: z.string(),
        }),
        timestamp: z.string(),
        scope: z.object({
          projectId: z.string().optional(),
          sessionId: z.string().optional(),
          repositoryId: z.string().optional(),
        }).optional(),
      }),
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
  const project = config.repositories.find((repository) => repository.uuid === projectId)
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

function sessionSummary(session: ConversationEntryV1) {
  const last = session.history.at(-1)
  return {
    id: session.id,
    sessionKey: session.sessionKey,
    name: session.name,
    platform: session.platform,
    agentType: session.agentType,
    agentSessionId: session.agentSessionId,
    active: session.active,
    historyCount: session.history.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastMessage: last ? historyEntry(session.id, last, session.history.length - 1) : undefined,
  }
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
  limit: number,
) {
  const start = Math.max(0, session.history.length - limit)
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
