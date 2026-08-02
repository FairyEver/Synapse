import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { getMcpServers, openMcpSettings, registerMcp } from "../../database/mcp-installer"
import { getMcpServerPort, getMcpServerUrl, isMcpServerRunning } from "../../database/mcp-server"

const registrationInfoSchema = z.object({
  target: z.string(),
  settingsPath: z.string(),
  settingsFileExists: z.boolean(),
  registered: z.boolean(),
  mode: z.enum(["http", "stdio"]).nullable(),
  url: z.string().nullable(),
  readError: z.string().optional(),
})

const serverStatusSchema = z.object({
  running: z.boolean(),
  port: z.number(),
  url: z.string(),
})

const operationResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
})

export const mcpIpcModule: IpcModule = {
  id: "mcp",
  methods: {
    serverGet: {
      kind: "invoke",
      operationId: "app.mcp.server.get",
      request: z.void(),
      response: serverStatusSchema,
      handler: async () => ({
        running: isMcpServerRunning(),
        port: getMcpServerPort(),
        url: getMcpServerUrl(),
      }),
    },
    registrationList: {
      kind: "invoke",
      operationId: "app.mcp.registration.list",
      request: z.void(),
      response: z.array(registrationInfoSchema),
      handler: async () => getMcpServers(),
    },
    registrationOpenSettings: {
      kind: "invoke",
      operationId: "app.mcp.registration.open_settings",
      request: z.string().min(1),
      response: operationResultSchema,
      handler: async (_ctx, target: string) => openMcpSettings(target),
    },
    registrationRegister: {
      kind: "invoke",
      operationId: "app.mcp.registration.register",
      request: z.string().min(1),
      response: operationResultSchema,
      handler: async (ctx, target: string) => registerMcp(target, getMcpServerPort(), {
        actor: {
          kind: "user",
          id: ctx.sender ? `renderer:${ctx.sender.id}` : undefined,
          display: "MCP App",
        },
        source: "mcp.registration.register",
        permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
      }),
    },
  },
  events: {},
}
