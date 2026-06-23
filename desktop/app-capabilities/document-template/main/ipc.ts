import { BrowserWindow, dialog } from "electron"
import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import { generateDocxInputSchema, generateDocxResultSchema } from "../shared/schema"
import { createDocumentTemplateService } from "./service"

const chooseOutputDocxRequestSchema = z.object({
  defaultPath: z.string().min(1).optional(),
}).optional()

export const documentTemplateIpcModule: IpcModule = {
  id: "documentTemplate",
  methods: {
    chooseTemplateFile: {
      channel: "synapse:document-template:template:choose",
      kind: "invoke",
      request: z.void().optional(),
      response: z.string().nullable(),
      handler: async () => chooseOpenFile({
        title: "选择 Word 模板",
        filters: [{ name: "Word 文档", extensions: ["docx"] }],
      }),
    },
    chooseJsonFile: {
      channel: "synapse:document-template:json:choose",
      kind: "invoke",
      request: z.void().optional(),
      response: z.string().nullable(),
      handler: async () => chooseOpenFile({
        title: "选择 JSON 文件",
        filters: [{ name: "JSON", extensions: ["json"] }],
      }),
    },
    chooseOutputFile: {
      channel: "synapse:document-template:output:choose",
      kind: "invoke",
      request: chooseOutputDocxRequestSchema,
      response: z.string().nullable(),
      handler: async (_ctx, request) => {
        const parentWindow = focusedWindow()
        const options = {
          title: "选择输出文件",
          defaultPath: request?.defaultPath ?? "output.docx",
          filters: [{ name: "Word 文档", extensions: ["docx"] }],
        }
        const result = parentWindow
          ? await dialog.showSaveDialog(parentWindow, options)
          : await dialog.showSaveDialog(options)
        return result.canceled || !result.filePath ? null : result.filePath
      },
    },
    generateDocx: {
      channel: "synapse:document-template:docx:generate",
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

async function chooseOpenFile(options: Electron.OpenDialogOptions): Promise<string | null> {
  const parentWindow = focusedWindow()
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, { ...options, properties: ["openFile"] })
    : await dialog.showOpenDialog({ ...options, properties: ["openFile"] })
  return result.canceled ? null : result.filePaths[0] ?? null
}

function focusedWindow(): Electron.BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow()
    ?? BrowserWindow.getAllWindows().find((window) => window.isVisible() && !window.isDestroyed())
    ?? undefined
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
