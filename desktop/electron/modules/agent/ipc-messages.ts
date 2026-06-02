import { randomUUID } from "node:crypto"
import { z } from "zod"

import type { IpcMethodDescriptor } from "../../runtime/ipc/types"
import { projectRequestSchema } from "../../runtime/ipc/schemas"
import type { ConversationEntryV1, DataRepository } from "../../runtime/data-repo"
import type { AgentEvent } from "../../services/agent-runtime"
import type { EventBus } from "../../runtime/event-bus"
import { createMainLogger } from "../../services/log-store"
import {
  DEFAULT_LOCAL_SESSION_KEY,
  LOCAL_RENDERER_PLATFORM,
  timelineRequestSchema,
  timelineItemSchema,
  agentEventSchema,
  permissionModeSchema,
  agentUserQuestionSchema,
  sessionSummary,
  sessionSummarySchema,
  resolveProjectAgent,
  resolveTimelineSession,
  historyEntries,
} from "./ipc-shared"

const MAX_CLIENT_SKEW_MS = 60_000
const logger = createMainLogger("agent.ipc")

function clampClientSubmittedAt(clientIso: string | undefined, recvIso: string): string {
  if (!clientIso) return recvIso
  const recv = Date.parse(recvIso)
  const client = Date.parse(clientIso)
  if (!Number.isFinite(client) || !Number.isFinite(recv)) return recvIso
  if (client > recv) return recvIso
  if (recv - client > MAX_CLIENT_SKEW_MS) return recvIso
  return clientIso
}

// ─── Request schemas ──────────────────────────────────────────────────────────

const sendRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  conversationId: z.string().min(1).optional(),
  content: z.string().min(1),
  clientSubmittedAt: z.string().optional(),
  providerId: z.string().min(1).optional(),
})

const respondPermissionRequestSchema = projectRequestSchema.extend({
  requestId: z.string().min(1),
  behavior: z.enum(["allow", "deny"]),
  updatedInput: z.record(z.string(), z.unknown()).optional(),
  message: z.string().optional(),
})

const setPermissionModeRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
  mode: permissionModeSchema,
})

const cancelTurnRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
})

const cancelTurnResultSchema = z.object({
  status: z.enum(["no-active-turn", "graceful-pending", "hard-killed"]),
})

// ─── Response schemas ─────────────────────────────────────────────────────────

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
  entries: z.array(timelineItemSchema),
})

const pendingPermissionSchema = z.object({
  requestId: z.string(),
  projectId: z.string(),
  sessionKey: z.string(),
  conversationId: z.string(),
  toolName: z.string(),
  toolInput: z.string().optional(),
  toolInputRaw: z.record(z.string(), z.unknown()).optional(),
  questions: z.array(agentUserQuestionSchema).optional(),
  createdAt: z.string(),
})

const respondPermissionResultSchema = z.object({
  ok: z.literal(true),
})

// ─── Types ────────────────────────────────────────────────────────────────────

type ProjectRequest = z.infer<typeof projectRequestSchema>
type SendRequest = z.infer<typeof sendRequestSchema>
type RespondPermissionRequest = z.infer<typeof respondPermissionRequestSchema>
type SetPermissionModeRequest = z.infer<typeof setPermissionModeRequestSchema>

// ─── Message method descriptors ───────────────────────────────────────────────

export const messageMethods: Record<string, IpcMethodDescriptor> = {
  getTimeline: {
    kind: "invoke",
    channel: "synapse:agent:get-timeline",
    request: timelineRequestSchema,
    response: timelineResultSchema,
    handler: async (ctx, request: z.infer<typeof timelineRequestSchema>) => {
      try {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const session = await resolveTimelineSession(agent, request)
        return {
          projectId: request.projectId,
          sessionKey: request.sessionKey ?? session?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY,
          conversationId: session?.id,
          entries: session ? historyEntries(session, request.limit) : [],
        }
      } catch (rawError) {
        logger.warn("Agent timeline runtime lookup failed; trying repository fallback.", {
          projectId: request.projectId,
          sessionKey: request.sessionKey,
          hasConversationId: Boolean(request.conversationId),
          limit: request.limit,
          boundary: "agent.timeline.runtime",
          ...timelineLookupErrorMeta(rawError),
        })
        if (!request.conversationId) throw new Error("找不到当前项目。", { cause: rawError })
        const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
        const conversations = dataRepo.namespace<ConversationEntryV1>("conversations")
        const session = await conversations.get(request.conversationId)
        if (!session || session.projectId !== request.projectId) {
          return {
            projectId: request.projectId,
            sessionKey: request.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY,
            conversationId: request.conversationId,
            entries: [],
          }
        }
        return {
          projectId: request.projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
          entries: historyEntries(session, request.limit),
        }
      }
    },
  },
  send: {
    kind: "invoke",
    channel: "synapse:agent:send",
    request: sendRequestSchema,
    response: sendResultSchema,
    handler: async (ctx, request: SendRequest) => {
      const sessionKey = request.sessionKey?.trim() || DEFAULT_LOCAL_SESSION_KEY
      const eventBus = ctx.resolve<EventBus>("core.event-bus")
      const runId = randomUUID()
      const t_recv = new Date().toISOString()
      const submittedAt = clampClientSubmittedAt(request.clientSubmittedAt, t_recv)

      try {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            sessionKey,
            conversationId: request.conversationId,
            phase: "submitted",
            status: "done",
            startedAt: submittedAt,
            completedAt: t_recv,
          },
          scope: { projectId: request.projectId },
          timestamp: t_recv,
        }, { backpressure: "block" })

        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            sessionKey,
            conversationId: request.conversationId,
            phase: "received",
            status: "in-progress",
            startedAt: t_recv,
          },
          scope: { projectId: request.projectId },
          timestamp: t_recv,
        }, { backpressure: "block" })

        const message = {
          projectId: request.projectId,
          sessionKey,
          platform: LOCAL_RENDERER_PLATFORM,
          userId: "renderer",
          userName: "Renderer",
          content: request.content,
          providerId: request.providerId,
          replyCtx: {
            kind: LOCAL_RENDERER_PLATFORM,
            projectId: request.projectId,
            sessionKey,
          },
        }
        const result = request.conversationId
          ? await agent.sendToConversation(message, request.conversationId)
          : await agent.send(message)
        const t_done = new Date().toISOString()
        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            sessionKey,
            conversationId: result.conversationId,
            phase: "received",
            status: "done",
            startedAt: t_recv,
            completedAt: t_done,
          },
          scope: { projectId: request.projectId },
          timestamp: t_done,
        }, { backpressure: "block" })
        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            sessionKey,
            conversationId: result.conversationId,
            phase: result.error ? "failed" : "completed",
            status: result.error ? "failed" : "done",
            startedAt: t_recv,
            completedAt: t_done,
            errorMessage: result.error,
          },
          scope: { projectId: request.projectId },
          timestamp: t_done,
        }, { backpressure: "block" })
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
      } catch (rawError) {
        const t_fail = new Date().toISOString()
        logger.warn("Agent send IPC failed.", {
          projectId: request.projectId,
          sessionKey,
          conversationId: request.conversationId,
          providerId: request.providerId,
          boundary: "agent.send.ipc",
          ...sendFailureDiagnostic(rawError),
        })
        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            sessionKey,
            conversationId: request.conversationId,
            phase: "failed",
            status: "failed",
            startedAt: t_recv,
            completedAt: t_fail,
            errorMessage: "发送失败",
          },
          scope: { projectId: request.projectId },
          timestamp: t_fail,
        }, { backpressure: "block" })
        throw rawError
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
        updatedInput: request.updatedInput,
        message: request.message,
        actor: { kind: "user" },
      })
      return { ok: true }
    },
  },
  setPermissionMode: {
    kind: "invoke",
    channel: "synapse:agent:set-permission-mode",
    request: setPermissionModeRequestSchema,
    response: sessionSummarySchema,
    handler: async (ctx, request: SetPermissionModeRequest) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      const updated = await agent.setPermissionMode({
        conversationId: request.conversationId,
        mode: request.mode,
        actor: { kind: "user" },
      })
      return sessionSummary(updated)
    },
  },
  cancelTurn: {
    kind: "invoke",
    channel: "synapse:agent:cancel-turn",
    request: cancelTurnRequestSchema,
    response: cancelTurnResultSchema,
    handler: async (ctx, request: z.infer<typeof cancelTurnRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.cancelTurn(request.conversationId)
    },
  },
  forceKillTurn: {
    kind: "invoke",
    channel: "synapse:agent:force-kill-turn",
    request: cancelTurnRequestSchema,
    response: cancelTurnResultSchema,
    handler: async (ctx, request: z.infer<typeof cancelTurnRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.forceKillTurn(request.conversationId)
    },
  },
}

function timelineLookupErrorMeta(rawError: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly errorCode?: string
} {
  const message = rawError instanceof Error ? rawError.message : String(rawError)
  const code = (rawError as { readonly code?: unknown } | null)?.code
  return {
    errorName: rawError instanceof Error ? rawError.name : typeof rawError,
    errorLength: message.length,
    errorCode: typeof code === "string" || typeof code === "number" ? String(code) : undefined,
  }
}

function sendFailureDiagnostic(rawError: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly errorCode?: string
} {
  const message = rawError instanceof Error ? rawError.message : String(rawError)
  const code = (rawError as { readonly code?: unknown } | null)?.code
  return {
    errorName: rawError instanceof Error ? rawError.name : typeof rawError,
    errorLength: message.length,
    errorCode: typeof code === "string" || typeof code === "number" ? String(code) : undefined,
  }
}
