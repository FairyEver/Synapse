import { z } from "zod"

import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import { accountService } from "../../services/account-service"
import { sanitizeError } from "../../services/error-sanitize"
import {
  DRIVE_LOCAL_UPLOAD_MAX_FILES,
  DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH,
} from "../../../src/lib/drive-local-upload-limits"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"

const accountUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  handle: z.string(),
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
  activeShare: z.object({
    id: z.string(),
    passwordEnabled: z.boolean(),
    expiresAt: z.string().nullable(),
    accessMode: z.enum(["link_read", "link_edit", "specified_users_edit"]),
    editorCount: z.number().int().nonnegative(),
  }).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const driveFileVersionSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  versionNumber: z.number().int().positive(),
  size: z.string(),
  mimeType: z.string().nullable(),
  source: z.enum(["upload", "online_edit", "restore"]),
  isCurrent: z.boolean(),
  isPinned: z.boolean(),
  deletePending: z.boolean(),
  restoredFromVersionId: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
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
  urlWithPassword: z.string(),
  passwordEnabled: z.boolean(),
  password: z.string().nullable(),
  expiresAt: z.string().nullable(),
  accessMode: z.enum(["link_read", "link_edit", "specified_users_edit"]),
  editorEmails: z.array(z.string()),
  createdAt: z.string(),
})

const driveShareListItemSchema = z.object({
  id: z.string(),
  shareId: z.string(),
  itemId: z.string(),
  itemName: z.string(),
  itemType: z.enum(["file", "folder"]),
  sourceDeleted: z.boolean(),
  url: z.string(),
  urlWithPassword: z.string(),
  passwordEnabled: z.boolean(),
  password: z.string().nullable(),
  expiresAt: z.string().nullable(),
  accessMode: z.enum(["link_read", "link_edit", "specified_users_edit"]),
  editorEmails: z.array(z.string()),
  createdAt: z.string(),
})

const drivePublicLinksPageInputSchema = z.object({
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
}).optional()

const drivePageInputSchema = z.object({
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  search: z.string().optional(),
}).strict().optional()

const drivePublicLinksPageSchema = <T extends z.ZodTypeAny>(itemSchema: T) => z.object({
  items: z.array(itemSchema),
  page: z.object({
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
})

const drivePublicAssetSchema = z.object({
  assetId: z.string(),
  itemId: z.string(),
  name: z.string(),
  size: z.string(),
  mimeType: z.string(),
  url: z.string(),
  lifecycleStatus: z.enum(["active", "trashed", "hidden", "legacy_missing"]),
  accessCount: z.string(),
  responseBytes: z.string(),
  lastAccessedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const driveDocumentImageSourceSchema = z.object({
  id: z.string(),
  imageKey: z.string(),
  src: z.string(),
  kind: z.enum(["owner_asset", "collaborator_asset", "external", "relative", "data", "invalid", "unsupported"]),
  occurrenceCount: z.number().int().nonnegative(),
  altText: z.string().optional(),
  previewUrl: z.string().optional(),
  assetId: z.string().optional(),
  assetOwnerId: z.string().optional(),
  assetOwnerName: z.string().optional(),
  canImport: z.boolean(),
  status: z.enum(["ready", "checking", "unreachable", "importing", "imported", "failed"]),
  reason: z.string().optional(),
  importDisabledReason: z.enum(["not_owner", "already_owned", "unreachable", "unsupported", "quota", "too_large"]).optional(),
})

const driveDocumentImageSourcesSchema = z.object({
  itemId: z.string(),
  versionId: z.string().nullable(),
  canImport: z.boolean(),
  sources: z.array(driveDocumentImageSourceSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    ownerAsset: z.number().int().nonnegative(),
    collaboratorAsset: z.number().int().nonnegative(),
    external: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    importable: z.number().int().nonnegative(),
  }),
})

const driveDocumentImageImportResultSchema = z.object({
  itemId: z.string(),
  versionId: z.string(),
  imported: z.array(z.object({
    previousSrc: z.string(),
    nextSrc: z.string(),
    assetId: z.string(),
    size: z.string(),
  })),
  failed: z.array(z.object({
    src: z.string(),
    reason: z.enum(["unreachable", "unsupported", "too_large", "quota", "changed", "unknown"]),
    message: z.string(),
  })),
  summary: z.object({
    importedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    replacedOccurrenceCount: z.number().int().nonnegative(),
  }),
})

const driveSiteSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  name: z.string(),
  status: z.enum(["active", "disabled", "expired", "deleted", "failed"]),
  accessMode: z.enum(["public", "password"]),
  url: z.string(),
  urlWithPassword: z.string(),
  passwordEnabled: z.boolean(),
  password: z.string().nullable(),
  expiresAt: z.string().nullable(),
  sourceFolderItemId: z.string().nullable(),
  sourceFolderName: z.string().nullable(),
  entryPath: z.string().nullable(),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastPublishedAt: z.string().nullable(),
})

const driveSitePreflightResultSchema = z.object({
  sourceFolderItemId: z.string(),
  sourceFolderName: z.string(),
  htmlFiles: z.array(z.string()),
  defaultEntryPath: z.string().nullable(),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.string(),
  includesJavaScript: z.boolean(),
})

const driveSiteListPageSchema = drivePublicLinksPageSchema(driveSiteSchema).extend({
  total: z.number().int().nonnegative(),
})

const driveTrashItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["normal", "public_asset"]),
  name: z.string(),
  type: z.enum(["file", "folder"]),
  size: z.string(),
  mimeType: z.string().nullable(),
  originalPath: z.string().nullable(),
  assetId: z.string().optional(),
  trashedAt: z.string(),
})

const driveFileVersionListPageSchema = z.object({
  items: z.array(driveFileVersionSchema),
  total: z.number().int().nonnegative(),
  page: z.object({
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
})

const driveLinkResolveSchema = z.object({
  url: z.string().url(),
  password: z.string().min(1).max(256).optional(),
}).strict()

const driveLinkListSchema = driveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
}).strict()

const driveLinkReadTextSchema = driveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
  maxBytes: z.number().int().positive().optional(),
}).strict()

const driveLinkMaterializeSchema = driveLinkResolveSchema.extend({
  scope: z.enum(["entry", "text", "all"]).optional(),
  maxFiles: z.number().int().positive().optional(),
  maxBytes: z.number().int().positive().optional(),
}).strict()

const driveLinkDownloadFileSchema = driveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
}).strict()

const driveLinkAccessSchema = z.object({
  status: z.enum(["ok", "password_required", "login_required", "not_found"]),
  canRead: z.boolean(),
  canList: z.boolean(),
  canReadText: z.boolean(),
  canDownload: z.boolean(),
})

const driveLinkRefSchema = z.object({
  kind: z.enum(["share", "site", "public_asset"]),
  shareId: z.string().nullable(),
  itemId: z.string().nullable(),
  siteId: z.string().nullable(),
  path: z.string().nullable(),
  assetId: z.string().nullable(),
})

const driveLinkResolveResponseSchema = z.object({
  ok: z.literal(true),
  linkType: z.enum(["share", "share_item", "site", "site_path", "public_asset"]),
  access: driveLinkAccessSchema,
  root: z.object({
    name: z.string(),
    type: z.enum(["file", "folder", "site", "asset", "protected"]),
    previewKind: z.string(),
  }),
  ref: driveLinkRefSchema,
})

const driveLinkEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(["file", "folder", "site", "asset"]),
  mimeType: z.string().nullable(),
  previewKind: z.string(),
  size: z.string(),
  itemId: z.string().nullable().optional(),
})

const driveLinkListResponseSchema = z.object({
  items: z.array(driveLinkEntrySchema),
  page: z.object({ hasMore: z.boolean(), nextOffset: z.number().int().nonnegative().nullable() }),
})

const driveLinkReadTextResponseSchema = z.object({
  path: z.string(),
  mimeType: z.string().nullable(),
  previewKind: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  source: z.object({ linkType: z.string(), versionId: z.string().nullable().optional() }),
})

const driveLinkMaterializeResponseSchema = z.object({
  localRootPath: z.string(),
  manifestPath: z.string(),
  entryPath: z.string().nullable(),
  files: z.array(z.object({ relativePath: z.string(), kind: z.string(), size: z.string() })),
  skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
  warnings: z.array(z.string()),
})

const driveLinkDownloadFileResponseSchema = z.object({
  localPath: z.string(),
  mimeType: z.string().nullable(),
  size: z.string(),
})

const driveUsageSchema = z.object({
  usedBytes: z.string(),
  reservedBytes: z.string(),
  quotaBytes: z.string(),
})

const driveItemListInputSchema = z.object({
  parentId: z.string().nullable().optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
}).strict().optional()
const driveSiteIdSchema = z.object({ siteId: z.string().min(1) })
const driveSitePreflightSchema = z.object({ sourceFolderItemId: z.string().min(1) })
const driveSiteCreateSchema = z.object({
  sourceFolderItemId: z.string().min(1),
  name: z.string().min(1).max(255),
  entryPath: z.string().min(1).max(1024).nullable().optional(),
  accessMode: z.enum(["public", "password"]),
  password: z.string().min(1).max(256).nullable().optional(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]),
}).strict()
const driveSiteAccessUpdateSchema = driveSiteIdSchema.extend({
  accessMode: z.enum(["public", "password"]),
  password: z.string().min(1).max(256).nullable().optional(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]),
}).strict()
const driveSiteListSchema = z.object({
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  search: z.string().optional(),
  status: z.enum(["active", "disabled", "expired", "deleted", "failed", "all"]).optional(),
}).strict().optional()
const driveSiteRepublishSchema = driveSiteIdSchema.extend({
  entryPath: z.string().min(1).max(1024).nullable().optional(),
}).strict()
const drivePrepareUploadSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string(),
  size: z.string(),
  mimeType: z.string().nullable().optional(),
  expectedItemId: z.string().nullable().optional(),
})
const drivePrepareFolderUploadSchema = z.object({
  parentId: z.string().nullable().optional(),
  folderName: z.string(),
  directories: z.array(z.object({ relativePath: z.string() })).optional(),
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
const drivePublicAssetLocalFileSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().nullable().optional(),
})
const drivePublicAssetUploadSchema = z.object({
  files: z.array(drivePublicAssetLocalFileSchema).min(1).max(DRIVE_LOCAL_UPLOAD_MAX_FILES),
})
const drivePublicAssetBinaryUploadSchema = z.object({
  name: z.string().min(1),
  mimeType: z.string(),
  data: z.custom<ArrayBuffer | ArrayBufferView>(
    isArrayBufferOrViewLike,
    "data must be an ArrayBuffer",
  ).transform(toArrayBufferForIpc),
}).strict()
const driveDocumentImageSourceOwnerContextSchema = z.object({
  kind: z.literal("owner"),
  itemId: z.string().min(1),
}).strict()
const driveDocumentImageSourceShareContextSchema = z.object({
  kind: z.literal("share"),
  shareId: z.string().min(1),
  itemId: z.string().min(1).nullable().optional(),
}).strict()
const driveDocumentImageSourceContextSchema = z.discriminatedUnion("kind", [
  driveDocumentImageSourceOwnerContextSchema,
  driveDocumentImageSourceShareContextSchema,
])
const driveDocumentImageImportSourcesSchema = z.object({
  baseVersionId: z.string().min(1),
  sources: z.array(z.object({ src: z.string().min(1) })),
})
const driveDocumentImageImportSchema = z.discriminatedUnion("kind", [
  driveDocumentImageSourceOwnerContextSchema.extend(driveDocumentImageImportSourcesSchema.shape),
  driveDocumentImageSourceShareContextSchema.extend(driveDocumentImageImportSourcesSchema.shape),
])
const unsafeRelativePathSegmentPattern = /(^|\/)\.\.($|\/)|^\/|^[A-Za-z]:[\\/]/

const driveLocalUploadRelativePathSchema = z.string().min(1).refine(
  (value) => !unsafeRelativePathSegmentPattern.test(value) && !value.includes("\\"),
  "relativePath must be a safe slash-delimited relative path",
).refine(
  (value) => driveLocalUploadRelativePathDepth(value) <= DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH,
  `relativePath folder depth must be at most ${DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH}`,
)

const driveLocalUploadFileItemSchema = z.object({
  kind: z.literal("file"),
  path: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().nullable().optional(),
  expectedItemId: z.string().nullable().optional(),
})

const driveLocalUploadFolderItemSchema = z.object({
  kind: z.literal("folder"),
  folderName: z.string().min(1),
  directories: z.array(z.object({
    relativePath: driveLocalUploadRelativePathSchema,
  })).max(DRIVE_LOCAL_UPLOAD_MAX_FILES).optional(),
  files: z.array(z.object({
    path: z.string().min(1),
    relativePath: driveLocalUploadRelativePathSchema,
    mimeType: z.string().nullable().optional(),
  })).max(DRIVE_LOCAL_UPLOAD_MAX_FILES),
})

const driveLocalUploadRequestSchema = z.object({
  parentId: z.string().nullable().optional(),
  items: z.array(z.discriminatedUnion("kind", [
    driveLocalUploadFileItemSchema,
    driveLocalUploadFolderItemSchema,
  ])).min(1).max(DRIVE_LOCAL_UPLOAD_MAX_FILES),
}).superRefine((request, ctx) => {
  const fileCount = countDriveLocalUploadRequestFiles(request)
  if (fileCount <= DRIVE_LOCAL_UPLOAD_MAX_FILES) return
  ctx.addIssue({
    code: z.ZodIssueCode.too_big,
    maximum: DRIVE_LOCAL_UPLOAD_MAX_FILES,
    origin: "array",
    inclusive: true,
    path: ["items"],
    message: `local drive upload must include at most ${DRIVE_LOCAL_UPLOAD_MAX_FILES} files`,
  })
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
const driveFileVersionListSchema = driveItemIdSchema.extend({
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
})
const driveFileVersionIdSchema = driveItemIdSchema.extend({ versionId: z.string() })
const driveFileVersionDownloadSchema = driveFileVersionIdSchema.extend({ outputPath: z.string() })
const driveFileVersionPinSchema = driveFileVersionIdSchema.extend({ isPinned: z.boolean() })
const drivePreviewUrlSchema = z.object({ url: z.string().url() })
const driveAccessSettingsSchema = z.object({
  passwordEnabled: z.boolean(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]),
  accessMode: z.enum(["link_read", "link_edit", "specified_users_edit"]).optional(),
  editorEmails: z.array(z.string()).optional(),
})
const driveAccessItemSchema = driveItemIdSchema.extend(driveAccessSettingsSchema.shape)
const driveDeleteItemSchema = z.object({ itemId: z.string() })
const driveShareIdSchema = z.object({ shareId: z.string() })
const drivePublicAssetIdSchema = z.object({ assetId: z.string() })
const drivePublicAssetRenameSchema = drivePublicAssetIdSchema.extend({ name: z.string().min(1) })
const drivePublicAssetReplaceSchema = drivePublicAssetIdSchema.extend(drivePublicAssetLocalFileSchema.shape)
const driveTrashItemSchemaInput = z.object({
  itemId: z.string(),
  kind: z.enum(["normal", "public_asset"]).optional(),
  assetId: z.string().optional(),
})
const okSchema = z.object({ ok: z.literal(true) })
const driveFileVersionDeleteResultSchema = okSchema.extend({ deletePending: z.boolean().optional() })

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

function isArrayBufferViewWithArrayBuffer(value: unknown): value is ArrayBufferView & { readonly buffer: ArrayBuffer } {
  return ArrayBuffer.isView(value) && isArrayBufferLike(value.buffer)
}

function isArrayBufferOrViewLike(value: unknown): value is ArrayBuffer | ArrayBufferView {
  return isArrayBufferLike(value) || isArrayBufferViewWithArrayBuffer(value)
}

function toArrayBufferForIpc(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (isArrayBufferLike(value)) return value
  if (isArrayBufferViewWithArrayBuffer(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
  }
  throw new Error("data must be backed by an ArrayBuffer")
}

type DriveLocalUploadRequestForIpc = z.infer<typeof driveLocalUploadRequestSchema>
type DrivePreparedFileUploadRequestForIpc = z.infer<typeof drivePreparedFileUploadSchema>
type DriveFileVersionDownloadRequestForIpc = z.infer<typeof driveFileVersionDownloadSchema>
type DriveLinkMaterializeRequestForIpc = z.infer<typeof driveLinkMaterializeSchema>
type DriveLinkMaterializeResponseForIpc = z.infer<typeof driveLinkMaterializeResponseSchema>
type DrivePublicAssetUploadRequestForIpc = z.infer<typeof drivePublicAssetUploadSchema>
type DrivePublicAssetReplaceRequestForIpc = z.infer<typeof drivePublicAssetReplaceSchema>

function driveLocalUploadRelativePathDepth(relativePath: string): number {
  return Math.max(0, relativePath.split("/").filter(Boolean).length - 1)
}

function countDriveLocalUploadRequestFiles(request: DriveLocalUploadRequestForIpc): number {
  return request.items.reduce((count, item) => (
    item.kind === "file" ? count + 1 : count + item.files.length
  ), 0)
}

function driveLocalUploadPaths(request: DriveLocalUploadRequestForIpc): string[] {
  return request.items.flatMap((item) => (
    item.kind === "file"
      ? [item.path]
      : item.files.map((file) => file.path)
  ))
}

function drivePublicAssetUploadPaths(request: DrivePublicAssetUploadRequestForIpc): string[] {
  return request.files.map((file) => file.path)
}

async function checkAccountPermission(options: {
  ctx: IpcHandlerContext
  action: PermissionAction
  resource: string
  source: string
  context?: Record<string, unknown>
}): Promise<void> {
  const actor = { kind: "user" } as const
  const permissionGuard = options.ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const metadata = { source: options.source, ...options.context }
  const permission = await permissionGuard.check({
    action: options.action,
    actor,
    resource: options.resource,
    context: metadata,
  })
  if (!permission.allowed) {
    auditSink.record({
      action: options.action,
      actor,
      resource: options.resource,
      outcome: "denied",
      metadata: { ...metadata, reason: permission.reason, policyId: permission.policyId },
    })
    throw new Error(permission.reason)
  }
  auditSink.record({
    action: options.action,
    actor,
    resource: options.resource,
    outcome: "allowed",
    metadata,
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

async function runGuardedDrivePreparedUpload<T>(options: {
  ctx: IpcHandlerContext
  request: DrivePreparedFileUploadRequestForIpc
  run(): Promise<T>
}): Promise<T> {
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  const resource = sanitizeUrl(options.request.url)
  await checkAccountPermission({
    ctx: options.ctx,
    action: "network.connect",
    resource,
    source: "account.drivePreparedUpload.put",
  })
  try {
    return await options.run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const safeMessage = sanitizeError(message)
    auditSink.record({
      action: "network.connect",
      actor,
      resource,
      outcome: "failed",
      metadata: {
        source: "account.drivePreparedUpload.put",
        errorName: error instanceof Error ? error.name : typeof error,
        error: safeMessage,
        errorLength: message.length,
      },
    })
    throw new Error(safeMessage)
  }
}

async function runGuardedDrivePublicAssetRead<T>(options: {
  ctx: IpcHandlerContext
  paths: readonly string[]
  source: string
  context?: Record<string, unknown>
  run(): Promise<T>
}): Promise<T> {
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  for (const filePath of options.paths) {
    await checkAccountPermission({
      ctx: options.ctx,
      action: "fs.read.outside-userdata",
      resource: filePath,
      source: options.source,
      context: options.context,
    })
  }
  try {
    return await options.run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    for (const filePath of options.paths) {
      auditSink.record({
        action: "fs.read.outside-userdata",
        actor,
        resource: filePath,
        outcome: "failed",
        metadata: {
          source: options.source,
          ...options.context,
          errorName: error instanceof Error ? error.name : typeof error,
          error: sanitizeError(message),
          errorLength: message.length,
        },
      })
    }
    throw error
  }
}

async function runGuardedDriveFileVersionDownload<T>(options: {
  ctx: IpcHandlerContext
  request: DriveFileVersionDownloadRequestForIpc
  run(): Promise<T>
}): Promise<T> {
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  const metadata = {
    itemId: options.request.itemId,
    versionId: options.request.versionId,
  }
  await checkAccountPermission({
    ctx: options.ctx,
    action: "fs.write",
    resource: options.request.outputPath,
    source: "account.driveFileVersionDownload.write",
    context: metadata,
  })
  try {
    return await options.run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    auditSink.record({
      action: "fs.write",
      actor,
      resource: options.request.outputPath,
      outcome: "failed",
      metadata: {
        source: "account.driveFileVersionDownload.write",
        ...metadata,
        errorName: error instanceof Error ? error.name : typeof error,
        error: sanitizeError(message),
        errorLength: message.length,
      },
    })
    throw error
  }
}

async function runGuardedDriveLinkMaterialize(options: {
  ctx: IpcHandlerContext
  request: DriveLinkMaterializeRequestForIpc
  run(): Promise<DriveLinkMaterializeResponseForIpc>
}): Promise<DriveLinkMaterializeResponseForIpc> {
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  const resource = "synapse-drive:link-intake-cache"
  const metadata = {
    url: sanitizeUrl(options.request.url),
    scope: options.request.scope ?? "text",
  }
  await checkAccountPermission({
    ctx: options.ctx,
    action: "fs.write",
    resource,
    source: "account.driveLinkMaterialize.write",
    context: metadata,
  })
  try {
    const result = await options.run()
    auditSink.record({
      action: "fs.write",
      actor,
      resource: result.localRootPath,
      outcome: "allowed",
      metadata: {
        source: "account.driveLinkMaterialize.write",
        ...metadata,
        manifestPath: result.manifestPath,
        entryPath: result.entryPath,
        fileCount: result.files.length,
        skippedCount: result.skipped.length,
        warningCount: result.warnings.length,
      },
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    auditSink.record({
      action: "fs.write",
      actor,
      resource,
      outcome: "failed",
      metadata: {
        source: "account.driveLinkMaterialize.write",
        ...metadata,
        errorName: error instanceof Error ? error.name : typeof error,
        error: sanitizeError(message),
        errorLength: message.length,
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
      handler: async () => accountService.refreshFromStorage({ reason: "manual" }),
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
      request: driveItemListInputSchema,
      response: drivePublicLinksPageSchema(driveItemSchema),
      handler: async (_ctx, input) => accountService.listDriveItemsPage(driveItemListInputSchema.parse(input) ?? {}),
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
      handler: async (ctx, input) => {
        const request = drivePreparedFileUploadSchema.parse(input)
        return runGuardedDrivePreparedUpload({
          ctx,
          request,
          run: () => accountService.uploadDrivePreparedFile(request),
        })
      },
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
    getDriveItemPreviewUrl: {
      kind: "invoke",
      channel: "synapse:account:drive:items:preview-url",
      request: driveItemIdSchema,
      response: drivePreviewUrlSchema,
      handler: async (_ctx, input) => accountService.getDriveItemPreviewUrl(driveItemIdSchema.parse(input).itemId),
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
        return accountService.deleteDriveItem(parsed.itemId)
      },
    },
    listDriveFileVersions: {
      kind: "invoke",
      channel: "synapse:account:drive:file-versions:list",
      request: driveFileVersionListSchema,
      response: driveFileVersionListPageSchema,
      handler: async (_ctx, input) => {
        const parsed = driveFileVersionListSchema.parse(input)
        return accountService.listDriveFileVersions(parsed.itemId, {
          offset: parsed.offset,
          limit: parsed.limit,
        })
      },
    },
    downloadDriveFileVersion: {
      kind: "invoke",
      channel: "synapse:account:drive:file-versions:download",
      request: driveFileVersionDownloadSchema,
      response: okSchema.extend({ path: z.string() }),
      handler: async (ctx, input) => {
        const parsed = driveFileVersionDownloadSchema.parse(input)
        return runGuardedDriveFileVersionDownload({
          ctx,
          request: parsed,
          run: () => accountService.downloadDriveFileVersion(parsed),
        })
      },
    },
    restoreDriveFileVersion: {
      kind: "invoke",
      channel: "synapse:account:drive:file-versions:restore",
      request: driveFileVersionIdSchema,
      response: driveItemSchema,
      handler: async (_ctx, input) => {
        const parsed = driveFileVersionIdSchema.parse(input)
        return accountService.restoreDriveFileVersion(parsed.itemId, parsed.versionId)
      },
    },
    deleteDriveFileVersion: {
      kind: "invoke",
      channel: "synapse:account:drive:file-versions:delete",
      request: driveFileVersionIdSchema,
      response: driveFileVersionDeleteResultSchema,
      handler: async (_ctx, input) => {
        const parsed = driveFileVersionIdSchema.parse(input)
        return accountService.deleteDriveFileVersion(parsed.itemId, parsed.versionId)
      },
    },
    updateDriveFileVersionPin: {
      kind: "invoke",
      channel: "synapse:account:drive:file-versions:pin",
      request: driveFileVersionPinSchema,
      response: driveFileVersionSchema,
      handler: async (_ctx, input) => {
        const parsed = driveFileVersionPinSchema.parse(input)
        return accountService.updateDriveFileVersionPin(parsed.itemId, parsed.versionId, parsed.isPinned)
      },
    },
    resolveDriveLink: {
      kind: "invoke",
      channel: "synapse:account:drive:links:resolve",
      request: driveLinkResolveSchema,
      response: driveLinkResolveResponseSchema,
      handler: async (_ctx, input) => accountService.resolveDriveLink(driveLinkResolveSchema.parse(input)),
    },
    listDriveLink: {
      kind: "invoke",
      channel: "synapse:account:drive:links:list",
      request: driveLinkListSchema,
      response: driveLinkListResponseSchema,
      handler: async (_ctx, input) => accountService.listDriveLink(driveLinkListSchema.parse(input)),
    },
    readDriveLinkText: {
      kind: "invoke",
      channel: "synapse:account:drive:links:read-text",
      request: driveLinkReadTextSchema,
      response: driveLinkReadTextResponseSchema,
      handler: async (_ctx, input) => accountService.readDriveLinkText(driveLinkReadTextSchema.parse(input)),
    },
    materializeDriveLink: {
      kind: "invoke",
      channel: "synapse:account:drive:links:materialize",
      request: driveLinkMaterializeSchema,
      response: driveLinkMaterializeResponseSchema,
      handler: async (ctx, input) => {
        const parsed = driveLinkMaterializeSchema.parse(input)
        return runGuardedDriveLinkMaterialize({
          ctx,
          request: parsed,
          run: async () => driveLinkMaterializeResponseSchema.parse(await accountService.materializeDriveLink(parsed)),
        })
      },
    },
    downloadDriveLinkFile: {
      kind: "invoke",
      channel: "synapse:account:drive:links:download-file",
      request: driveLinkDownloadFileSchema,
      response: driveLinkDownloadFileResponseSchema,
      handler: async (ctx, input) => {
        const parsed = driveLinkDownloadFileSchema.parse(input)
        if (parsed.outputPath) {
          await checkAccountPermission({
            ctx,
            action: "fs.write",
            resource: parsed.outputPath,
            source: "account.driveLinkDownload.write",
            context: { url: sanitizeUrl(parsed.url) },
          })
        }
        return accountService.downloadDriveLinkFile(parsed)
      },
    },
    shareDriveItem: {
      kind: "invoke",
      channel: "synapse:account:drive:items:share",
      request: driveAccessItemSchema,
      response: driveShareSchema,
      handler: async (_ctx, input) => {
        const parsed = driveAccessItemSchema.parse(input)
        return accountService.shareDriveItem(parsed.itemId, {
          passwordEnabled: parsed.passwordEnabled,
          expiresIn: parsed.expiresIn,
          accessMode: parsed.accessMode,
          editorEmails: parsed.editorEmails,
        })
      },
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
    listDriveShares: {
      kind: "invoke",
      channel: "synapse:account:drive:shares:list",
      request: drivePublicLinksPageInputSchema,
      response: drivePublicLinksPageSchema(driveShareListItemSchema),
      handler: async (_ctx, input) => accountService.listDriveShares(drivePublicLinksPageInputSchema.parse(input)),
    },
    getDriveShare: {
      kind: "invoke",
      channel: "synapse:account:drive:shares:get",
      request: driveShareIdSchema,
      response: driveShareListItemSchema,
      handler: async (_ctx, input) => accountService.getDriveShare(driveShareIdSchema.parse(input).shareId),
    },
    listDrivePublicAssets: {
      kind: "invoke",
      channel: "synapse:account:drive:public-assets:list",
      request: drivePageInputSchema,
      response: drivePublicLinksPageSchema(drivePublicAssetSchema).extend({ total: z.number().int().nonnegative() }),
      handler: async (_ctx, input) => accountService.listDrivePublicAssets(drivePageInputSchema.parse(input)),
    },
    getDrivePublicAsset: {
      kind: "invoke",
      channel: "synapse:account:drive:public-assets:get",
      request: drivePublicAssetIdSchema,
      response: drivePublicAssetSchema,
      handler: async (_ctx, input) => accountService.getDrivePublicAsset(drivePublicAssetIdSchema.parse(input).assetId),
    },
    uploadDrivePublicAssets: {
      kind: "invoke",
      channel: "synapse:account:drive:public-assets:upload",
      request: drivePublicAssetUploadSchema,
      response: z.object({
        results: z.array(z.discriminatedUnion("status", [
          z.object({ status: z.literal("fulfilled"), fileName: z.string(), asset: drivePublicAssetSchema }),
          z.object({ status: z.literal("rejected"), fileName: z.string(), message: z.string() }),
        ])),
      }),
      handler: async (ctx, input) => {
        const request = drivePublicAssetUploadSchema.parse(input)
        return runGuardedDrivePublicAssetRead({
          ctx,
          paths: drivePublicAssetUploadPaths(request),
          source: "account.drivePublicAssetUpload.read",
          run: () => accountService.uploadDrivePublicAssets(request),
        })
      },
    },
    uploadDrivePublicAssetBinary: {
      kind: "invoke",
      channel: "synapse:account:drive:public-assets:upload-binary",
      request: drivePublicAssetBinaryUploadSchema,
      response: drivePublicAssetSchema,
      handler: async (_ctx, input) => accountService.uploadDrivePublicAssetBinary(drivePublicAssetBinaryUploadSchema.parse(input)),
    },
    scanDriveDocumentImageSources: {
      kind: "invoke",
      channel: "synapse:account:drive:document-images:scan",
      request: driveDocumentImageSourceContextSchema,
      response: driveDocumentImageSourcesSchema,
      handler: async (_ctx, input) => accountService.scanDriveDocumentImageSources(driveDocumentImageSourceContextSchema.parse(input)),
    },
    importDriveDocumentImages: {
      kind: "invoke",
      channel: "synapse:account:drive:document-images:import",
      request: driveDocumentImageImportSchema,
      response: driveDocumentImageImportResultSchema,
      handler: async (_ctx, input) => accountService.importDriveDocumentImages(driveDocumentImageImportSchema.parse(input)),
    },
    replaceDrivePublicAssetFile: {
      kind: "invoke",
      channel: "synapse:account:drive:public-assets:replace-file",
      request: drivePublicAssetReplaceSchema,
      response: drivePublicAssetSchema,
      handler: async (ctx, input) => {
        const request: DrivePublicAssetReplaceRequestForIpc = drivePublicAssetReplaceSchema.parse(input)
        return runGuardedDrivePublicAssetRead({
          ctx,
          paths: [request.path],
          source: "account.drivePublicAssetReplace.read",
          context: { assetId: request.assetId },
          run: () => accountService.replaceDrivePublicAssetFile(request),
        })
      },
    },
    renameDrivePublicAsset: {
      kind: "invoke",
      channel: "synapse:account:drive:public-assets:rename",
      request: drivePublicAssetRenameSchema,
      response: drivePublicAssetSchema,
      handler: async (_ctx, input) => {
        const parsed = drivePublicAssetRenameSchema.parse(input)
        return accountService.renameDrivePublicAsset(parsed.assetId, parsed.name)
      },
    },
    trashDrivePublicAsset: {
      kind: "invoke",
      channel: "synapse:account:drive:public-assets:trash",
      request: drivePublicAssetIdSchema,
      response: drivePublicAssetSchema,
      handler: async (_ctx, input) => accountService.trashDrivePublicAsset(drivePublicAssetIdSchema.parse(input).assetId),
    },
    restoreDrivePublicAsset: {
      kind: "invoke",
      channel: "synapse:account:drive:public-assets:restore",
      request: drivePublicAssetIdSchema,
      response: drivePublicAssetSchema,
      handler: async (_ctx, input) => accountService.restoreDrivePublicAsset(drivePublicAssetIdSchema.parse(input).assetId),
    },
    preflightDriveSite: {
      kind: "invoke",
      channel: "synapse:account:drive:sites:preflight",
      request: driveSitePreflightSchema,
      response: driveSitePreflightResultSchema,
      handler: async (_ctx, input) => accountService.preflightDriveSite(driveSitePreflightSchema.parse(input)),
    },
    createDriveSite: {
      kind: "invoke",
      channel: "synapse:account:drive:sites:create",
      request: driveSiteCreateSchema,
      response: driveSiteSchema,
      handler: async (_ctx, input) => accountService.createDriveSite(driveSiteCreateSchema.parse(input)),
    },
    listDriveSites: {
      kind: "invoke",
      channel: "synapse:account:drive:sites:list",
      request: driveSiteListSchema,
      response: driveSiteListPageSchema,
      handler: async (_ctx, input) => accountService.listDriveSites(driveSiteListSchema.parse(input)),
    },
    updateDriveSiteAccess: {
      kind: "invoke",
      channel: "synapse:account:drive:sites:access:update",
      request: driveSiteAccessUpdateSchema,
      response: driveSiteSchema,
      handler: async (_ctx, input) => accountService.updateDriveSiteAccess(driveSiteAccessUpdateSchema.parse(input)),
    },
    disableDriveSite: {
      kind: "invoke",
      channel: "synapse:account:drive:sites:disable",
      request: driveSiteIdSchema,
      response: driveSiteSchema,
      handler: async (_ctx, input) => accountService.disableDriveSite(driveSiteIdSchema.parse(input).siteId),
    },
    enableDriveSite: {
      kind: "invoke",
      channel: "synapse:account:drive:sites:enable",
      request: driveSiteIdSchema,
      response: driveSiteSchema,
      handler: async (_ctx, input) => accountService.enableDriveSite(driveSiteIdSchema.parse(input).siteId),
    },
    deleteDriveSite: {
      kind: "invoke",
      channel: "synapse:account:drive:sites:delete",
      request: driveSiteIdSchema,
      response: okSchema,
      handler: async (_ctx, input) => accountService.deleteDriveSite(driveSiteIdSchema.parse(input).siteId),
    },
    republishDriveSite: {
      kind: "invoke",
      channel: "synapse:account:drive:sites:republish",
      request: driveSiteRepublishSchema,
      response: driveSiteSchema,
      handler: async (_ctx, input) => accountService.republishDriveSite(driveSiteRepublishSchema.parse(input)),
    },
    listDriveTrash: {
      kind: "invoke",
      channel: "synapse:account:drive:trash:list",
      request: drivePageInputSchema,
      response: drivePublicLinksPageSchema(driveTrashItemSchema).extend({ total: z.number().int().nonnegative() }),
      handler: async (_ctx, input) => accountService.listDriveTrash(drivePageInputSchema.parse(input)),
    },
    restoreDriveTrashItem: {
      kind: "invoke",
      channel: "synapse:account:drive:trash:restore",
      request: driveTrashItemSchemaInput,
      response: z.union([driveItemSchema, drivePublicAssetSchema]),
      handler: async (_ctx, input) => accountService.restoreDriveTrashItem(driveTrashItemSchemaInput.parse(input)),
    },
    deleteDriveTrashItem: {
      kind: "invoke",
      channel: "synapse:account:drive:trash:delete",
      request: z.object({ itemId: z.string() }),
      response: okSchema,
      handler: async (_ctx, input) => accountService.deleteDriveTrashItem(z.object({ itemId: z.string() }).parse(input).itemId),
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
