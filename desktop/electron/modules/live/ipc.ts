import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import { liveConnectionService } from "../../services/live-connection-service-instance"

const liveStateSchema = z.object({
  status: z.enum(["connected", "reconnecting", "disconnected", "unauthenticated"]),
  clientInstanceId: z.string().nullable(),
  connectedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  lastError: z.string().nullable(),
})

const liveStateChangedDomainEventSchema = z.object({
  domain: z.literal("live"),
  type: z.literal("live.stateChanged"),
  payload: z.object({ state: liveStateSchema }),
  timestamp: z.string(),
})

export const liveIpcModule: IpcModule = {
  id: "live",
  methods: {
    getState: {
      kind: "invoke",
      channel: "synapse:live:get-state",
      request: z.void(),
      response: liveStateSchema,
      handler: async () => liveConnectionService.getState(),
    },
  },
  events: {
    stateChanged: {
      kind: "event",
      channel: "synapse:events:live",
      payload: liveStateChangedDomainEventSchema,
    },
  },
}
