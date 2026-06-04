import { dialog } from "electron"
import { z } from "zod"

import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { getBuiltinToolDescriptor, listRendererBuiltinToolDescriptors, projectBuiltinToolDescriptor } from "../../services/builtin-tools/registry"
import { runBuiltinTool } from "../../services/builtin-tools/runner"
import type { ToolWindowService } from "../../services/tools/tool-window-service"

const toolIdSchema = z.enum([
  "docx-to-markdown",
  "xlsx-to-markdown",
  "csv-to-markdown",
  "pdf-to-markdown",
  "pptx-to-markdown",
])

const fieldConditionSchema = z.object({
  field: z.string(),
  equals: z.union([z.string(), z.number(), z.boolean()]),
})

const inputFieldSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    kind: z.literal("file"),
    label: z.string(),
    required: z.boolean().optional(),
    extensions: z.array(z.string()).optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("directory"),
    label: z.string(),
    required: z.boolean().optional(),
    when: fieldConditionSchema.optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("text"),
    label: z.string(),
    required: z.boolean().optional(),
    defaultValue: z.string().optional(),
    when: fieldConditionSchema.optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("select"),
    label: z.string(),
    required: z.boolean().optional(),
    defaultValue: z.string().optional(),
    options: z.array(z.object({ value: z.string(), label: z.string() })),
    when: fieldConditionSchema.optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("checkbox"),
    label: z.string(),
    defaultValue: z.boolean().optional(),
    when: fieldConditionSchema.optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("number"),
    label: z.string(),
    required: z.boolean().optional(),
    defaultValue: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    when: fieldConditionSchema.optional(),
  }),
])

const toolDefinitionSchema = z.object({
  id: toolIdSchema,
  title: z.string(),
  description: z.string(),
  category: z.enum(["conversion", "content", "utility"]),
  inputFields: z.array(inputFieldSchema),
  outputPreview: z.object({
    kind: z.enum(["markdown", "text", "file"]),
    pathFromOutput: z.string().optional(),
  }),
  input: z.object({
    kind: z.literal("file"),
    extensions: z.array(z.string()),
  }),
  output: z.object({
    kind: z.enum(["markdown", "text", "file"]),
  }),
})

const listToolsResultSchema = z.object({
  tools: z.array(toolDefinitionSchema),
})

const runToolRequestSchema = z.object({
  toolId: toolIdSchema,
  input: z.record(z.string(), z.unknown()),
})

const runToolResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    toolId: toolIdSchema,
    output: z.record(z.string(), z.unknown()),
    warnings: z.array(z.object({ code: z.string(), message: z.string() })),
    metadata: z.record(z.string(), z.unknown()),
  }),
  z.object({
    ok: z.literal(false),
    toolId: toolIdSchema,
    error: z.object({ code: z.string(), message: z.string() }),
    metadata: z.record(z.string(), z.unknown()),
  }),
])

const fieldSelectionSchema = z.object({
  toolId: toolIdSchema,
  fieldId: z.string().min(1),
})

const directorySelectionSchema = fieldSelectionSchema.extend({
  defaultPath: z.string().min(1).optional(),
})

function windowService(ctx: IpcHandlerContext): ToolWindowService {
  return ctx.resolve<ToolWindowService>("tools.window-service")
}

function requireTool(toolId: string) {
  const descriptor = getBuiltinToolDescriptor(toolId)
  if (!descriptor) {
    throw new Error(`Unknown tool: ${toolId}`)
  }
  return descriptor
}

export const toolsIpcModule: IpcModule = {
  id: "tools",
  methods: {
    listTools: {
      kind: "invoke",
      channel: "synapse:tools:list",
      request: z.object({}),
      response: listToolsResultSchema,
      handler: () => ({ tools: listRendererBuiltinToolDescriptors() }),
    },
    openTool: {
      kind: "invoke",
      channel: "synapse:tools:open",
      request: z.object({ toolId: toolIdSchema }),
      response: z.object({}),
      handler: async (ctx, request: { toolId: string }) => {
        requireTool(request.toolId)
        await windowService(ctx).open(request.toolId)
        return {}
      },
    },
    getToolDescriptor: {
      kind: "invoke",
      channel: "synapse:tools:descriptor",
      request: z.object({ toolId: toolIdSchema }),
      response: toolDefinitionSchema,
      handler: (_ctx, request: { toolId: string }) => projectBuiltinToolDescriptor(requireTool(request.toolId)),
    },
    runTool: {
      kind: "invoke",
      channel: "synapse:tools:run",
      request: runToolRequestSchema,
      response: runToolResultSchema,
      handler: async (ctx, request: { toolId: string; input: Record<string, unknown> }) => {
        const runTool = ctx.resolve<typeof runBuiltinTool>("tools.builtin-tool-runner")
        return runTool({
          toolId: request.toolId,
          input: request.input,
          context: { entryPoint: "tools", actor: { kind: "user" } },
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
        })
      },
    },
    selectFile: {
      kind: "invoke",
      channel: "synapse:tools:select-file",
      request: fieldSelectionSchema,
      response: z.object({ filePath: z.string().nullable() }),
      handler: async (_ctx, request: { toolId: string; fieldId: string }) => {
        const descriptor = requireTool(request.toolId)
        const field = descriptor.ui.fields.find((item) => item.id === request.fieldId)
        if (!field || field.kind !== "file") {
          throw new Error(`Unknown file field: ${request.fieldId}`)
        }
        const extensions = (field.extensions ?? descriptor.input.extensions).map((extension) => extension.replace(/^\./, ""))
        const result = await dialog.showOpenDialog({
          properties: ["openFile"],
          filters: [{ name: "支持的文件", extensions }],
        })
        return { filePath: result.canceled ? null : result.filePaths[0] ?? null }
      },
    },
    selectDirectory: {
      kind: "invoke",
      channel: "synapse:tools:select-directory",
      request: directorySelectionSchema,
      response: z.object({ directoryPath: z.string().nullable() }),
      handler: async (_ctx, request: { toolId: string; fieldId: string; defaultPath?: string }) => {
        const descriptor = requireTool(request.toolId)
        const field = descriptor.ui.fields.find((item) => item.id === request.fieldId)
        if (!field || field.kind !== "directory") {
          throw new Error(`Unknown directory field: ${request.fieldId}`)
        }
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory"],
          ...(request.defaultPath ? { defaultPath: request.defaultPath } : {}),
        })
        return { directoryPath: result.canceled ? null : result.filePaths[0] ?? null }
      },
    },
  },
  events: {},
}
