import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import { AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL } from "../../services/agent-conversation-window-service"
import {
  agentEventTypeSchema,
  agentEventSchema,
  agentEventScopeSchema,
  agentPhaseUpdatePayloadSchema,
} from "./ipc-shared"
import { sessionMethods } from "./ipc-sessions"
import { messageMethods } from "./ipc-messages"
import { toolMethods } from "./ipc-tools"

// ─── Event schemas ────────────────────────────────────────────────────────────

const agentEventEnvelopeSchema = z.object({
  conversationId: z.string().optional(),
  turnId: z.string().optional(),
  providerId: z.string().optional(),
  projectId: z.string().optional(),
})

const agentEventWithEnvelopeSchema = z.intersection(
  agentEventSchema,
  agentEventEnvelopeSchema,
)

const agentStreamDomainEventSchema = z.object({
  domain: z.literal("agent"),
  type: agentEventTypeSchema,
  payload: z.object({
    event: agentEventWithEnvelopeSchema,
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

const agentPhaseUpdateDomainEventSchema = z.object({
  domain: z.literal("agent"),
  type: z.literal("phase.update"),
  payload: agentPhaseUpdatePayloadSchema,
  timestamp: z.string(),
  scope: agentEventScopeSchema,
})

const agentDetachedConversationSchema = z.object({
  projectId: z.string(),
  conversationId: z.string(),
  sessionKey: z.string(),
  title: z.string(),
  windowId: z.number(),
  openedAt: z.string(),
})

// ─── Module assembly ──────────────────────────────────────────────────────────

export const agentIpcModule: IpcModule = {
  id: "agent",
  methods: {
    ...sessionMethods,
    ...messageMethods,
    ...toolMethods,
  },
  events: {
    event: {
      kind: "event",
      channel: "synapse:events:agent",
      payload: z.discriminatedUnion("type", [
        agentStreamDomainEventSchema,
        agentConversationUpdatedDomainEventSchema,
        agentPhaseUpdateDomainEventSchema,
      ]),
    },
    detachedConversationsChanged: {
      kind: "event",
      channel: AGENT_DETACHED_CONVERSATIONS_CHANGED_CHANNEL,
      payload: z.array(agentDetachedConversationSchema),
    },
  },
}
