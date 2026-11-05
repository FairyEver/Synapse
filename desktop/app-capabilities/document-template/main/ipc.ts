import { showSenderOpenDialog, showSenderSaveDialog } from "../../../electron/runtime/ipc/sender-dialog"
import { z } from "zod"
import type { IpcHandlerContext, IpcModule } from "../../../electron/runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import { generateDocxInputSchema, generateDocxResultSchema } from "../shared/schema"
import { createDocumentTemplateService } from "./service"

const chooseOutputDocxRequestSchema = z.object({
  defaultPath: z.string().min(1).optional(),
}).optional()

type ChooseOutputDocxRequest = z.infer<typeof chooseOutputDocxRequestSchema>

export const documentTemplateIpcModule: IpcModule = {
  id: "documentTemplate",
  methods: {
    chooseTemplateFile: {
      operationId: "app.document_template.template.choose",
      kind: "invoke",
      request: z.void().optional(),
      response: z.string().nullable(),
      handler: async (ctx) => chooseOpenFile(ctx, {
        title: "选择 Word 模板",
        filters: [{ name: "Word 文档", extensions: ["docx"] }],
      }),
    },
    chooseJsonFile: {
      operationId: "app.document_template.json.choose",
      kind: "invoke",
      request: z.void().optional(),
      response: z.string().nullable(),
      handler: async (ctx) => chooseOpenFile(ctx, {
        title: "选择 JSON 文件",
        filters: [{ name: "JSON", extensions: ["json"] }],
      }),
    },
    chooseOutputFile: {
      operationId: "app.document_template.output.choose",
      kind: "invoke",
      request: chooseOutputDocxRequestSchema,
      response: z.string().nullable(),
      handler: async (ctx, request: ChooseOutputDocxRequest) => {
        const options = {
          title: "选择输出文件",
          defaultPath: request?.defaultPath ?? "output.docx",
          filters: [{ name: "Word 文档", extensions: ["docx"] }],
        }
        const result = await showSenderSaveDialog(ctx, options)
        return result.canceled || !result.filePath ? null : result.filePath
      },
    },
    generateDocx: {
      operationId: "app.document_template.docx.generate",
      kind: "invoke",
      request: generateDocxInputSchema,
      response: generateDocxResultSchema,
      handler: async (ctx, request: z.infer<typeof generateDocxInputSchema>) => {
        await authorizeFileAccess(ctx, "fs.read.outside-userdata", request.templatePath, "documentTemplate.generateDocx.template")
        if (request.dataPath) {
          await authorizeFileAccess(ctx, "fs.read.outside-userdata", request.dataPath, "documentTemplate.generateDocx.data")
        }
        await authorizeFileAccess(ctx, "fs.write.outside-userdata", request.outputPath, "documentTemplate.generateDocx.output")
        return createDocumentTemplateService().generateDocx(request)
      },
    },
  },
  events: {},
}

async function chooseOpenFile(ctx: IpcHandlerContext, options: Electron.OpenDialogOptions): Promise<string | null> {
  const result = await showSenderOpenDialog(ctx, { ...options, properties: ["openFile"] })
  return result.canceled ? null : result.filePaths[0] ?? null
}

async function authorizeFileAccess(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
  action: PermissionAction,
  resource: string,
  source: string,
): Promise<void> {
  const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
  const actor = { kind: "user" } as const
  const permission = await permissionGuard.check({
    action,
    actor,
    resource,
    context: { source },
  })
  auditSink.record({
    action,
    actor,
    resource,
    outcome: permission.allowed ? "allowed" : "denied",
    metadata: permission.allowed
      ? { source }
      : { source, reason: permission.reason, policyId: permission.policyId },
  })
  if (!permission.allowed) {
    throw new Error(permission.reason)
  }
}
