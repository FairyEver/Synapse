import { dialog } from "electron"
import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import { createMainLogger } from "../../services/log-store"
import type { KnowledgeBaseService } from "../../services/knowledge-base"
import { knowledgeBaseSourceManagerWindowService } from "../../services/knowledge-base/source-manager-window-service"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"

const logger = createMainLogger("knowledge-base.ipc")
const KNOWLEDGE_BASE_RESOURCE_PREFIX = "managed-knowledge-base:"

const createManagedPayloadSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
})

const createManagedResultSchema = z.object({
  projectId: z.string(),
  projectPath: z.string(),
  runtimePath: z.string(),
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
  runtimePath: z.string(),
  deleted: z.boolean(),
})

const sourceEntrySchema = z.object({
  relativePath: z.string(),
  name: z.string(),
  size: z.number(),
  modifiedAt: z.string(),
  supported: z.boolean(),
  status: z.enum(["pending", "changed", "imported", "unsupported", "error"]),
  hash: z.string().optional(),
})

const listSourcesResultSchema = z.object({
  projectId: z.string(),
  sources: z.array(sourceEntrySchema),
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
})

const listRawDirectoryResultSchema = z.object({
  projectId: z.string(),
  directoryPath: z.string(),
  entries: z.array(rawEntrySchema),
})

const uploadSourcesPayloadSchema = z.object({
  projectId: z.string().min(1),
  filePaths: z.array(z.string().min(1)),
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
  relativePaths: z.array(z.string().min(1)),
})

const addUrlSourcePayloadSchema = z.object({
  projectId: z.string().min(1),
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
    conversionWarnings: z.array(z.object({
      code: z.string(),
      message: z.string(),
    })).optional(),
  })),
  skipped: z.array(z.object({
    path: z.string(),
    reason: z.enum(["not-file", "read-error", "conversion-error", "unsupported"]),
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
      "collision",
      "trash-error",
      "symlink",
      "system-noise",
      "export-error",
    ]),
  })),
})

const openSourceManagerPayloadSchema = z.object({
  projectId: z.string().min(1),
  projectName: z.string().min(1),
})

function service(ctx: IpcHandlerContext): KnowledgeBaseService {
  return ctx.resolve<KnowledgeBaseService>("knowledge-base.service")
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

async function runGuardedKnowledgeBaseOperation<T>(options: {
  ctx: IpcHandlerContext
  action: PermissionAction
  resource: string
  source: string
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
      metadata: { source: options.source },
    })
    logger.info("Knowledge Base IPC completed.", {
      ...logMeta,
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

async function runGuardedKnowledgeBaseFileUpload<T>(options: {
  ctx: IpcHandlerContext
  projectId: string
  filePaths: readonly string[]
  readSource: string
  writeSource: string
  run(): Promise<T>
}): Promise<T> {
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
      channel: "synapse:knowledge-base:create-managed",
      request: createManagedPayloadSchema,
      response: createManagedResultSchema,
      handler: (ctx, request: { projectId: string; name: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.createManaged",
        run: () => service(ctx).createManaged(request),
      }),
    },
    deleteManaged: {
      kind: "invoke",
      channel: "synapse:knowledge-base:delete-managed",
      request: deleteManagedPayloadSchema,
      response: deleteManagedResultSchema,
      handler: (ctx, request: { projectId: string; runtimeId?: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.deleteManaged",
        run: () => service(ctx).deleteManaged(request),
      }),
    },
    listSources: {
      kind: "invoke",
      channel: "synapse:knowledge-base:list-sources",
      request: z.object({ projectId: z.string().min(1) }),
      response: listSourcesResultSchema,
      handler: (ctx, request: { projectId: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.read.outside-userdata",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.listSources",
        run: () => service(ctx).listSources(request.projectId),
      }),
    },
    listRawDirectory: {
      kind: "invoke",
      channel: "synapse:knowledge-base:list-raw-directory",
      request: listRawDirectoryPayloadSchema,
      response: listRawDirectoryResultSchema,
      handler: (ctx, request: { projectId: string; directoryPath: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.read.outside-userdata",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.listRawDirectory",
        run: () => service(ctx).listRawDirectory(request),
      }),
    },
    uploadSources: {
      kind: "invoke",
      channel: "synapse:knowledge-base:upload-sources",
      request: uploadSourcesPayloadSchema,
      response: uploadSourcesResultSchema,
      handler: (ctx, request: { projectId: string; filePaths: string[] }) => runGuardedKnowledgeBaseFileUpload({
        ctx,
        projectId: request.projectId,
        filePaths: request.filePaths,
        readSource: "knowledgeBase.uploadSources.read",
        writeSource: "knowledgeBase.uploadSources",
        run: () => service(ctx).uploadSources(request),
      }),
    },
    uploadRawFiles: {
      kind: "invoke",
      channel: "synapse:knowledge-base:upload-raw-files",
      request: uploadRawFilesPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; targetDirectoryPath: string; filePaths: string[] }) => runGuardedKnowledgeBaseFileUpload({
        ctx,
        projectId: request.projectId,
        filePaths: request.filePaths,
        readSource: "knowledgeBase.uploadRawFiles.read",
        writeSource: "knowledgeBase.uploadRawFiles",
        run: () => service(ctx).uploadRawFiles(request),
      }),
    },
    uploadRawItems: {
      kind: "invoke",
      channel: "synapse:knowledge-base:upload-raw-items",
      request: uploadRawItemsPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; targetDirectoryPath: string; itemPaths: string[] }) => runGuardedKnowledgeBaseFileUpload({
        ctx,
        projectId: request.projectId,
        filePaths: request.itemPaths,
        readSource: "knowledgeBase.uploadRawItems.read",
        writeSource: "knowledgeBase.uploadRawItems",
        run: () => service(ctx).uploadRawItems(request),
      }),
    },
    createRawFolder: {
      kind: "invoke",
      channel: "synapse:knowledge-base:create-raw-folder",
      request: createRawFolderPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; parentDirectoryPath: string; name: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.createRawFolder",
        run: () => service(ctx).createRawFolder(request),
      }),
    },
    renameRawEntry: {
      kind: "invoke",
      channel: "synapse:knowledge-base:rename-raw-entry",
      request: renameRawEntryPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; relativePath: string; newName: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.renameRawEntry",
        run: () => service(ctx).renameRawEntry(request),
      }),
    },
    moveRawEntries: {
      kind: "invoke",
      channel: "synapse:knowledge-base:move-raw-entries",
      request: moveRawEntriesPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; relativePaths: string[]; targetDirectoryPath: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.moveRawEntries",
        run: () => service(ctx).moveRawEntries(request),
      }),
    },
    trashRawEntries: {
      kind: "invoke",
      channel: "synapse:knowledge-base:trash-raw-entries",
      request: trashRawEntriesPayloadSchema,
      response: rawMutationResultSchema,
      handler: (ctx, request: { projectId: string; relativePaths: string[] }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.trashRawEntries",
        run: () => service(ctx).trashRawEntries(request),
      }),
    },
    addUrlSource: {
      kind: "invoke",
      channel: "synapse:knowledge-base:add-url-source",
      request: addUrlSourcePayloadSchema,
      response: uploadSourcesResultSchema,
      handler: async (ctx, request: { projectId: string; url: string }) => {
        await checkKnowledgeBasePermission({
          ctx,
          action: "network.connect",
          resource: sanitizeUrl(request.url),
          source: "knowledgeBase.addUrlSource.fetch",
        })
        return runGuardedKnowledgeBaseOperation({
          ctx,
          action: "fs.write",
          resource: `managed-knowledge-base:${request.projectId}`,
          source: "knowledgeBase.addUrlSource",
          run: () => service(ctx).addUrlSource(request),
        })
      },
    },
    selectAndUploadSources: {
      kind: "invoke",
      channel: "synapse:knowledge-base:select-and-upload-sources",
      request: z.object({ projectId: z.string().min(1) }),
      response: uploadSourcesResultSchema,
      handler: async (ctx, request: { projectId: string }) => {
        const result = await dialog.showOpenDialog({
          properties: ["openFile", "multiSelections"],
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { projectId: request.projectId, uploaded: [], skipped: [] }
        }
        return runGuardedKnowledgeBaseFileUpload({
          ctx,
          projectId: request.projectId,
          filePaths: result.filePaths,
          readSource: "knowledgeBase.selectAndUploadSources.read",
          writeSource: "knowledgeBase.selectAndUploadSources",
          run: () => service(ctx).uploadSources({
            projectId: request.projectId,
            filePaths: result.filePaths,
          }),
        })
      },
    },
    selectAndUploadRawFiles: {
      kind: "invoke",
      channel: "synapse:knowledge-base:select-and-upload-raw-files",
      request: z.object({
        projectId: z.string().min(1),
        targetDirectoryPath: z.string(),
      }),
      response: rawMutationResultSchema,
      handler: async (ctx, request: { projectId: string; targetDirectoryPath: string }) => {
        const result = await dialog.showOpenDialog({
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
          run: () => service(ctx).uploadRawFiles({
            projectId: request.projectId,
            targetDirectoryPath: request.targetDirectoryPath,
            filePaths: result.filePaths,
          }),
        })
      },
    },
    selectAndUploadRawDirectory: {
      kind: "invoke",
      channel: "synapse:knowledge-base:select-and-upload-raw-directory",
      request: selectAndUploadRawDirectoryPayloadSchema,
      response: rawMutationResultSchema,
      handler: async (ctx, request: { projectId: string; targetDirectoryPath: string }) => {
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
          run: () => service(ctx).uploadRawItems({
            projectId: request.projectId,
            targetDirectoryPath: request.targetDirectoryPath,
            itemPaths,
          }),
        })
      },
    },
    exportRawEntries: {
      kind: "invoke",
      channel: "synapse:knowledge-base:export-raw-entries",
      request: exportRawEntriesPayloadSchema,
      response: rawMutationResultSchema,
      handler: async (ctx, request: { projectId: string; relativePaths: string[] }) => {
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
            action: "fs.write",
            resource: targetDirectoryPath,
            source: "knowledgeBase.exportRawEntries.write",
            run: () => service(ctx).exportRawEntries({
              projectId: request.projectId,
              relativePaths: request.relativePaths,
              targetDirectoryPath,
            }),
          }),
        })
      },
    },
    openSourceManager: {
      kind: "invoke",
      channel: "synapse:knowledge-base:open-source-manager",
      request: openSourceManagerPayloadSchema,
      response: z.void(),
      handler: (ctx, request: { projectId: string; projectName: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.read.outside-userdata",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.openSourceManager",
        run: () => knowledgeBaseSourceManagerWindowService.open(request),
      }),
    },
  },
  events: {},
}
