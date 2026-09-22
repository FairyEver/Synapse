import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import { liveConnectionService } from "../../services/live-connection-service-instance"
import { liveDeviceNameSchema, liveDeviceSettingsSchema } from "../../../src/types/live-device-settings"

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
    getDeviceSettings: {
      kind: "invoke",
      operationId: "app.live.device.get_settings",
      request: z.void(),
      response: liveDeviceSettingsSchema,
      handler: async () => liveConnectionService.getDeviceSettings(),
    },
    setDeviceName: {
      kind: "invoke",
      operationId: "app.live.device.set_name",
      request: z.object({ name: liveDeviceNameSchema }),
      response: liveDeviceSettingsSchema,
      handler: async (_ctx, payload: { name: string }) => liveConnectionService.setDeviceName(payload.name),
    },
    getState: {
      kind: "invoke",
      operationId: "app.live.operation.get_state",
      request: z.void(),
      response: liveStateSchema,
      handler: async () => liveConnectionService.getState(),
    },
    retry: {
      kind: "invoke",
      operationId: "app.live.operation.retry",
      request: z.void(),
      response: liveStateSchema,
      handler: async () => liveConnectionService.retryNow(),
    },
  },
  events: {
    stateChanged: {
      kind: "event",
      operationId: "app.live.state.changed",
      payload: liveStateChangedDomainEventSchema,
    },
  },
}
