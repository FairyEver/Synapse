import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import {
  agentEventTypeSchema,
  agentEventSchema,
  agentEventScopeSchema,
} from "./ipc-shared"
import { sessionMethods } from "./ipc-sessions"
import { messageMethods } from "./ipc-messages"
import { toolMethods } from "./ipc-tools"

// ─── Event schemas ────────────────────────────────────────────────────────────

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
      ]),
    },
  },
}
