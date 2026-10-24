import { z } from "zod"

import type { IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { AgentMcpSettingsService } from "../../services/agent-mcp-settings-service"
import type { IpcHandlerContext } from "../../runtime/ipc/types"
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

async function authorizeAgentMcp(ctx: IpcHandlerContext, write: boolean): Promise<void> {
  const action = write ? "fs.write" as const : "fs.read.outside-userdata" as const
  const actor = { kind: "user" as const, id: ctx.sender ? `renderer:${ctx.sender.id}` : undefined }
  const resource = "synapse:agent-mcp-settings"
  const result = await ctx.resolve<PermissionGuard>("core.permission-guard").check({ action, actor, resource, context: { source: "settings.agent-mcp", write } })
  ctx.resolve<AuditSink>("core.audit-sink").record({ action, actor, resource, outcome: result.allowed ? "allowed" : "denied", metadata: { source: "settings.agent-mcp", write } })
  if (!result.allowed) throw new Error("没有权限管理 Agent MCP。")
}

export const mcpIpcModule: IpcModule = {
  id: "mcp",
  methods: {
    agentList: {
      kind: "invoke",
      operationId: "app.mcp.agent.list",
      request: z.object({ projectId: z.string().min(1).max(256).optional() }).strict(),
      response: z.object({
        items: z.array(z.object({ name: z.string(), source: z.string(), enabled: z.boolean(), configurable: z.boolean() }).strict()),
        projects: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
        disabledServerNames: z.array(z.string()), warnings: z.array(z.string()),
      }).strict(),
      handler: async (ctx, input: { projectId?: string }) => {
        await authorizeAgentMcp(ctx, false)
        return ctx.resolve<AgentMcpSettingsService>("core.agent-mcp-settings").list(input)
      },
    },
    agentSetEnabled: {
      kind: "invoke",
      operationId: "app.mcp.agent.set_enabled",
      request: z.object({ name: z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/u), enabled: z.boolean() }).strict(),
      response: z.void(),
      handler: async (ctx, input: { name: string; enabled: boolean }) => {
        await authorizeAgentMcp(ctx, true)
        await ctx.resolve<AgentMcpSettingsService>("core.agent-mcp-settings").setEnabled(input)
      },
    },
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
