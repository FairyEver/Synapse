import { dialog, shell } from "electron"
import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import type { KnowledgeBaseService } from "../../services/knowledge-base"
import { knowledgeBaseSourceManagerWindowService } from "../../services/knowledge-base/source-manager-window-service"
import { runGuardedShellOperation } from "../shell/guarded-shell"

const initializePayloadSchema = z.object({
  projectPath: z.string().min(1),
  mode: z.enum(["create", "repair"]),
})

const initializeResultSchema = z.object({
  projectPath: z.string(),
  templateVersion: z.string(),
  createdFiles: z.array(z.string()),
  existingFiles: z.array(z.string()),
})

const inspectionSchema = z.object({
  projectPath: z.string(),
  isKnowledgeBase: z.boolean(),
  hasMetadata: z.boolean(),
  hasRequiredShape: z.boolean(),
  missingRequiredPaths: z.array(z.string()),
  templateVersion: z.string().optional(),
})

const openRawResultSchema = z.object({
  rawPath: z.string(),
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
  projectPath: z.string(),
  sources: z.array(sourceEntrySchema),
})

const uploadSourcesPayloadSchema = z.object({
  projectPath: z.string().min(1),
  filePaths: z.array(z.string().min(1)),
})

const uploadSourcesResultSchema = z.object({
  projectPath: z.string(),
  uploaded: z.array(z.object({
    originalPath: z.string(),
    relativePath: z.string(),
    name: z.string(),
    size: z.number(),
  })),
  skipped: z.array(z.object({
    path: z.string(),
    reason: z.enum(["not-file", "read-error"]),
  })),
})

const openSourceManagerPayloadSchema = z.object({
  projectId: z.string().min(1),
  projectPath: z.string().min(1),
  projectName: z.string().min(1),
})

function service(ctx: IpcHandlerContext): KnowledgeBaseService {
  return ctx.resolve<KnowledgeBaseService>("knowledge-base.service")
}

async function runGuardedKnowledgeBaseOperation<T>(options: {
  ctx: IpcHandlerContext
  action: PermissionAction
  resource: string
  source: string
  run(): Promise<T>
}): Promise<T> {
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
  try {
    const result = await options.run()
    auditSink.record({
      action: options.action,
      actor,
      resource: options.resource,
      outcome: "allowed",
      metadata: { source: options.source },
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
    throw error
  }
}

export const knowledgeBaseIpcModule: IpcModule = {
  id: "knowledge-base",
  methods: {
    inspect: {
      kind: "invoke",
      channel: "synapse:knowledge-base:inspect",
      request: z.object({ projectPath: z.string().min(1) }),
      response: inspectionSchema,
      handler: (ctx, request: { projectPath: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.read.outside-userdata",
        resource: request.projectPath,
        source: "knowledgeBase.inspect",
        run: () => service(ctx).inspect(request.projectPath),
      }),
    },
    initialize: {
      kind: "invoke",
      channel: "synapse:knowledge-base:initialize",
      request: initializePayloadSchema,
      response: initializeResultSchema,
      handler: (ctx, request: { projectPath: string; mode: "create" | "repair" }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: request.projectPath,
        source: "knowledgeBase.initialize",
        run: () => service(ctx).initialize(request),
      }),
    },
    listSources: {
      kind: "invoke",
      channel: "synapse:knowledge-base:list-sources",
      request: z.object({ projectPath: z.string().min(1) }),
      response: listSourcesResultSchema,
      handler: (ctx, request: { projectPath: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.read.outside-userdata",
        resource: request.projectPath,
        source: "knowledgeBase.listSources",
        run: () => service(ctx).listSources(request.projectPath),
      }),
    },
    uploadSources: {
      kind: "invoke",
      channel: "synapse:knowledge-base:upload-sources",
      request: uploadSourcesPayloadSchema,
      response: uploadSourcesResultSchema,
      handler: (ctx, request: { projectPath: string; filePaths: string[] }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: request.projectPath,
        source: "knowledgeBase.uploadSources",
        run: () => service(ctx).uploadSources(request),
      }),
    },
    selectAndUploadSources: {
      kind: "invoke",
      channel: "synapse:knowledge-base:select-and-upload-sources",
      request: z.object({ projectPath: z.string().min(1) }),
      response: uploadSourcesResultSchema,
      handler: (ctx, request: { projectPath: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: request.projectPath,
        source: "knowledgeBase.selectAndUploadSources",
        run: async () => {
          const result = await dialog.showOpenDialog({
            properties: ["openFile", "multiSelections"],
          })
          if (result.canceled || result.filePaths.length === 0) {
            return { projectPath: request.projectPath, uploaded: [], skipped: [] }
          }
          return service(ctx).uploadSources({
            projectPath: request.projectPath,
            filePaths: result.filePaths,
          })
        },
      }),
    },
    openSourceManager: {
      kind: "invoke",
      channel: "synapse:knowledge-base:open-source-manager",
      request: openSourceManagerPayloadSchema,
      response: z.void(),
      handler: (ctx, request: { projectId: string; projectPath: string; projectName: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.read.outside-userdata",
        resource: request.projectPath,
        source: "knowledgeBase.openSourceManager",
        run: () => knowledgeBaseSourceManagerWindowService.open(request),
      }),
    },
    openRawDirectory: {
      kind: "invoke",
      channel: "synapse:knowledge-base:open-raw-directory",
      request: z.object({ projectPath: z.string().min(1) }),
      response: openRawResultSchema,
      handler: async (ctx, request: { projectPath: string }) => {
        const result = await runGuardedKnowledgeBaseOperation({
          ctx,
          action: "fs.write",
          resource: request.projectPath,
          source: "knowledgeBase.ensureRawDirectory",
          run: () => service(ctx).openRawDirectory(request.projectPath),
        })
        await runGuardedShellOperation({
          ctx,
          resource: result.rawPath,
          source: "knowledgeBase.openRawDirectory",
          run: async () => {
            const error = await shell.openPath(result.rawPath)
            if (error) {
              throw new Error(error)
            }
          },
        })
        return result
      },
    },
  },
  events: {},
}
