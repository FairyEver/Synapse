import { z } from "zod"

import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { EventBus } from "../../runtime/event-bus"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import { accountService } from "../../services/account-service"
import { sanitizeError } from "../../services/error-sanitize"
import {
  DRIVE_LOCAL_UPLOAD_MAX_DIRECTORIES,
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

const accountProfileSchema = z.object({
  user: accountUserSchema,
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
  accessMode: z.enum(["public", "password"]).optional(),
  password: z.string().min(1).max(256).nullable().optional(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]).optional(),
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
  })).max(DRIVE_LOCAL_UPLOAD_MAX_DIRECTORIES).optional(),
  files: z.array(z.object({
    path: z.string().min(1),
    relativePath: driveLocalUploadRelativePathSchema,
    mimeType: z.string().nullable().optional(),
  })).max(DRIVE_LOCAL_UPLOAD_MAX_FILES),
})

const driveLocalUploadRequestSchema = z.object({
  taskId: z.string().min(1).optional(),
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
  completedDirectories: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative(),
  failedDirectories: z.number().int().nonnegative().optional(),
  skipped: z.number().int().nonnegative(),
  message: z.string().optional(),
})
const driveLocalUploadProgressEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("item-started"),
    taskId: z.string().min(1),
    itemKey: z.string().min(1),
  }),
  z.object({
    type: z.literal("item-progress"),
    taskId: z.string().min(1),
    itemKey: z.string().min(1),
    uploadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("item-completed"),
    taskId: z.string().min(1),
    itemKey: z.string().min(1),
  }),
  z.object({
    type: z.literal("item-skipped"),
    taskId: z.string().min(1),
    itemKey: z.string().min(1),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("item-failed"),
    taskId: z.string().min(1),
    itemKey: z.string().min(1),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("task-finished"),
    taskId: z.string().min(1),
    result: driveLocalUploadResultSchema,
  }),
])
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
  passwordEnabled: z.boolean().optional(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]).optional(),
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
type DriveLinkDownloadFileRequestForIpc = z.infer<typeof driveLinkDownloadFileSchema>
type DriveLinkDownloadFileResponseForIpc = z.infer<typeof driveLinkDownloadFileResponseSchema>
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

async function runGuardedDriveLinkDownloadCacheWrite(options: {
  ctx: IpcHandlerContext
  request: DriveLinkDownloadFileRequestForIpc
  run(): Promise<DriveLinkDownloadFileResponseForIpc>
}): Promise<DriveLinkDownloadFileResponseForIpc> {
  const auditSink = options.ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  const resource = "synapse-drive:link-intake-cache"
  const metadata = {
    url: sanitizeUrl(options.request.url),
    path: options.request.path ?? null,
    itemId: options.request.itemId ?? null,
  }
  await checkAccountPermission({
    ctx: options.ctx,
    action: "fs.write",
    resource,
    source: "account.driveLinkDownload.write",
    context: metadata,
  })
  try {
    const result = await options.run()
    auditSink.record({
      action: "fs.write",
      actor,
      resource: result.localPath,
      outcome: "allowed",
      metadata: {
        source: "account.driveLinkDownload.write",
        ...metadata,
        localPath: result.localPath,
        mimeType: result.mimeType,
        size: result.size,
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
        source: "account.driveLinkDownload.write",
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
      operationId: "app.account.operation.get_state",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => accountService.getState(),
    },
    startLogin: {
      kind: "invoke",
      operationId: "app.account.operation.start_login",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => (await accountService.startLogin()).state,
    },
    cancelLogin: {
      kind: "invoke",
      operationId: "app.account.operation.cancel_login",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => accountService.cancelLogin(),
    },
    refresh: {
      kind: "invoke",
      operationId: "app.account.operation.refresh",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => accountService.refreshFromStorage({ reason: "manual" }),
    },
    logout: {
      kind: "invoke",
      operationId: "app.account.operation.logout",
      request: z.void(),
      response: accountStateSchema,
      handler: async () => accountService.logout(),
    },
    listWebhooks: {
      kind: "invoke",
      operationId: "app.account.webhooks.list",
      request: z.void(),
      response: z.array(dashboardWebhookSchema),
      handler: async () => accountService.listWebhooks(),
    },
    listDriveItems: {
      kind: "invoke",
      operationId: "app.drive.item.list",
      request: driveItemListInputSchema,
      response: drivePublicLinksPageSchema(driveItemSchema),
      handler: async (_ctx, input) => accountService.listDriveItemsPage(driveItemListInputSchema.parse(input) ?? {}),
    },
    getDriveItem: {
      kind: "invoke",
      operationId: "app.drive.item.get",
      request: driveItemIdSchema,
      response: driveItemSchema,
      handler: async (_ctx, input) => accountService.getDriveItem(driveItemIdSchema.parse(input).itemId),
    },
    prepareDriveUpload: {
      kind: "invoke",
      operationId: "app.drive.upload.prepare",
      request: drivePrepareUploadSchema,
      response: driveUploadPrepareResultSchema,
      handler: async (_ctx, input) => accountService.prepareDriveUpload(drivePrepareUploadSchema.parse(input)),
    },
    prepareDriveFolderUpload: {
      kind: "invoke",
      operationId: "app.drive.upload.folder.prepare",
      request: drivePrepareFolderUploadSchema,
      response: driveFolderUploadPrepareResultSchema,
      handler: async (_ctx, input) => accountService.prepareDriveFolderUpload(drivePrepareFolderUploadSchema.parse(input)),
    },
    completeDriveUpload: {
      kind: "invoke",
      operationId: "app.drive.upload.complete",
      request: driveSessionSchema,
      response: driveItemSchema,
      handler: async (_ctx, input) => accountService.completeDriveUpload(driveSessionSchema.parse(input).sessionId),
    },
    uploadDrivePreparedFile: {
      kind: "invoke",
      operationId: "app.drive.upload.put",
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
      operationId: "app.drive.upload.local_items",
      request: driveLocalUploadRequestSchema,
      response: driveLocalUploadResultSchema,
      handler: async (ctx, input) => {
        const request = driveLocalUploadRequestSchema.parse(input)
        if (!request.taskId) {
          return runGuardedDriveLocalUpload({
            ctx,
            request,
            run: () => accountService.uploadDriveLocalItems(request),
          })
        }
        const taskId = request.taskId
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const emitProgress = (payload: z.infer<typeof driveLocalUploadProgressEventSchema>) => {
          eventBus.emit({
            domain: "account",
            type: "account.driveLocalUploadProgress",
            payload,
            timestamp: new Date().toISOString(),
          }, { backpressure: "block" })
        }
        return runGuardedDriveLocalUpload({
          ctx,
          request,
          run: async () => {
            const result = await accountService.uploadDriveLocalItems(request, { onProgress: emitProgress })
            emitProgress({ type: "task-finished", taskId, result })
            return result
          },
        })
      },
    },
    cancelDriveUpload: {
      kind: "invoke",
      operationId: "app.drive.upload.cancel",
      request: driveSessionSchema,
      response: okSchema,
      handler: async (_ctx, input) => accountService.cancelDriveUpload(driveSessionSchema.parse(input).sessionId),
    },
    createDriveFolder: {
      kind: "invoke",
      operationId: "app.drive.folder.create",
      request: driveFolderCreateSchema,
      response: driveItemSchema,
      handler: async (_ctx, input) => accountService.createDriveFolder(driveFolderCreateSchema.parse(input)),
    },
    getDriveItemPreviewUrl: {
      kind: "invoke",
      operationId: "app.drive.item.preview_url",
      request: driveItemIdSchema,
      response: drivePreviewUrlSchema,
      handler: async (_ctx, input) => accountService.getDriveItemPreviewUrl(driveItemIdSchema.parse(input).itemId),
    },
    renameDriveItem: {
      kind: "invoke",
      operationId: "app.drive.item.rename",
      request: driveRenameSchema,
      response: driveItemSchema,
      handler: async (_ctx, input) => {
        const parsed = driveRenameSchema.parse(input)
        return accountService.renameDriveItem(parsed.itemId, parsed.name)
      },
    },
    moveDriveItem: {
      kind: "invoke",
      operationId: "app.drive.item.move",
      request: driveMoveSchema,
      response: driveItemSchema,
      handler: async (_ctx, input) => {
        const parsed = driveMoveSchema.parse(input)
        return accountService.moveDriveItem(parsed.itemId, parsed.parentId)
      },
    },
    deleteDriveItem: {
      kind: "invoke",
      operationId: "app.drive.item.delete",
      request: driveDeleteItemSchema,
      response: okSchema,
      handler: async (_ctx, input) => {
        const parsed = driveDeleteItemSchema.parse(input)
        return accountService.deleteDriveItem(parsed.itemId)
      },
    },
    listDriveFileVersions: {
      kind: "invoke",
      operationId: "app.drive.file_version.list",
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
      operationId: "app.drive.file_version_download.create",
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
      operationId: "app.drive.file_version.restore",
      request: driveFileVersionIdSchema,
      response: driveItemSchema,
      handler: async (_ctx, input) => {
        const parsed = driveFileVersionIdSchema.parse(input)
        return accountService.restoreDriveFileVersion(parsed.itemId, parsed.versionId)
      },
    },
    deleteDriveFileVersion: {
      kind: "invoke",
      operationId: "app.drive.file_version.delete",
      request: driveFileVersionIdSchema,
      response: driveFileVersionDeleteResultSchema,
      handler: async (_ctx, input) => {
        const parsed = driveFileVersionIdSchema.parse(input)
        return accountService.deleteDriveFileVersion(parsed.itemId, parsed.versionId)
      },
    },
    updateDriveFileVersionPin: {
      kind: "invoke",
      operationId: "app.drive.file_version_pin.update",
      request: driveFileVersionPinSchema,
      response: driveFileVersionSchema,
      handler: async (_ctx, input) => {
        const parsed = driveFileVersionPinSchema.parse(input)
        return accountService.updateDriveFileVersionPin(parsed.itemId, parsed.versionId, parsed.isPinned)
      },
    },
    resolveDriveLink: {
      kind: "invoke",
      operationId: "app.drive.link.resolve",
      request: driveLinkResolveSchema,
      response: driveLinkResolveResponseSchema,
      handler: async (_ctx, input) => accountService.resolveDriveLink(driveLinkResolveSchema.parse(input)),
    },
    listDriveLink: {
      kind: "invoke",
      operationId: "app.drive.link.list",
      request: driveLinkListSchema,
      response: driveLinkListResponseSchema,
      handler: async (_ctx, input) => accountService.listDriveLink(driveLinkListSchema.parse(input)),
    },
    readDriveLinkText: {
      kind: "invoke",
      operationId: "app.drive.link.read_text",
      request: driveLinkReadTextSchema,
      response: driveLinkReadTextResponseSchema,
      handler: async (_ctx, input) => accountService.readDriveLinkText(driveLinkReadTextSchema.parse(input)),
    },
    materializeDriveLink: {
      kind: "invoke",
      operationId: "app.drive.link.materialize",
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
      operationId: "app.drive.link.download_file",
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
        if (!parsed.outputPath) {
          return runGuardedDriveLinkDownloadCacheWrite({
            ctx,
            request: parsed,
            run: async () => driveLinkDownloadFileResponseSchema.parse(await accountService.downloadDriveLinkFile(parsed)),
          })
        }
        return accountService.downloadDriveLinkFile(parsed)
      },
    },
    shareDriveItem: {
      kind: "invoke",
      operationId: "app.drive.share.create",
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
      operationId: "app.drive.share.disable",
      request: driveShareIdSchema,
      response: okSchema,
      handler: async (_ctx, input) => accountService.disableDriveShare(driveShareIdSchema.parse(input).shareId),
    },
    getDriveUsage: {
      kind: "invoke",
      operationId: "app.drive.usage.get",
      request: z.void(),
      response: driveUsageSchema,
      handler: async () => accountService.getDriveUsage(),
    },
    listDriveShares: {
      kind: "invoke",
      operationId: "app.drive.share.list",
      request: drivePublicLinksPageInputSchema,
      response: drivePublicLinksPageSchema(driveShareListItemSchema),
      handler: async (_ctx, input) => accountService.listDriveShares(drivePublicLinksPageInputSchema.parse(input)),
    },
    getDriveShare: {
      kind: "invoke",
      operationId: "app.drive.share.get",
      request: driveShareIdSchema,
      response: driveShareListItemSchema,
      handler: async (_ctx, input) => accountService.getDriveShare(driveShareIdSchema.parse(input).shareId),
    },
    listDrivePublicAssets: {
      kind: "invoke",
      operationId: "app.drive.direct_link.list",
      request: drivePageInputSchema,
      response: drivePublicLinksPageSchema(drivePublicAssetSchema).extend({ total: z.number().int().nonnegative() }),
      handler: async (_ctx, input) => accountService.listDrivePublicAssets(drivePageInputSchema.parse(input)),
    },
    getDrivePublicAsset: {
      kind: "invoke",
      operationId: "app.drive.direct_link.get",
      request: drivePublicAssetIdSchema,
      response: drivePublicAssetSchema,
      handler: async (_ctx, input) => accountService.getDrivePublicAsset(drivePublicAssetIdSchema.parse(input).assetId),
    },
    uploadDrivePublicAssets: {
      kind: "invoke",
      operationId: "app.drive.direct_link.upload",
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
      operationId: "app.drive.direct_link.upload_binary",
      request: drivePublicAssetBinaryUploadSchema,
      response: drivePublicAssetSchema,
      handler: async (_ctx, input) => accountService.uploadDrivePublicAssetBinary(drivePublicAssetBinaryUploadSchema.parse(input)),
    },
    scanDriveDocumentImageSources: {
      kind: "invoke",
      operationId: "app.drive.document_images.scan",
      request: driveDocumentImageSourceContextSchema,
      response: driveDocumentImageSourcesSchema,
      handler: async (_ctx, input) => accountService.scanDriveDocumentImageSources(driveDocumentImageSourceContextSchema.parse(input)),
    },
    importDriveDocumentImages: {
      kind: "invoke",
      operationId: "app.drive.document_images.import",
      request: driveDocumentImageImportSchema,
      response: driveDocumentImageImportResultSchema,
      handler: async (_ctx, input) => accountService.importDriveDocumentImages(driveDocumentImageImportSchema.parse(input)),
    },
    replaceDrivePublicAssetFile: {
      kind: "invoke",
      operationId: "app.drive.direct_link.update",
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
      operationId: "app.drive.direct_link.rename",
      request: drivePublicAssetRenameSchema,
      response: drivePublicAssetSchema,
      handler: async (_ctx, input) => {
        const parsed = drivePublicAssetRenameSchema.parse(input)
        return accountService.renameDrivePublicAsset(parsed.assetId, parsed.name)
      },
    },
    trashDrivePublicAsset: {
      kind: "invoke",
      operationId: "app.drive.direct_link.delete",
      request: drivePublicAssetIdSchema,
      response: drivePublicAssetSchema,
      handler: async (_ctx, input) => accountService.trashDrivePublicAsset(drivePublicAssetIdSchema.parse(input).assetId),
    },
    restoreDrivePublicAsset: {
      kind: "invoke",
      operationId: "app.drive.direct_link.restore",
      request: drivePublicAssetIdSchema,
      response: drivePublicAssetSchema,
      handler: async (_ctx, input) => accountService.restoreDrivePublicAsset(drivePublicAssetIdSchema.parse(input).assetId),
    },
    preflightDriveSite: {
      kind: "invoke",
      operationId: "app.drive.site.preflight",
      request: driveSitePreflightSchema,
      response: driveSitePreflightResultSchema,
      handler: async (_ctx, input) => accountService.preflightDriveSite(driveSitePreflightSchema.parse(input)),
    },
    createDriveSite: {
      kind: "invoke",
      operationId: "app.drive.site.create",
      request: driveSiteCreateSchema,
      response: driveSiteSchema,
      handler: async (_ctx, input) => accountService.createDriveSite(driveSiteCreateSchema.parse(input)),
    },
    listDriveSites: {
      kind: "invoke",
      operationId: "app.drive.site.list",
      request: driveSiteListSchema,
      response: driveSiteListPageSchema,
      handler: async (_ctx, input) => accountService.listDriveSites(driveSiteListSchema.parse(input)),
    },
    updateDriveSiteAccess: {
      kind: "invoke",
      operationId: "app.drive.site.update_access",
      request: driveSiteAccessUpdateSchema,
      response: driveSiteSchema,
      handler: async (_ctx, input) => accountService.updateDriveSiteAccess(driveSiteAccessUpdateSchema.parse(input)),
    },
    disableDriveSite: {
      kind: "invoke",
      operationId: "app.drive.site.disable",
      request: driveSiteIdSchema,
      response: driveSiteSchema,
      handler: async (_ctx, input) => accountService.disableDriveSite(driveSiteIdSchema.parse(input).siteId),
    },
    enableDriveSite: {
      kind: "invoke",
      operationId: "app.drive.site.enable",
      request: driveSiteIdSchema,
      response: driveSiteSchema,
      handler: async (_ctx, input) => accountService.enableDriveSite(driveSiteIdSchema.parse(input).siteId),
    },
    deleteDriveSite: {
      kind: "invoke",
      operationId: "app.drive.site.delete",
      request: driveSiteIdSchema,
      response: okSchema,
      handler: async (_ctx, input) => accountService.deleteDriveSite(driveSiteIdSchema.parse(input).siteId),
    },
    republishDriveSite: {
      kind: "invoke",
      operationId: "app.drive.site.republish",
      request: driveSiteRepublishSchema,
      response: driveSiteSchema,
      handler: async (_ctx, input) => accountService.republishDriveSite(driveSiteRepublishSchema.parse(input)),
    },
    listDriveTrash: {
      kind: "invoke",
      operationId: "app.drive.trash.list",
      request: drivePageInputSchema,
      response: drivePublicLinksPageSchema(driveTrashItemSchema).extend({ total: z.number().int().nonnegative() }),
      handler: async (_ctx, input) => accountService.listDriveTrash(drivePageInputSchema.parse(input)),
    },
    restoreDriveTrashItem: {
      kind: "invoke",
      operationId: "app.drive.trash.restore",
      request: driveTrashItemSchemaInput,
      response: z.union([driveItemSchema, drivePublicAssetSchema]),
      handler: async (_ctx, input) => accountService.restoreDriveTrashItem(driveTrashItemSchemaInput.parse(input)),
    },
    deleteDriveTrashItem: {
      kind: "invoke",
      operationId: "app.drive.trash.delete",
      request: z.object({ itemId: z.string() }),
      response: okSchema,
      handler: async (_ctx, input) => accountService.deleteDriveTrashItem(z.object({ itemId: z.string() }).parse(input).itemId),
    },
  },
  events: {
    stateChanged: {
      kind: "event",
      operationId: "app.account.state.changed",
      payload: accountStateChangedDomainEventSchema,
    },
    driveLocalUploadProgress: {
      kind: "event",
      operationId: "app.account.state.changed",
      payload: z.object({
        domain: z.literal("account"),
        type: z.literal("account.driveLocalUploadProgress"),
        payload: driveLocalUploadProgressEventSchema,
        timestamp: z.string(),
      }),
    },
  },
}
