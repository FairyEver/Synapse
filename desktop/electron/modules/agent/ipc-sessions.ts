import { z } from "zod"

import type { IpcMethodDescriptor } from "../../runtime/ipc/types"
import { projectRequestSchema } from "../../runtime/ipc/schemas"
import type { ConversationEntryV1, DataRepository } from "../../runtime/data-repo"
import type { WindowManager } from "../../runtime/window"
import { createMainLogger } from "../../services/log-store"
import { configStore } from "../../services/config-store"
import {
  AGENT_CONVERSATION_WINDOW_SERVICE_ID,
  type AgentConversationWindowService,
} from "../../services/agent-conversation-window-service"
import {
  OPEN_AGENT_SESSION_EVENT,
  type SynapseAgentConversationTarget,
  type SynapseOpenAgentConversationResult,
} from "../../../src/types/agent-navigation"
import {
  DEFAULT_LOCAL_SESSION_KEY,
  LOCAL_RENDERER_PLATFORM,
  permissionModeSchema,
  sessionSummary,
  sessionSummarySchema,
  resolveProjectAgent,
  assertKnowledgeBaseStorageMigrationInactive,
  isRecoverableManagedKnowledgeBaseWorkspaceError,
} from "./ipc-shared"

const logger = createMainLogger("agent.ipc")

// ─── Request schemas ──────────────────────────────────────────────────────────

const sessionsRequestSchema = projectRequestSchema.extend({
  historyLimit: z.number().int().positive().max(200).optional(),
})

const archivedSessionsRequestSchema = z.object({
  excludeProjectIds: z.array(z.string().min(1)).max(500).default([]),
  limit: z.number().int().positive().max(200).default(100),
})

const createSessionRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  name: z.string().optional(),
  agentType: z.string().default("claude-code"),
  providerId: z.string().min(1).optional(),
  mode: permissionModeSchema.optional(),
  modelTier: z.string().optional(),
  personaId: z.string().min(1).nullable().optional(),
})

const switchSessionRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  conversationId: z.string().min(1),
})

const deleteSessionRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
})

const renameSessionRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
  name: z.string().min(1),
})

const openConversationRequestSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1),
  sessionKey: z.string().min(1),
  platform: z.enum(["automation", "workflow", "scheduled"]),
})

const agentConversationTargetSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().min(1),
  sessionKey: z.string().min(1),
})

const openConversationWindowRequestSchema = agentConversationTargetSchema.extend({
  title: z.string().optional(),
})

const replaceConversationWindowTargetRequestSchema = z.object({
  from: agentConversationTargetSchema,
  to: openConversationWindowRequestSchema,
})

// ─── Response schemas ─────────────────────────────────────────────────────────

const statusSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  agentType: z.string(),
  liveSessions: z.number(),
  busySessions: z.number(),
  queuedTurns: z.number(),
  pendingPermissions: z.number(),
})

const deleteSessionResultSchema = z.object({
  ok: z.boolean(),
})

const renameSessionResultSchema = z.object({
  ok: z.boolean(),
})

const openConversationResultSchema = z.discriminatedUnion("opened", [
  z.object({ opened: z.literal(true) }),
  z.object({ opened: z.literal(false), reason: z.literal("not-found") }),
])

const openConversationWindowResultSchema = z.object({
  opened: z.literal(true),
})

const focusConversationWindowResultSchema = z.object({
  focused: z.boolean(),
})

const replaceConversationWindowTargetResultSchema = z.object({
  replaced: z.boolean(),
})

const detachedConversationSchema = agentConversationTargetSchema.extend({
  title: z.string(),
  windowId: z.number(),
  openedAt: z.string(),
})

// ─── Types ────────────────────────────────────────────────────────────────────

type ProjectRequest = z.infer<typeof projectRequestSchema>
type SessionsRequest = z.infer<typeof sessionsRequestSchema>
type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>
type SwitchSessionRequest = z.infer<typeof switchSessionRequestSchema>
type DeleteSessionRequest = z.infer<typeof deleteSessionRequestSchema>
type RenameSessionRequest = z.infer<typeof renameSessionRequestSchema>
type OpenConversationRequest = z.infer<typeof openConversationRequestSchema>
type AgentConversationTargetRequest = z.infer<typeof agentConversationTargetSchema>
type OpenConversationWindowRequest = z.infer<typeof openConversationWindowRequestSchema>
type ReplaceConversationWindowTargetRequest = z.infer<typeof replaceConversationWindowTargetRequestSchema>

function resolveCreateSessionMode(
  requestedMode: CreateSessionRequest["mode"],
  defaultPermissionMode: CreateSessionRequest["mode"],
): CreateSessionRequest["mode"] {
  return requestedMode ?? defaultPermissionMode
}

// ─── Session method descriptors ───────────────────────────────────────────────

export const sessionMethods: Record<string, IpcMethodDescriptor> = {
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
  listAllSessions: {
    kind: "invoke",
    channel: "synapse:agent:list-all-sessions",
    request: archivedSessionsRequestSchema,
    response: z.array(sessionSummarySchema),
    handler: async (ctx, request: z.infer<typeof archivedSessionsRequestSchema>) => {
      const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
      const conversations = dataRepo.namespace<ConversationEntryV1>("conversations")
      if (conversations.listWindow) {
        const sessions = await conversations.listWindow({
          exclude: { projectId: request.excludeProjectIds },
          orderBy: "updatedAt",
          order: "desc",
          limit: request.limit,
          arrayTail: "history",
        })
        return sessions.map(({ value, arrayLength }) => sessionSummary(value, arrayLength))
      }

      const excludedProjectIds = new Set(request.excludeProjectIds)
      return (await conversations.list())
        .filter((session) => !excludedProjectIds.has(session.projectId))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, request.limit)
        .map((session) => sessionSummary(session))
    },
  },
  openConversation: {
    kind: "invoke",
    channel: "synapse:agent:open-conversation",
    request: openConversationRequestSchema,
    response: openConversationResultSchema,
    handler: async (ctx, request: OpenConversationRequest): Promise<SynapseOpenAgentConversationResult> => {
      const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
      const conversations = dataRepo.namespace<ConversationEntryV1>("conversations")
      const conversation = await conversations.get(request.conversationId)
      if (!isRequestedConversation(conversation, request)) {
        logger.warn("Agent conversation open skipped.", {
          projectId: request.projectId,
          conversationId: request.conversationId,
          sessionKey: request.sessionKey,
          platform: request.platform,
          reason: "not-found",
        })
        return { opened: false, reason: "not-found" }
      }

      const windowManager = ctx.resolve<WindowManager>("core.window-manager")
      windowManager.open("main")
      windowManager.broadcast(
        OPEN_AGENT_SESSION_EVENT,
        {
          projectId: request.projectId,
          conversationId: request.conversationId,
          sessionKey: request.sessionKey,
          sourceFilter: request.platform,
        },
        (window) => window.role === "main",
      )
      logger.info("Agent conversation opened.", {
        projectId: request.projectId,
        conversationId: request.conversationId,
        sessionKey: request.sessionKey,
        platform: request.platform,
      })
      return { opened: true }
    },
  },
  openConversationWindow: {
    kind: "invoke",
    channel: "synapse:agent:open-conversation-window",
    request: openConversationWindowRequestSchema,
    response: openConversationWindowResultSchema,
    handler: async (ctx, request: OpenConversationWindowRequest) => {
      const service = ctx.resolve<AgentConversationWindowService>(AGENT_CONVERSATION_WINDOW_SERVICE_ID)
      return service.openConversationWindow(request)
    },
  },
  focusConversationWindow: {
    kind: "invoke",
    channel: "synapse:agent:focus-conversation-window",
    request: agentConversationTargetSchema,
    response: focusConversationWindowResultSchema,
    handler: async (ctx, request: AgentConversationTargetRequest) => {
      const service = ctx.resolve<AgentConversationWindowService>(AGENT_CONVERSATION_WINDOW_SERVICE_ID)
      return service.focusConversationWindow(request)
    },
  },
  replaceConversationWindowTarget: {
    kind: "invoke",
    channel: "synapse:agent:replace-conversation-window-target",
    request: replaceConversationWindowTargetRequestSchema,
    response: replaceConversationWindowTargetResultSchema,
    handler: async (ctx, request: ReplaceConversationWindowTargetRequest) => {
      const service = ctx.resolve<AgentConversationWindowService>(AGENT_CONVERSATION_WINDOW_SERVICE_ID)
      return service.replaceConversationWindowTarget(request)
    },
  },
  listDetachedConversationWindows: {
    kind: "invoke",
    channel: "synapse:agent:list-detached-conversation-windows",
    request: z.object({}),
    response: z.array(detachedConversationSchema),
    handler: async (ctx) => {
      const service = ctx.resolve<AgentConversationWindowService>(AGENT_CONVERSATION_WINDOW_SERVICE_ID)
      return service.listDetachedConversations()
    },
  },
  createSession: {
    kind: "invoke",
    channel: "synapse:agent:create-session",
    request: createSessionRequestSchema,
    response: sessionSummarySchema,
    handler: async (ctx, request: CreateSessionRequest) => {
      const sessionKey = request.sessionKey?.trim() || DEFAULT_LOCAL_SESSION_KEY
      const agentType = request.agentType?.trim() || undefined
      try {
        const config = await configStore.load()
        const mode = resolveCreateSessionMode(request.mode, config.agent?.defaultPermissionMode ?? "default")
        const input = {
          sessionKey,
          platform: LOCAL_RENDERER_PLATFORM,
          name: request.name?.trim() || undefined,
          agentType,
          providerId: request.providerId,
          modelTier: request.modelTier,
          personaId: request.personaId,
          ...(mode ? { mode } : undefined),
        }
        const project = config.global.projects.find((item) => item.id === request.projectId)
        assertKnowledgeBaseStorageMigrationInactive(ctx.resolve, project)
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const session = await agent.createSession(input)
        return sessionSummary(session)
      } catch (rawError) {
        logger.warn("Agent session creation failed.", {
          projectId: request.projectId,
          sessionKey,
          agentType,
          providerId: request.providerId,
          boundary: "agent.ipc.create-session",
          ...errorDiagnostic(rawError),
        })
        if (isRecoverableManagedKnowledgeBaseWorkspaceError(rawError)) {
          throw rawError
        }
        throw new Error("创建 Agent 会话失败。", { cause: rawError })
      }
    },
  },
  switchSession: {
    kind: "invoke",
    channel: "synapse:agent:switch-session",
    request: switchSessionRequestSchema,
    response: sessionSummarySchema,
    handler: async (ctx, request: SwitchSessionRequest) => {
      const sessionKey = request.sessionKey?.trim() || DEFAULT_LOCAL_SESSION_KEY
      try {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const session = await agent.switchSession(
          sessionKey,
          request.conversationId,
        )
        return sessionSummary(session)
      } catch (rawError) {
        const isNotFound = rawError instanceof Error
          && (rawError.message.includes("not available for this session key")
            || rawError.message.includes("不存在"))
        logger.warn("Agent session switch failed.", {
          projectId: request.projectId,
          conversationId: request.conversationId,
          sessionKey,
          boundary: "agent.ipc.switch-session",
          ...errorDiagnostic(rawError),
        })
        throw Object.assign(
          new Error("切换 Agent 会话失败。", { cause: rawError }),
          { code: isNotFound ? "AGENT_SESSION_NOT_FOUND" : undefined },
        )
      }
    },
  },
  deleteSession: {
    kind: "invoke",
    channel: "synapse:agent:delete-session",
    request: deleteSessionRequestSchema,
    response: deleteSessionResultSchema,
    handler: async (ctx, request: DeleteSessionRequest) => {
      try {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const ok = await agent.deleteSession(request.conversationId)
        if (ok) {
          const service = ctx.resolve<AgentConversationWindowService>(AGENT_CONVERSATION_WINDOW_SERVICE_ID)
          service.closeConversationWindow({
            projectId: request.projectId,
            conversationId: request.conversationId,
          })
        }
        return { ok }
      } catch (rawError) {
        if (isProjectMissingError(rawError)) {
          try {
            const ok = await deleteOrphanSession(ctx.resolve, request)
            if (ok) {
              const service = ctx.resolve<AgentConversationWindowService>(AGENT_CONVERSATION_WINDOW_SERVICE_ID)
              service.closeConversationWindow({
                projectId: request.projectId,
                conversationId: request.conversationId,
              })
            }
            return { ok }
          } catch (fallbackError) {
            logger.warn("Agent orphan session deletion failed.", {
              projectId: request.projectId,
              conversationId: request.conversationId,
              boundary: "agent.ipc.delete-orphan-session",
              ...errorDiagnostic(fallbackError),
            })
            throw new Error("删除 Agent 会话失败。", { cause: fallbackError })
          }
        }
        logger.warn("Agent session deletion failed.", {
          projectId: request.projectId,
          conversationId: request.conversationId,
          boundary: "agent.ipc.delete-session",
          ...errorDiagnostic(rawError),
        })
        throw new Error("删除 Agent 会话失败。", { cause: rawError })
      }
    },
  },
  renameSession: {
    kind: "invoke",
    channel: "synapse:agent:rename-session",
    request: renameSessionRequestSchema,
    response: renameSessionResultSchema,
    handler: async (ctx, request: RenameSessionRequest) => {
      try {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const ok = await agent.renameSession(request.conversationId, request.name)
        if (ok) {
          try {
            const service = ctx.resolve<AgentConversationWindowService>(AGENT_CONVERSATION_WINDOW_SERVICE_ID)
            service.renameConversationWindow(request, request.name)
          } catch (windowError) {
            logger.warn("Agent detached conversation title refresh failed.", {
              projectId: request.projectId,
              conversationId: request.conversationId,
              boundary: "agent.ipc.rename-session.detached-window",
              ...errorDiagnostic(windowError),
            })
          }
        }
        return { ok }
      } catch (rawError) {
        logger.warn("Agent session rename failed.", {
          projectId: request.projectId,
          conversationId: request.conversationId,
          boundary: "agent.ipc.rename-session",
          ...errorDiagnostic(rawError),
        })
        throw new Error("重命名 Agent 会话失败。", { cause: rawError })
      }
    },
  },
}

function isRequestedConversation(
  conversation: ConversationEntryV1 | null,
  request: SynapseAgentConversationTarget,
): conversation is ConversationEntryV1 {
  return Boolean(conversation)
    && conversation?.projectId === request.projectId
    && conversation.id === request.conversationId
    && conversation.sessionKey === request.sessionKey
    && conversation.platform === request.platform
}

async function deleteOrphanSession(
  resolve: <T>(serviceId: string) => T,
  request: DeleteSessionRequest,
): Promise<boolean> {
  const dataRepo = resolve<DataRepository>("core.data-repository")
  const conversations = dataRepo.namespace<ConversationEntryV1>("conversations")
  const conversation = await conversations.get(request.conversationId)
  if (!conversation || conversation.projectId !== request.projectId) {
    return false
  }
  await conversations.remove(conversation.id)
  return true
}

function isProjectMissingError(rawError: unknown): boolean {
  return rawError instanceof Error && rawError.message.includes("找不到当前项目")
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
