import { shell } from "electron"
import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import type { KnowledgeBaseService } from "../../services/knowledge-base"
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
          run: () => shell.showItemInFolder(result.rawPath),
        })
        return result
      },
    },
  },
  events: {},
}
