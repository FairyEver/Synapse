import { z } from "zod"

import type { IpcMethodDescriptor } from "../../runtime/ipc/types"
import { projectRequestSchema } from "../../runtime/ipc/schemas"
import type { ConversationEntryV1, DataRepository } from "../../runtime/data-repo"
import {
  DEFAULT_LOCAL_SESSION_KEY,
  LOCAL_RENDERER_PLATFORM,
  sessionSummary,
  sessionSummarySchema,
  resolveProjectAgent,
} from "./ipc-shared"

// ─── Request schemas ──────────────────────────────────────────────────────────

const sessionsRequestSchema = projectRequestSchema.extend({
  historyLimit: z.number().int().positive().max(200).optional(),
})

const createSessionRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  name: z.string().optional(),
  agentType: z.string().default("claude-code"),
  providerId: z.string().min(1).optional(),
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ProjectRequest = z.infer<typeof projectRequestSchema>
type SessionsRequest = z.infer<typeof sessionsRequestSchema>
type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>
type SwitchSessionRequest = z.infer<typeof switchSessionRequestSchema>
type DeleteSessionRequest = z.infer<typeof deleteSessionRequestSchema>
type RenameSessionRequest = z.infer<typeof renameSessionRequestSchema>

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
    request: z.object({}),
    response: z.array(sessionSummarySchema),
    handler: async (ctx) => {
      const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
      const conversations = dataRepo.namespace<ConversationEntryV1>("conversations")
      const allSessions = await conversations.list()
      return allSessions
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((session) => sessionSummary(session))
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
      const input = {
        sessionKey,
        platform: LOCAL_RENDERER_PLATFORM,
        name: request.name?.trim() || undefined,
        agentType: request.agentType?.trim() || undefined,
        providerId: request.providerId,
      }
      const session = await agent.createSession(input)
      return sessionSummary(session)
    },
  },
  switchSession: {
    kind: "invoke",
    channel: "synapse:agent:switch-session",
    request: switchSessionRequestSchema,
    response: sessionSummarySchema,
    handler: async (ctx, request: SwitchSessionRequest) => {
      try {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const sessionKey = request.sessionKey?.trim() || DEFAULT_LOCAL_SESSION_KEY
        const session = await agent.switchSession(
          sessionKey,
          request.conversationId,
          LOCAL_RENDERER_PLATFORM,
        )
        return sessionSummary(session)
      } catch {
        const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
        const conversations = dataRepo.namespace<ConversationEntryV1>("conversations")
        const session = await conversations.get(request.conversationId)
        if (!session) throw new Error("会话不存在。")
        return sessionSummary(session)
      }
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
  renameSession: {
    kind: "invoke",
    channel: "synapse:agent:rename-session",
    request: renameSessionRequestSchema,
    response: renameSessionResultSchema,
    handler: async (ctx, request: RenameSessionRequest) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return { ok: await agent.renameSession(request.conversationId, request.name) }
    },
  },
}
