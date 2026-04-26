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

const sendMessageRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  sessionKey: z.string().optional(),
  message: z.string(),
})

const listCommandsRequestSchema = z.object({
  projectId: z.string(),
})

const commandCatalogItemSchema = z.object({
  id: z.string(),
  command: z.string(),
  aliases: z.array(z.string()),
  title: z.string(),
  description: z.string(),
  group: z.enum(["session", "settings", "info", "advanced"]),
  source: z.enum(["builtin", "custom"]),
  disabled: z.boolean(),
  highRisk: z.boolean(),
  argsMode: z.enum(["none", "text"]),
})

const listCommandsResponseSchema = z.object({
  commands: z.array(commandCatalogItemSchema),
})

const executeCommandRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  sessionKey: z.string().optional(),
  command: z.string(),
  permissionDecision: z.enum(["allow", "deny"]).optional(),
})

const executeCommandResponseSchema = z.object({
  status: z.enum(["completed", "error", "permission_required", "denied"]),
  command: z.string(),
  title: z.string(),
  content: z.string(),
  format: z.enum(["text", "markdown"]),
  error: z.string().nullable(),
  session: sessionDetailSchema.nullable(),
  requiresPermission: z.boolean(),
})

const eventRecordSchema = z.object({
  sessionId: z.string(),
  seq: z.number(),
  type: z.enum([
    "text",
    "thinking",
    "tool_use",
    "tool_result",
    "permission_request",
    "permission_response",
    "result",
    "error",
  ]),
  timestamp: z.string(),
  payload: z.record(z.string(), z.unknown()),
})

const pendingPermissionSchema = z.object({
  requestId: z.string(),
  toolName: z.string(),
  toolInput: z.string(),
  toolInputRaw: z.record(z.string(), z.unknown()),
  questions: z.array(z.object({
    question: z.string(),
    header: z.string(),
    options: z.array(z.object({
      label: z.string(),
      description: z.string(),
    })),
    multiSelect: z.boolean().optional(),
  })),
})

const sendMessageResponseSchema = z.object({
  status: z.enum(["idle", "running", "waiting_permission", "completed", "error", "stopped", "timed_out"]),
  response: z.string(),
  error: z.string().nullable(),
  session: sessionDetailSchema,
  events: z.array(eventRecordSchema),
  pendingPermission: pendingPermissionSchema.nullable(),
})

const respondPermissionRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  requestId: z.string(),
  decision: z.enum(["allow", "deny"]),
  message: z.string().optional(),
})

const respondPermissionResponseSchema = z.object({
  status: z.enum(["accepted", "denied"]),
  event: eventRecordSchema,
  pendingPermission: z.null(),
})

type GetSessionRequest = z.infer<typeof getSessionRequestSchema>
type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>
type SwitchSessionRequest = z.infer<typeof switchSessionRequestSchema>
type ListCommandsRequest = z.infer<typeof listCommandsRequestSchema>
type ExecuteCommandRequest = z.infer<typeof executeCommandRequestSchema>
type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>
type RespondPermissionRequest = z.infer<typeof respondPermissionRequestSchema>

async function config(ctx: IpcHandlerContext) {
  return ctx.resolve<typeof configStore>("core.config").load()
}

async function projects(ctx: IpcHandlerContext) {
  return (await config(ctx)).global.projects
}

async function globalProviders(ctx: IpcHandlerContext) {
  const config = await ctx.resolve<typeof configStore>("core.config").load()
  return config.global.providers
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
    listCommands: {
      kind: "invoke",
      channel: "synapse:agent-sessions:list-commands",
      request: listCommandsRequestSchema,
      response: listCommandsResponseSchema,
      handler: async (ctx, input: ListCommandsRequest) => sessionsService(ctx).listCommands(await projects(ctx), input),
    },
    executeCommand: {
      kind: "invoke",
      channel: "synapse:agent-sessions:execute-command",
      request: executeCommandRequestSchema,
      response: executeCommandResponseSchema,
      handler: async (ctx, input: ExecuteCommandRequest) =>
        sessionsService(ctx).executeCommand(await projects(ctx), input, await globalProviders(ctx)),
    },
    send: {
      kind: "invoke",
      channel: "synapse:agent-sessions:send",
      request: sendMessageRequestSchema,
      response: sendMessageResponseSchema,
      handler: async (ctx, input: SendMessageRequest) => sessionsService(ctx).sendMessage(await projects(ctx), input),
    },
    respondPermission: {
      kind: "invoke",
      channel: "synapse:agent-sessions:respond-permission",
      request: respondPermissionRequestSchema,
      response: respondPermissionResponseSchema,
      handler: async (ctx, input: RespondPermissionRequest) => sessionsService(ctx).respondPermission(await projects(ctx), input),
    },
  },
  events: {},
}
