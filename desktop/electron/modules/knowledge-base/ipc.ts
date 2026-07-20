import { BrowserWindow, dialog } from "electron"
import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import { createMainLogger } from "../../services/log-store"
import type { KnowledgeBaseService } from "../../services/knowledge-base"
import type { KnowledgeBaseStorageMigrationService } from "../../services/knowledge-base/storage-migration-service"
import { knowledgeBaseSourceManagerWindowService } from "../../services/knowledge-base/source-manager-window-service"
import { createGuardedFetchUrl } from "../../services/source-acquisition/guarded-fetch-url"
import { validateUrlSourceCandidate, type FetchUrl } from "../../services/source-acquisition/url-source"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"
import { sanitizeError } from "../../services/error-sanitize"
import { KNOWLEDGE_BASE_RAW_EXPORT_MAX_ENTRIES } from "../../../config"

const logger = createMainLogger("knowledge-base.ipc")
const KNOWLEDGE_BASE_RESOURCE_PREFIX = "managed-knowledge-base:"

const createManagedPayloadSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
})

const createManagedResultSchema = z.object({
  projectId: z.string(),
  projectPath: z.string(),
  templateVersion: z.string(),
  templateSource: z.object({
    repo: z.string().optional(),
    commit: z.string().optional(),
    syncedAt: z.string().optional(),
  }).optional(),
})

const deleteManagedPayloadSchema = z.object({
  projectId: z.string().min(1),
  runtimeId: z.string().min(1).optional(),
})

const deleteManagedResultSchema = z.object({
  projectId: z.string(),
  deleted: z.boolean(),
})

const rawEntrySchema = z.object({
  name: z.string(),
  relativePath: z.string(),
  kind: z.enum(["file", "directory"]),
  size: z.number().nullable(),
  modifiedAt: z.string(),
})

const listRawDirectoryPayloadSchema = z.object({
  projectId: z.string().min(1),
  directoryPath: z.string(),
  entryKind: z.enum(["all", "directory"]).optional(),
  query: z.string().optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional(),
})

const listRawDirectoryResultSchema = z.object({
  projectId: z.string(),
  directoryPath: z.string(),
  entries: z.array(rawEntrySchema),
  totalCount: z.number().int().min(0).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  hasMore: z.boolean().optional(),
})

const uploadRawFilesPayloadSchema = z.object({
  projectId: z.string().min(1),
  targetDirectoryPath: z.string(),
  filePaths: z.array(z.string().min(1)),
})

const uploadRawItemsPayloadSchema = z.object({
  projectId: z.string().min(1),
  targetDirectoryPath: z.string(),
  itemPaths: z.array(z.string().min(1)),
})

const selectAndUploadRawDirectoryPayloadSchema = z.object({
  projectId: z.string().min(1),
  targetDirectoryPath: z.string(),
})

const createRawFolderPayloadSchema = z.object({
  projectId: z.string().min(1),
  parentDirectoryPath: z.string(),
  name: z.string().min(1),
})

const renameRawEntryPayloadSchema = z.object({
  projectId: z.string().min(1),
  relativePath: z.string().min(1),
  newName: z.string().min(1),
})

const moveRawEntriesPayloadSchema = z.object({
  projectId: z.string().min(1),
  relativePaths: z.array(z.string().min(1)),
  targetDirectoryPath: z.string(),
})

const trashRawEntriesPayloadSchema = z.object({
  projectId: z.string().min(1),
  relativePaths: z.array(z.string().min(1)),
})

const exportRawEntriesPayloadSchema = z.object({
  projectId: z.string().min(1),
  relativePaths: z.array(z.string().min(1)).min(1).max(KNOWLEDGE_BASE_RAW_EXPORT_MAX_ENTRIES),
})

const addUrlSourcePayloadSchema = z.object({
  projectId: z.string().min(1),
  targetDirectoryPath: z.string().optional(),
  url: z.string().min(1),
})

const uploadSourcesResultSchema = z.object({
  projectId: z.string(),
  uploaded: z.array(z.object({
    originalPath: z.string(),
    relativePath: z.string(),
    name: z.string(),
    size: z.number(),
    sourceKind: z.enum(["file", "url"]).optional(),
    sourceUrl: z.string().optional(),
    originalRelativePath: z.string().optional(),
  })),
  skipped: z.array(z.object({
    path: z.string(),
    reason: z.enum([
      "not-file",
      "read-error",
      "unsupported",
      "invalid_url",
      "unsupported_protocol",
      "url_credentials",
      "local_or_private_host",
      "http_error",
      "unsupported_content_type",
      "size_limit_exceeded",
      "network_error",
    ]),
  })),
})

const rawMutationResultSchema = z.object({
  projectId: z.string(),
  entries: z.array(rawEntrySchema),
  skipped: z.array(z.object({
    path: z.string(),
    reason: z.enum([
      "not-file",
      "not-directory",
      "read-error",
      "invalid-path",
      "invalid-name",
      "collision",
      "trash-error",
      "symlink",
      "system-noise",
      "export-error",
      "too-many-files",
      "too-large",
      "too-deep",
      "file-too-large",
    ]),
  })),
})

const openSourceManagerPayloadSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
})

const storageTargetSchema = z.union([
  z.object({ mode: z.literal("default") }),
  z.object({ mode: z.literal("custom"), rootPath: z.string().min(1) }),
])

const storageMigrationPayloadSchema = z.object({
  target: storageTargetSchema,
})

const storageStatusSchema = z.object({
  mode: z.enum(["default", "custom"]),
  rootPath: z.string(),
  knowledgeBasesPath: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  oldAbsoluteReferenceCount: z.number().optional(),
})

const storageMigrationResultSchema = z.union([
  z.object({ status: z.literal("completed") }),
  z.object({
    status: z.literal("completed-with-warning"),
    warningCode: z.literal("old-copy-not-trashed"),
  }),
  z.object({ status: z.literal("cancelled") }),
])

const storageMigrationProgressSchema = z.object({
  active: z.boolean(),
  phase: z.enum([
    "idle",
    "preparing",
    "copying",
    "verifying",
    "switching",
    "cleaning",
    "completed",
    "completed-with-warning",
    "failed",
    "cancelled",
    "recovering",
  ]),
  cancellable: z.boolean(),
  copiedBytes: z.number(),
  totalBytes: z.number().nullable(),
  message: z.string(),
  warningCode: z.enum(["free-space-unknown", "old-copy-not-trashed"]).optional(),
  errorMessage: z.string().optional(),
})

function service(ctx: IpcHandlerContext): KnowledgeBaseService {
  return ctx.resolve<KnowledgeBaseService>("knowledge-base.service")
}

function migrationService(ctx: IpcHandlerContext): KnowledgeBaseStorageMigrationService {
  return ctx.resolve<KnowledgeBaseStorageMigrationService>("knowledge-base.storage-migration-service")
}

function assertStorageMigrationInactive(ctx: IpcHandlerContext): void {
  if (migrationService(ctx).isActive()) {
    throw new Error("知识库存储迁移正在进行，请稍后再试。")
  }
}

async function assertKnowledgeBaseStorageAvailable(ctx: IpcHandlerContext): Promise<void> {
  const status = await migrationService(ctx).getStorageStatus()
  if (status.available) return
  throw new Error("知识库存储位置不可用。请在设置中重新检测。")
}

function trackRawMutation<T>(run: () => Promise<T>): Promise<T> {
  return knowledgeBaseSourceManagerWindowService.trackMutation(run)
}

function ipcErrorMeta(error: unknown): Record<string, unknown> {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: String(error).length,
  }
}

function permissionLogMeta(options: {
  action: PermissionAction
  resource: string
  source: string
}): Record<string, unknown> {
  const projectId = options.resource.startsWith(KNOWLEDGE_BASE_RESOURCE_PREFIX)
    ? options.resource.slice(KNOWLEDGE_BASE_RESOURCE_PREFIX.length)
    : null
  return {
    boundary: "knowledge-base.ipc.operation",
    action: options.action,
    source: options.source,
    resourceKind: projectId ? "managed-knowledge-base" : "external-resource",
    resourceLength: options.resource.length,
    ...(projectId ? { projectId } : {}),
  }
}

function rawMutationAuditMetadata(options: {
  rawNewName?: string
  rawRelativePaths?: readonly string[]
  rawTargetDirectoryPath?: string
}): Record<string, unknown> {
  return {
    ...(options.rawNewName ? { rawNewName: options.rawNewName } : {}),
    ...(options.rawRelativePaths && options.rawRelativePaths.length > 0 ? { rawRelativePaths: options.rawRelativePaths.slice(0, 25) } : {}),
    ...(options.rawRelativePaths && options.rawRelativePaths.length > 25 ? { rawRelativePathsOmittedCount: options.rawRelativePaths.length - 25 } : {}),
    ...(options.rawTargetDirectoryPath !== undefined ? { rawTargetDirectoryPath: options.rawTargetDirectoryPath } : {}),
  }
}

function focusedWindow(): Electron.BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow()
    ?? BrowserWindow.getAllWindows().find((window) => window.isVisible() && !window.isDestroyed())
    ?? undefined
}

async function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  const parentWindow = focusedWindow()
  return parentWindow
    ? dialog.showOpenDialog(parentWindow, options)
    : dialog.showOpenDialog(options)
}

async function runGuardedKnowledgeBaseOperation<T>(options: {
  ctx: IpcHandlerContext
  action: PermissionAction
  resource: string
  source: string
  auditMetadata?: Record<string, unknown>
  run(): Promise<T>
}): Promise<T> {
  const startedAt = Date.now()
  const logMeta = permissionLogMeta(options)
  logger.info("Knowledge Base IPC request.", logMeta)
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
    logger.warn("Knowledge Base IPC permission denied.", {
      ...logMeta,
      durationMs: Date.now() - startedAt,
      reasonLength: permission.reason.length,
      policyId: permission.policyId,
    })
    throw new Error(permission.reason)
  }
  try {
    const result = await options.run()
    auditSink.record({
      action: options.action,
      actor,
      resource: options.resource,
      outcome: "allowed",
      metadata: { source: options.source, ...(options.auditMetadata ?? {}) },
    })
    logger.info("Knowledge Base IPC completed.", {
      ...logMeta,
      ...(options.auditMetadata ?? {}),
      durationMs: Date.now() - startedAt,
    })
    return result
  } catch (error) {
    auditSink.record({
      action: options.action,
      actor,
      resource: options.resource,
      outcome: "failed",
      metadata: {
        source: options.source,
        errorName: error instanceof Error ? error.name : typeof error,
        error: sanitizeError(String(error)),
        errorLength: String(error).length,
      },
    })
    logger.warn("Knowledge Base IPC failed.", {
      ...logMeta,
      durationMs: Date.now() - startedAt,
      ...ipcErrorMeta(error),
    })
    throw error
  }
}

async function runGuardedStorageMigration(
  ctx: IpcHandlerContext,
  request: { target: { mode: "default" } | { mode: "custom"; rootPath: string } },
) {
  const runMigration = () => migrationService(ctx).startMigration({
    target: request.target,
    requestedBy: "settings",
  })

  if (request.target.mode === "custom") {
    return runGuardedKnowledgeBaseOperation({
      ctx,
      action: "fs.write.outside-userdata",
      resource: request.target.rootPath,
      source: "knowledgeBase.startStorageMigration",
      run: runMigration,
    })
  }

  const runDefaultWrite = () => runGuardedKnowledgeBaseOperation({
    ctx,
    action: "fs.write",
    resource: "managed-knowledge-base:default-storage",
    source: "knowledgeBase.startStorageMigration",
    run: runMigration,
  })

  const currentStorage = await migrationService(ctx).getStorageStatus()
  if (currentStorage.mode !== "custom") {
    return runDefaultWrite()
  }

  return runGuardedKnowledgeBaseOperation({
    ctx,
    action: "fs.read.outside-userdata",
    resource: currentStorage.knowledgeBasesPath,
    source: "knowledgeBase.startStorageMigration.oldCustomStorage.read",
    run: () => runGuardedKnowledgeBaseOperation({
      ctx,
      action: "fs.write.outside-userdata",
      resource: currentStorage.knowledgeBasesPath,
      source: "knowledgeBase.startStorageMigration.oldCustomStorage.write",
      run: runDefaultWrite,
    }),
  })
}

async function checkKnowledgeBasePermission(options: {
  ctx: IpcHandlerContext
  action: PermissionAction
  resource: string
  source: string
}): Promise<void> {
  const startedAt = Date.now()
  const logMeta = permissionLogMeta(options)
  logger.info("Knowledge Base IPC permission request.", logMeta)
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
    logger.warn("Knowledge Base IPC permission denied.", {
      ...logMeta,
      durationMs: Date.now() - startedAt,
      reasonLength: permission.reason.length,
      policyId: permission.policyId,
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
  logger.info("Knowledge Base IPC permission completed.", {
    ...logMeta,
    durationMs: Date.now() - startedAt,
  })
}

async function checkKnowledgeBaseNetworkConnect(
  ctx: IpcHandlerContext,
  resource: string,
  checkedResources: Set<string>,
): Promise<void> {
  if (checkedResources.has(resource)) return
  checkedResources.add(resource)
  await checkKnowledgeBasePermission({
    ctx,
    action: "network.connect",
    resource,
    source: "knowledgeBase.addUrlSource.fetch",
  })
}

function createKnowledgeBaseAddUrlSourceFetch(
  ctx: IpcHandlerContext,
  checkedResources: Set<string>,
): FetchUrl {
  return createGuardedFetchUrl({
    beforeRequest: (url) => checkKnowledgeBaseNetworkConnect(ctx, sanitizeUrl(url.toString()), checkedResources),
  })
}

async function runGuardedKnowledgeBaseFileUpload<T>(options: {
  ctx: IpcHandlerContext
  projectId: string
  filePaths: readonly string[]
  readSource: string
  writeSource: string
  run(): Promise<T>
}): Promise<T> {
  assertStorageMigrationInactive(options.ctx)
  for (const filePath of options.filePaths) {
    await runGuardedKnowledgeBaseOperation({
      ctx: options.ctx,
      action: "fs.read.outside-userdata",
      resource: filePath,
      source: options.readSource,
      run: async () => undefined,
    })
  }
  return runGuardedKnowledgeBaseOperation({
    ctx: options.ctx,
    action: "fs.write",
    resource: `managed-knowledge-base:${options.projectId}`,
    source: options.writeSource,
    run: options.run,
  })
}

export const knowledgeBaseIpcModule: IpcModule = {
  id: "knowledge-base",
  methods: {
    createManaged: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.create_managed",
      request: createManagedPayloadSchema,
      response: createManagedResultSchema,
      handler: (ctx, request: { projectId: string; name: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.createManaged",
        run: () => {
          assertStorageMigrationInactive(ctx)
          return service(ctx).createManaged(request)
        },
      }),
    },
    deleteManaged: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.delete_managed",
      request: deleteManagedPayloadSchema,
      response: deleteManagedResultSchema,
      handler: (ctx, request: { projectId: string; runtimeId?: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.runtimeId ?? request.projectId}`,
        source: "knowledgeBase.deleteManaged",
        run: () => {
          assertStorageMigrationInactive(ctx)
          return service(ctx).deleteManaged(request)
        },
      }),
    },
    listRawDirectory: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.list_raw_directory",
      request: listRawDirectoryPayloadSchema,
      response: listRawDirectoryResultSchema,
      handler: (ctx, request: { projectId: string; directoryPath: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.read.outside-userdata",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.listRawDirectory",
        run: () => {
          assertStorageMigrationInactive(ctx)
          return service(ctx).listRawDirectory(request)
        },
      }),
    },
    uploadRawFiles: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.upload_raw_files",
      request: uploadRawFilesPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; targetDirectoryPath: string; filePaths: string[] }) => runGuardedKnowledgeBaseFileUpload({
        ctx,
        projectId: request.projectId,
        filePaths: request.filePaths,
        readSource: "knowledgeBase.uploadRawFiles.read",
        writeSource: "knowledgeBase.uploadRawFiles",
        run: () => trackRawMutation(() => service(ctx).uploadRawFiles(request)),
      }),
    },
    uploadRawItems: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.upload_raw_items",
      request: uploadRawItemsPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; targetDirectoryPath: string; itemPaths: string[] }) => runGuardedKnowledgeBaseFileUpload({
        ctx,
        projectId: request.projectId,
        filePaths: request.itemPaths,
        readSource: "knowledgeBase.uploadRawItems.read",
        writeSource: "knowledgeBase.uploadRawItems",
        run: () => trackRawMutation(() => service(ctx).uploadRawItems(request)),
      }),
    },
    createRawFolder: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.create_raw_folder",
      request: createRawFolderPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; parentDirectoryPath: string; name: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.createRawFolder",
        auditMetadata: rawMutationAuditMetadata({
          rawNewName: request.name,
          rawTargetDirectoryPath: request.parentDirectoryPath,
        }),
        run: () => trackRawMutation(() => service(ctx).createRawFolder(request)),
      }),
    },
    renameRawEntry: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.rename_raw_entry",
      request: renameRawEntryPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; relativePath: string; newName: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.renameRawEntry",
        auditMetadata: rawMutationAuditMetadata({
          rawNewName: request.newName,
          rawRelativePaths: [request.relativePath],
        }),
        run: () => trackRawMutation(() => service(ctx).renameRawEntry(request)),
      }),
    },
    moveRawEntries: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.move_raw_entries",
      request: moveRawEntriesPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; relativePaths: string[]; targetDirectoryPath: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.moveRawEntries",
        auditMetadata: rawMutationAuditMetadata({
          rawRelativePaths: request.relativePaths,
          rawTargetDirectoryPath: request.targetDirectoryPath,
        }),
        run: () => trackRawMutation(() => service(ctx).moveRawEntries(request)),
      }),
    },
    trashRawEntries: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.trash_raw_entries",
      request: trashRawEntriesPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; relativePaths: string[] }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.trashRawEntries",
        auditMetadata: rawMutationAuditMetadata({
          rawRelativePaths: request.relativePaths,
        }),
        run: () => trackRawMutation(() => service(ctx).trashRawEntries(request)),
      }),
    },
    addUrlSource: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.add_url_source",
      request: addUrlSourcePayloadSchema,
      response: uploadSourcesResultSchema,
      handler: async (ctx, request: { projectId: string; targetDirectoryPath?: string; url: string }) => {
        const checkedNetworkResources = new Set<string>()
        if (validateUrlSourceCandidate(request.url).ok) {
          await checkKnowledgeBaseNetworkConnect(ctx, sanitizeUrl(request.url), checkedNetworkResources)
        }
        return runGuardedKnowledgeBaseOperation({
          ctx,
          action: "fs.write",
          resource: `managed-knowledge-base:${request.projectId}`,
          source: "knowledgeBase.addUrlSource",
          run: () => trackRawMutation(() => service(ctx).addUrlSource(request, {
            fetchUrl: createKnowledgeBaseAddUrlSourceFetch(ctx, checkedNetworkResources),
          })),
        })
      },
    },
    selectAndUploadRawFiles: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.select_and_upload_raw_files",
      request: z.object({
        projectId: z.string().min(1),
        targetDirectoryPath: z.string(),
      }),
      response: rawMutationResultSchema,
      handler: async (ctx, request: { projectId: string; targetDirectoryPath: string }) => {
        assertStorageMigrationInactive(ctx)
        await assertKnowledgeBaseStorageAvailable(ctx)
        const result = await showOpenDialog({
          properties: ["openFile", "multiSelections"],
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { projectId: request.projectId, entries: [], skipped: [] }
        }
        return runGuardedKnowledgeBaseFileUpload({
          ctx,
          projectId: request.projectId,
          filePaths: result.filePaths,
          readSource: "knowledgeBase.selectAndUploadRawFiles.read",
          writeSource: "knowledgeBase.selectAndUploadRawFiles",
          run: () => trackRawMutation(() => service(ctx).uploadRawFiles({
            projectId: request.projectId,
            targetDirectoryPath: request.targetDirectoryPath,
            filePaths: result.filePaths,
          })),
        })
      },
    },
    selectAndUploadRawDirectory: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.select_and_upload_raw_directory",
      request: selectAndUploadRawDirectoryPayloadSchema,
      response: rawMutationResultSchema,
      handler: async (ctx, request: { projectId: string; targetDirectoryPath: string }) => {
        assertStorageMigrationInactive(ctx)
        await assertKnowledgeBaseStorageAvailable(ctx)
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory"],
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { projectId: request.projectId, entries: [], skipped: [] }
        }
        const itemPaths = result.filePaths.slice(0, 1)
        return runGuardedKnowledgeBaseFileUpload({
          ctx,
          projectId: request.projectId,
          filePaths: itemPaths,
          readSource: "knowledgeBase.selectAndUploadRawDirectory.read",
          writeSource: "knowledgeBase.selectAndUploadRawDirectory",
          run: () => trackRawMutation(() => service(ctx).uploadRawItems({
            projectId: request.projectId,
            targetDirectoryPath: request.targetDirectoryPath,
            itemPaths,
          })),
        })
      },
    },
    exportRawEntries: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.export_raw_entries",
      request: exportRawEntriesPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; relativePaths: string[] }) => trackRawMutation(async () => {
        await assertKnowledgeBaseStorageAvailable(ctx)
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { projectId: request.projectId, entries: [], skipped: [] }
        }
        const targetDirectoryPath = result.filePaths[0]!
        return runGuardedKnowledgeBaseOperation({
          ctx,
          action: "fs.read.outside-userdata",
          resource: `managed-knowledge-base:${request.projectId}`,
          source: "knowledgeBase.exportRawEntries.read",
          run: () => runGuardedKnowledgeBaseOperation({
            ctx,
            action: "fs.write.outside-userdata",
            resource: targetDirectoryPath,
            source: "knowledgeBase.exportRawEntries.write",
            run: () => service(ctx).exportRawEntries({
              projectId: request.projectId,
              relativePaths: request.relativePaths,
              targetDirectoryPath,
            }),
          }),
        })
      }),
    },
    openSourceManager: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.open_source_manager",
      request: openSourceManagerPayloadSchema,
      response: z.void(),
      handler: (ctx, request: { projectId: string; projectName: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.read.outside-userdata",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.openSourceManager",
        run: async () => {
          await assertKnowledgeBaseStorageAvailable(ctx)
          await knowledgeBaseSourceManagerWindowService.open(request)
        },
      }),
    },
    getStorageStatus: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.get_storage_status",
      request: z.void(),
      response: storageStatusSchema,
      handler: (ctx) => migrationService(ctx).getStorageStatus(),
    },
    getStorageMigrationState: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.get_storage_migration_state",
      request: z.void(),
      response: storageMigrationProgressSchema,
      handler: (ctx) => storageMigrationProgressPayload(migrationService(ctx).getState()),
    },
    startStorageMigration: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.start_storage_migration",
      request: storageMigrationPayloadSchema,
      response: storageMigrationResultSchema,
      handler: runGuardedStorageMigration,
    },
    cancelStorageMigration: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.cancel_storage_migration",
      request: z.void(),
      response: z.void(),
      handler: (ctx) => migrationService(ctx).cancelMigration(),
    },
    recheckStorage: {
      kind: "invoke",
      operationId: "app.knowledge_base.operation.recheck_storage",
      request: z.void(),
      response: storageStatusSchema,
      handler: (ctx) => migrationService(ctx).getStorageStatus(),
    },
  },
  events: {
    storageMigrationChanged: {
      kind: "event",
      operationId: "app.knowledge_base.operation.storage_migration_changed",
      payload: storageMigrationProgressSchema,
    },
  },
}

function storageMigrationProgressPayload(state: ReturnType<KnowledgeBaseStorageMigrationService["getState"]>) {
  return {
    active: state.active,
    phase: state.phase,
    cancellable: state.cancellable,
    copiedBytes: state.progress.copiedBytes,
    totalBytes: state.progress.totalBytes,
    message: state.message,
    ...(state.warningCode ? { warningCode: state.warningCode } : {}),
    ...(state.errorMessage ? { errorMessage: state.errorMessage } : {}),
  }
}
