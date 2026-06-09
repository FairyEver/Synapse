import { z } from "zod"

import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import { accountService } from "../../services/account-service"
import { sanitizeError } from "../../services/error-sanitize"

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

const drivePublicationSchema = z.object({
  id: z.string(),
  publishId: z.string(),
  type: z.enum(["page", "site"]),
  name: z.string(),
  status: z.enum(["active", "disabled"]),
  sourceItemId: z.string().nullable(),
  sourceDeleted: z.boolean(),
  url: z.string(),
  currentDeploymentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const driveDeleteImpactSchema = z.object({ publications: z.array(drivePublicationSchema) })

const driveShareListItemSchema = z.object({
  id: z.string(),
  shareId: z.string(),
  itemId: z.string(),
  itemName: z.string(),
  itemType: z.enum(["file", "folder"]),
  sourceDeleted: z.boolean(),
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
const unsafeRelativePathSegmentPattern = /(^|\/)\.\.($|\/)|^\/|^[A-Za-z]:[\\/]/

const driveLocalUploadRelativePathSchema = z.string().min(1).refine(
  (value) => !unsafeRelativePathSegmentPattern.test(value) && !value.includes("\\"),
  "relativePath must be a safe slash-delimited relative path",
)

const driveLocalUploadFileItemSchema = z.object({
  kind: z.literal("file"),
  path: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().nullable().optional(),
})

const driveLocalUploadFolderItemSchema = z.object({
  kind: z.literal("folder"),
  folderName: z.string().min(1),
  files: z.array(z.object({
    path: z.string().min(1),
    relativePath: driveLocalUploadRelativePathSchema,
    mimeType: z.string().nullable().optional(),
  })).min(1),
})

const driveLocalUploadRequestSchema = z.object({
  parentId: z.string().nullable().optional(),
  items: z.array(z.discriminatedUnion("kind", [
    driveLocalUploadFileItemSchema,
    driveLocalUploadFolderItemSchema,
  ])).min(1),
})

const driveLocalUploadResultSchema = z.object({
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  message: z.string().optional(),
})
const driveFolderCreateSchema = z.object({ parentId: z.string().nullable().optional(), name: z.string() })
const driveRenameSchema = z.object({ itemId: z.string(), name: z.string() })
const driveMoveSchema = z.object({ itemId: z.string(), parentId: z.string().nullable() })
const driveItemIdSchema = z.object({ itemId: z.string() })
const driveDeleteItemSchema = z.object({ itemId: z.string(), disablePublications: z.boolean().optional() })
const driveShareIdSchema = z.object({ shareId: z.string() })
const drivePublicationIdSchema = z.object({ publicationId: z.string() })
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

type DriveLocalUploadRequestForIpc = z.infer<typeof driveLocalUploadRequestSchema>

function driveLocalUploadPaths(request: DriveLocalUploadRequestForIpc): string[] {
  return request.items.flatMap((item) => (
    item.kind === "file"
      ? [item.path]
      : item.files.map((file) => file.path)
  ))
}

async function checkAccountPermission(options: {
  ctx: IpcHandlerContext
  action: PermissionAction
  resource: string
  source: string
}): Promise<void> {
  const actor = { kind: "user" } as const
  const permissionGuard = options.ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const permission = await permissionGuard.check({
    action: options.action,
    actor,
    resource: options.resource,
    context: { source: options.source },
  })
  if (!permission.allowed) {
    auditSink.record({
      action: options.action,
      actor,
      resource: options.resource,
      outcome: "denied",
      metadata: { source: options.source, reason: permission.reason, policyId: permission.policyId },
    })
    throw new Error(permission.reason)
  }
  auditSink.record({
    action: options.action,
    actor,
    resource: options.resource,
    outcome: "allowed",
    metadata: { source: options.source },
  })
}

async function runGuardedDriveLocalUpload<T>(options: {
  ctx: IpcHandlerContext
  request: DriveLocalUploadRequestForIpc
  run(): Promise<T>
}): Promise<T> {
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  for (const filePath of driveLocalUploadPaths(options.request)) {
    await checkAccountPermission({
      ctx: options.ctx,
      action: "fs.read.outside-userdata",
      resource: filePath,
      source: "account.driveLocalUpload.read",
    })
  }
  await checkAccountPermission({
    ctx: options.ctx,
    action: "fs.write",
    resource: "synapse-drive:local-upload",
    source: "account.driveLocalUpload.write",
  })
  try {
    return await options.run()
  } catch (error) {
    auditSink.record({
      action: "fs.write",
      actor,
      resource: "synapse-drive:local-upload",
      outcome: "failed",
      metadata: {
        source: "account.driveLocalUpload.write",
        errorName: error instanceof Error ? error.name : typeof error,
        error: sanitizeError(String(error)),
        errorLength: String(error).length,
      },
    })
    throw error
  }
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
    uploadDriveLocalItems: {
      kind: "invoke",
      channel: "synapse:account:drive:uploads:local-items",
      request: driveLocalUploadRequestSchema,
      response: driveLocalUploadResultSchema,
      handler: async (ctx, input) => {
        const request = driveLocalUploadRequestSchema.parse(input)
        return runGuardedDriveLocalUpload({
          ctx,
          request,
          run: () => accountService.uploadDriveLocalItems(request),
        })
      },
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
      request: driveDeleteItemSchema,
      response: okSchema,
      handler: async (_ctx, input) => {
        const parsed = driveDeleteItemSchema.parse(input)
        return accountService.deleteDriveItem(parsed.itemId, {
          disablePublications: parsed.disablePublications,
        })
      },
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
    listDrivePublications: {
      kind: "invoke",
      channel: "synapse:account:drive:publications:list",
      request: z.void(),
      response: z.array(drivePublicationSchema),
      handler: async () => accountService.listDrivePublications(),
    },
    publishDrivePage: {
      kind: "invoke",
      channel: "synapse:account:drive:publications:page",
      request: driveItemIdSchema,
      response: drivePublicationSchema,
      handler: async (_ctx, input) => accountService.publishDrivePage(driveItemIdSchema.parse(input).itemId),
    },
    publishDriveSite: {
      kind: "invoke",
      channel: "synapse:account:drive:publications:site",
      request: driveItemIdSchema,
      response: drivePublicationSchema,
      handler: async (_ctx, input) => accountService.publishDriveSite(driveItemIdSchema.parse(input).itemId),
    },
    redeployDrivePublication: {
      kind: "invoke",
      channel: "synapse:account:drive:publications:redeploy",
      request: drivePublicationIdSchema,
      response: drivePublicationSchema,
      handler: async (_ctx, input) => accountService.redeployDrivePublication(
        drivePublicationIdSchema.parse(input).publicationId,
      ),
    },
    disableDrivePublication: {
      kind: "invoke",
      channel: "synapse:account:drive:publications:disable",
      request: drivePublicationIdSchema,
      response: okSchema,
      handler: async (_ctx, input) => accountService.disableDrivePublication(
        drivePublicationIdSchema.parse(input).publicationId,
      ),
    },
    getDriveDeleteImpact: {
      kind: "invoke",
      channel: "synapse:account:drive:items:delete-impact",
      request: driveItemIdSchema,
      response: driveDeleteImpactSchema,
      handler: async (_ctx, input) => accountService.getDriveDeleteImpact(driveItemIdSchema.parse(input).itemId),
    },
    listDriveShares: {
      kind: "invoke",
      channel: "synapse:account:drive:shares:list",
      request: z.void(),
      response: z.array(driveShareListItemSchema),
      handler: async () => accountService.listDriveShares(),
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
