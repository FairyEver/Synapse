import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { configStore } from "../../services/config-store"
import type { AgentSessionsStoreService } from "../../services/agent-sessions-store-service"

const historyEntrySchema = z.object({
  role: z.string(),
  content: z.string(),
  timestamp: z.string(),
})

const lastMessageSchema = historyEntrySchema.nullable()

const sessionSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  sessionKey: z.string(),
  name: z.string(),
  platform: z.string(),
  agentType: z.string(),
  active: z.boolean(),
  live: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  historyCount: z.number(),
  lastMessage: lastMessageSchema,
  userName: z.string().optional(),
  chatName: z.string().optional(),
})

const sessionDetailSchema = sessionSummarySchema.extend({
  agentSessionId: z.string(),
  history: z.array(historyEntrySchema),
})

const listSessionsResponseSchema = z.object({
  sessions: z.array(sessionSummarySchema),
  activeKeys: z.record(z.string(), z.string()),
})

const getSessionRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  historyLimit: z.number().optional(),
})

const createSessionRequestSchema = z.object({
  projectId: z.string(),
  sessionKey: z.string(),
  name: z.string().optional(),
})

const switchSessionRequestSchema = z.object({
  projectId: z.string(),
  sessionKey: z.string(),
  sessionId: z.string(),
})

type GetSessionRequest = z.infer<typeof getSessionRequestSchema>
type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>
type SwitchSessionRequest = z.infer<typeof switchSessionRequestSchema>

async function projects(ctx: IpcHandlerContext) {
  const config = await ctx.resolve<typeof configStore>("core.config").load()
  return config.global.projects
}

function sessionsService(ctx: IpcHandlerContext): AgentSessionsStoreService {
  return ctx.resolve<AgentSessionsStoreService>("agent.sessions")
}

export const agentSessionsIpcModule: IpcModule = {
  id: "agent-sessions",
  methods: {
    list: {
      kind: "invoke",
      channel: "synapse:agent-sessions:list",
      request: z.void(),
      response: listSessionsResponseSchema,
      handler: async (ctx) => sessionsService(ctx).list(await projects(ctx)),
    },
    getDetail: {
      kind: "invoke",
      channel: "synapse:agent-sessions:get-detail",
      request: getSessionRequestSchema,
      response: sessionDetailSchema,
      handler: async (ctx, input: GetSessionRequest) => sessionsService(ctx).getDetail(await projects(ctx), input),
    },
    create: {
      kind: "invoke",
      channel: "synapse:agent-sessions:create",
      request: createSessionRequestSchema,
      response: sessionDetailSchema,
      handler: async (ctx, input: CreateSessionRequest) => sessionsService(ctx).createSession(await projects(ctx), input),
    },
    switchSession: {
      kind: "invoke",
      channel: "synapse:agent-sessions:switch",
      request: switchSessionRequestSchema,
      response: sessionDetailSchema,
      handler: async (ctx, input: SwitchSessionRequest) => sessionsService(ctx).switchSession(await projects(ctx), input),
    },
  },
  events: {},
}
