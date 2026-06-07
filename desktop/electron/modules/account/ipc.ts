import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import { accountService } from "../../services/account-service"

const accountUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
})

const accountTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  membershipId: z.string(),
  membershipRole: z.enum(["owner", "member"]),
})

const accountProfileSchema = z.object({
  user: accountUserSchema,
  teams: z.array(accountTeamSchema),
  syncedAt: z.string(),
})

const accountOfflineReasonSchema = z.enum([
  "network_error",
  "server_unavailable",
  "profile_sync_failed",
])

const accountRetryStateSchema = z.object({
  attempt: z.number().int().nonnegative(),
  nextRetryAt: z.string().optional(),
})

const dashboardWebhookSchema = z.object({
  id: z.string(),
  publicId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  url: z.string().nullable(),
  maskedUrl: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastDeliveryAt: z.string().optional(),
  lastDeliveryStatus: z.enum([
    "received",
    "no_online_clients",
    "sent",
    "delivered",
    "rejected",
    "broadcast_failed",
  ]).optional(),
})

const accountStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unauthenticated") }),
  z.object({ status: z.literal("authenticating"), loginUrl: z.string().optional() }),
  z.object({
    status: z.literal("authenticated"),
    connectivity: z.enum(["online", "offline"]),
    profile: accountProfileSchema,
    offlineReason: accountOfflineReasonSchema.optional(),
    retry: accountRetryStateSchema.optional(),
  }),
  z.object({ status: z.literal("error"), message: z.string(), profile: accountProfileSchema.optional() }),
])

const accountStateChangedDomainEventSchema = z.object({
  domain: z.literal("account"),
  type: z.literal("account.stateChanged"),
  payload: z.object({ state: accountStateSchema }),
  timestamp: z.string(),
})

export const accountIpcModule: IpcModule = {
  id: "account",
  methods: {
    getState: {
      kind: "invoke",
      channel: "synapse:account:get-state",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => accountService.getState(),
    },
    startLogin: {
      kind: "invoke",
      channel: "synapse:account:start-login",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => (await accountService.startLogin()).state,
    },
    refresh: {
      kind: "invoke",
      channel: "synapse:account:refresh",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => accountService.refreshFromStorage(),
    },
    logout: {
      kind: "invoke",
      channel: "synapse:account:logout",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => accountService.logout(),
    },
    listWebhooks: {
      kind: "invoke",
      channel: "synapse:account:webhooks:list",
      request: z.void(),
      response: z.array(dashboardWebhookSchema),
      handler: async () => accountService.listWebhooks(),
    },
  },
  events: {
    stateChanged: {
      kind: "event",
      channel: "synapse:events:account",
      payload: accountStateChangedDomainEventSchema,
    },
  },
}
