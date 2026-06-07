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

const driveItemSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  type: z.enum(["file", "folder"]),
  name: z.string(),
  size: z.string(),
  mimeType: z.string().nullable(),
  storageStatus: z.enum(["pending", "active", "delete_pending", "deleted", "failed"]),
  shared: z.boolean(),
  activeShareId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const driveUploadInstructionSchema = z.object({
  method: z.literal("PUT"),
  url: z.string(),
  expiresAt: z.string(),
  headers: z.record(z.string(), z.string()),
})

const driveUploadPrepareResultSchema = z.object({
  sessionId: z.string(),
  item: driveItemSchema,
  upload: driveUploadInstructionSchema,
})

const driveFolderUploadPrepareResultSchema = z.object({
  root: driveItemSchema,
  entries: z.array(z.object({
    relativePath: z.string(),
    sessionId: z.string(),
    item: driveItemSchema,
    upload: driveUploadInstructionSchema,
  })),
})

const driveShareSchema = z.object({
  id: z.string(),
  shareId: z.string(),
  itemId: z.string(),
  enabled: z.boolean(),
  url: z.string(),
  createdAt: z.string(),
})

const driveUsageSchema = z.object({
  usedBytes: z.string(),
  reservedBytes: z.string(),
  quotaBytes: z.string(),
})

const driveParentSchema = z.object({ parentId: z.string().nullable().optional() })
const drivePrepareUploadSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string(),
  size: z.string(),
  mimeType: z.string().nullable().optional(),
})
const drivePrepareFolderUploadSchema = z.object({
  parentId: z.string().nullable().optional(),
  folderName: z.string(),
  files: z.array(z.object({
    relativePath: z.string(),
    size: z.string(),
    mimeType: z.string().nullable().optional(),
  })),
})
const driveSessionSchema = z.object({ sessionId: z.string() })
const drivePreparedFileUploadSchema = z.object({
  method: z.literal("PUT"),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.custom<ArrayBuffer>(isArrayBufferLike, "body must be an ArrayBuffer"),
})
const driveFolderCreateSchema = z.object({ parentId: z.string().nullable().optional(), name: z.string() })
const driveRenameSchema = z.object({ itemId: z.string(), name: z.string() })
const driveMoveSchema = z.object({ itemId: z.string(), parentId: z.string().nullable() })
const driveItemIdSchema = z.object({ itemId: z.string() })
const driveShareIdSchema = z.object({ shareId: z.string() })
const okSchema = z.object({ ok: z.literal(true) })

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

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]"
}

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
    listDriveItems: {
      kind: "invoke",
      channel: "synapse:account:drive:items:list",
      request: driveParentSchema,
      response: z.array(driveItemSchema),
      handler: async (_ctx, input) => {
        const parsed = driveParentSchema.parse(input)
        return accountService.listDriveItems(parsed.parentId ?? null)
      },
    },
    prepareDriveUpload: {
      kind: "invoke",
      channel: "synapse:account:drive:uploads:prepare",
      request: drivePrepareUploadSchema,
      response: driveUploadPrepareResultSchema,
      handler: async (_ctx, input) => accountService.prepareDriveUpload(drivePrepareUploadSchema.parse(input)),
    },
    prepareDriveFolderUpload: {
      kind: "invoke",
      channel: "synapse:account:drive:uploads:folder:prepare",
      request: drivePrepareFolderUploadSchema,
      response: driveFolderUploadPrepareResultSchema,
      handler: async (_ctx, input) => accountService.prepareDriveFolderUpload(drivePrepareFolderUploadSchema.parse(input)),
    },
    completeDriveUpload: {
      kind: "invoke",
      channel: "synapse:account:drive:uploads:complete",
      request: driveSessionSchema,
      response: driveItemSchema,
      handler: async (_ctx, input) => accountService.completeDriveUpload(driveSessionSchema.parse(input).sessionId),
    },
    uploadDrivePreparedFile: {
      kind: "invoke",
      channel: "synapse:account:drive:uploads:put",
      request: drivePreparedFileUploadSchema,
      response: okSchema,
      handler: async (_ctx, input) => accountService.uploadDrivePreparedFile(drivePreparedFileUploadSchema.parse(input)),
    },
    cancelDriveUpload: {
      kind: "invoke",
      channel: "synapse:account:drive:uploads:cancel",
      request: driveSessionSchema,
      response: okSchema,
      handler: async (_ctx, input) => accountService.cancelDriveUpload(driveSessionSchema.parse(input).sessionId),
    },
    createDriveFolder: {
      kind: "invoke",
      channel: "synapse:account:drive:folders:create",
      request: driveFolderCreateSchema,
      response: driveItemSchema,
      handler: async (_ctx, input) => accountService.createDriveFolder(driveFolderCreateSchema.parse(input)),
    },
    renameDriveItem: {
      kind: "invoke",
      channel: "synapse:account:drive:items:rename",
      request: driveRenameSchema,
      response: driveItemSchema,
      handler: async (_ctx, input) => {
        const parsed = driveRenameSchema.parse(input)
        return accountService.renameDriveItem(parsed.itemId, parsed.name)
      },
    },
    moveDriveItem: {
      kind: "invoke",
      channel: "synapse:account:drive:items:move",
      request: driveMoveSchema,
      response: driveItemSchema,
      handler: async (_ctx, input) => {
        const parsed = driveMoveSchema.parse(input)
        return accountService.moveDriveItem(parsed.itemId, parsed.parentId)
      },
    },
    deleteDriveItem: {
      kind: "invoke",
      channel: "synapse:account:drive:items:delete",
      request: driveItemIdSchema,
      response: okSchema,
      handler: async (_ctx, input) => accountService.deleteDriveItem(driveItemIdSchema.parse(input).itemId),
    },
    shareDriveItem: {
      kind: "invoke",
      channel: "synapse:account:drive:items:share",
      request: driveItemIdSchema,
      response: driveShareSchema,
      handler: async (_ctx, input) => accountService.shareDriveItem(driveItemIdSchema.parse(input).itemId),
    },
    disableDriveShare: {
      kind: "invoke",
      channel: "synapse:account:drive:shares:disable",
      request: driveShareIdSchema,
      response: okSchema,
      handler: async (_ctx, input) => accountService.disableDriveShare(driveShareIdSchema.parse(input).shareId),
    },
    getDriveUsage: {
      kind: "invoke",
      channel: "synapse:account:drive:usage:get",
      request: z.void(),
      response: driveUsageSchema,
      handler: async () => accountService.getDriveUsage(),
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
