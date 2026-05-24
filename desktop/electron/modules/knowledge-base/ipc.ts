import { dialog } from "electron"
import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import type { KnowledgeBaseService } from "../../services/knowledge-base"
import { knowledgeBaseSourceManagerWindowService } from "../../services/knowledge-base/source-manager-window-service"

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

const uploadSourcesPayloadSchema = z.object({
  projectId: z.string().min(1),
  filePaths: z.array(z.string().min(1)),
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
    reason: z.enum(["not-file", "read-error", "conversion-error"]),
  })),
})

const openSourceManagerPayloadSchema = z.object({
  projectId: z.string().min(1),
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
    uploadSources: {
      kind: "invoke",
      channel: "synapse:knowledge-base:upload-sources",
      request: uploadSourcesPayloadSchema,
      response: uploadSourcesResultSchema,
      handler: (ctx, request: { projectId: string; filePaths: string[] }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.uploadSources",
        run: () => service(ctx).uploadSources(request),
      }),
    },
    addUrlSource: {
      kind: "invoke",
      channel: "synapse:knowledge-base:add-url-source",
      request: addUrlSourcePayloadSchema,
      response: uploadSourcesResultSchema,
      handler: (ctx, request: { projectId: string; url: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "network.connect",
        resource: request.url,
        source: "knowledgeBase.addUrlSource.fetch",
        run: () => runGuardedKnowledgeBaseOperation({
          ctx,
          action: "fs.write",
          resource: `managed-knowledge-base:${request.projectId}`,
          source: "knowledgeBase.addUrlSource",
          run: () => service(ctx).addUrlSource(request),
        }),
      }),
    },
    selectAndUploadSources: {
      kind: "invoke",
      channel: "synapse:knowledge-base:select-and-upload-sources",
      request: z.object({ projectId: z.string().min(1) }),
      response: uploadSourcesResultSchema,
      handler: (ctx, request: { projectId: string }) => runGuardedKnowledgeBaseOperation({
        ctx,
        action: "fs.write",
        resource: `managed-knowledge-base:${request.projectId}`,
        source: "knowledgeBase.selectAndUploadSources",
        run: async () => {
          const result = await dialog.showOpenDialog({
            properties: ["openFile", "multiSelections"],
          })
          if (result.canceled || result.filePaths.length === 0) {
            return { projectId: request.projectId, uploaded: [], skipped: [] }
          }
          return service(ctx).uploadSources({
            projectId: request.projectId,
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
