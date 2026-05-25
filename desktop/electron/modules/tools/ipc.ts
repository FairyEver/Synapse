import { app, dialog } from "electron"
import { z } from "zod"

import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
import { convertFilesInWorker } from "../../services/tools/file-conversion-runner"
import type { ToolWindowService } from "../../services/tools/tool-window-service"
import { listToolDefinitions } from "../../services/tools/tool-registry"

const toolIdSchema = z.enum(["file-conversion"])

const toolDefinitionSchema = z.object({
  id: toolIdSchema,
  label: z.string(),
  windowTitle: z.string(),
  description: z.string(),
  supportedExtensions: z.array(z.string()).optional(),
  bounds: z.object({
    width: z.number(),
    height: z.number(),
    minWidth: z.number(),
    minHeight: z.number(),
  }),
})

const listToolsResultSchema = z.object({
  tools: z.array(toolDefinitionSchema),
})

const fileConversionPayloadSchema = z.object({
  filePaths: z.array(z.string().min(1)).min(1),
  outputDirectory: z.string().min(1),
})

const fileConversionOutputDirectoryRequestSchema = z.object({
  defaultPath: z.string().min(1).optional(),
})

const fileConversionResultSchema = z.object({
  successes: z.array(z.object({
    sourcePath: z.string(),
    outputPath: z.string(),
    warningCount: z.number(),
  })),
  failures: z.array(z.object({
    sourcePath: z.string(),
    reason: z.enum([
      "unsupported-format",
      "read-failed",
      "conversion-failed",
      "write-failed",
      "invalid-output-path",
    ]),
    message: z.string(),
  })),
})

function windowService(ctx: IpcHandlerContext): ToolWindowService {
  return ctx.resolve<ToolWindowService>("tools.window-service")
}

async function checkPermission(ctx: IpcHandlerContext, options: {
  readonly action: PermissionAction
  readonly resource: string
  readonly source: string
}): Promise<void> {
  const actor = { kind: "user" } as const
  const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
  const permission = await permissionGuard.check({
    action: options.action,
    actor,
    resource: options.resource,
    context: { source: options.source },
  })
  auditSink.record({
    action: options.action,
    actor,
    resource: options.resource,
    outcome: permission.allowed ? "allowed" : "denied",
    metadata: permission.allowed
      ? { source: options.source }
      : { source: options.source, reason: permission.reason, policyId: permission.policyId },
  })
  if (!permission.allowed) {
    throw new Error(permission.reason)
  }
}

export const toolsIpcModule: IpcModule = {
  id: "tools",
  methods: {
    listTools: {
      kind: "invoke",
      channel: "synapse:tools:list",
      request: z.object({}),
      response: listToolsResultSchema,
      handler: () => ({ tools: listToolDefinitions() }),
    },
    openTool: {
      kind: "invoke",
      channel: "synapse:tools:open",
      request: z.object({ toolId: toolIdSchema }),
      response: z.object({}),
      handler: async (ctx, request: { toolId: string }) => {
        await windowService(ctx).open(request.toolId)
        return {}
      },
    },
    selectFileConversionInputFiles: {
      kind: "invoke",
      channel: "synapse:tools:file-conversion:select-input-files",
      request: z.object({}),
      response: z.object({ filePaths: z.array(z.string()) }),
      handler: async () => {
        const result = await dialog.showOpenDialog({
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "支持的文档", extensions: ["docx", "xlsx", "pdf", "pptx"] }],
        })
        return { filePaths: result.canceled ? [] : result.filePaths }
      },
    },
    selectFileConversionOutputDirectory: {
      kind: "invoke",
      channel: "synapse:tools:file-conversion:select-output-directory",
      request: fileConversionOutputDirectoryRequestSchema,
      response: z.object({ directoryPath: z.string().nullable() }),
      handler: async (_ctx, request: { defaultPath?: string }) => {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory"],
          ...(request.defaultPath ? { defaultPath: request.defaultPath } : {}),
        })
        return { directoryPath: result.canceled ? null : result.filePaths[0] ?? null }
      },
    },
    getDefaultFileConversionOutputDirectory: {
      kind: "invoke",
      channel: "synapse:tools:file-conversion:get-default-output-directory",
      request: z.object({}),
      response: z.object({ directoryPath: z.string() }),
      handler: () => ({ directoryPath: app.getPath("downloads") }),
    },
    convertFiles: {
      kind: "invoke",
      channel: "synapse:tools:file-conversion:convert",
      request: fileConversionPayloadSchema,
      response: fileConversionResultSchema,
      handler: async (ctx, request: { filePaths: string[]; outputDirectory: string }) => {
        for (const filePath of request.filePaths) {
          await checkPermission(ctx, {
            action: "fs.read.outside-userdata",
            resource: filePath,
            source: "tools.fileConversion.convert.read",
          })
        }
        await checkPermission(ctx, {
          action: "fs.write",
          resource: request.outputDirectory,
          source: "tools.fileConversion.convert.write",
        })
        const runConversion = ctx.resolve<typeof convertFilesInWorker>("tools.file-conversion-runner")
        return runConversion({
          filePaths: request.filePaths,
          outputDirectory: request.outputDirectory,
        })
      },
    },
  },
  events: {},
}
