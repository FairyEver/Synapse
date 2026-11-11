import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { checkCapabilityPermission } from "../../../electron/capabilities/permission-audit"
import { TunnelAppError, tunnelFailure } from "./cloud-client"
import { tunnelListSchema, tunnelLocatorSchema, tunnelCreateSchema, tunnelUpdateSchema, tunnelEnableSchema, tunnelDeleteSchema } from "../shared/schema"
import type { TunnelAppService } from "./service"
function operation(service: TunnelAppService, action: string, params: Record<string, unknown>): { run: () => Promise<unknown>; id?: string; revision?: number; port?: number } {
  switch (action) {
    case "app.tunnel.mapping.list": { const input = tunnelListSchema.parse(params); return { run: () => service.list(input) } }
    case "app.tunnel.mapping.get": { const { id } = tunnelLocatorSchema.parse(params); return { id, run: () => service.get(id) } }
    case "app.tunnel.mapping.create": { const input = tunnelCreateSchema.parse(params); return { port: input.port, run: () => service.create(input) } }
    case "app.tunnel.mapping.update": { const { id, ...input } = tunnelUpdateSchema.parse(params); return { id, port: input.port, revision: input.expectedRevision, run: () => service.update(id, input) } }
    case "app.tunnel.mapping.set_enabled": { const { id, ...input } = tunnelEnableSchema.parse(params); return { id, revision: input.expectedRevision, run: () => service.setEnabled(id, input) } }
    case "app.tunnel.mapping.delete": { const { id, ...input } = tunnelDeleteSchema.parse(params); return { id, revision: input.expectedRevision, run: () => service.delete(id, input) } }
    default: throw new Error("Unknown tunnel operation")
  }
}
export function createTunnelCapabilityDispatcher(deps: { service: TunnelAppService; permissionGuard?: PermissionGuard; auditSink?: AuditSink }) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      const selected = operation(deps.service, action, params)
      const actor = context.actor ?? { kind: "user" as const, id: "synapse-mcp", display: "Synapse MCP" }
      const metadata = { action, source: context.source ?? "api", id: selected.id, revision: selected.revision }
      const permission = await checkCapabilityPermission({ permissionGuard: deps.permissionGuard, auditSink: deps.auditSink, action: "network.connect", actor, resource: "synapse-tunnel", context: metadata })
      if (permission && !permission.allowed) {
        deps.auditSink?.record({ action: "network.connect", actor, resource: "synapse-tunnel", outcome: "denied", metadata })
        throw new TunnelAppError(403, "TUNNEL_PERMISSION_DENIED", permission.reason)
      }
      const targetPort = selected.port ?? (action === "app.tunnel.mapping.set_enabled" ? (await deps.service.get(selected.id!)).port : undefined)
      if (targetPort !== undefined) {
        const local = await checkCapabilityPermission({ permissionGuard: deps.permissionGuard, auditSink: deps.auditSink, action: "network.connect", actor, resource: `http://localhost:${targetPort}`, context: metadata })
        if (local && !local.allowed) throw new TunnelAppError(403, "TUNNEL_PERMISSION_DENIED", local.reason)
      }
      try {
        const data = await selected.run()
        deps.auditSink?.record({ action: "network.connect", actor, resource: "synapse-tunnel", outcome: "allowed", metadata })
        return { ok: true, data }
      } catch (error) {
        const failure = tunnelFailure(error)
        deps.auditSink?.record({ action: "network.connect", actor, resource: "synapse-tunnel", outcome: "failed", metadata: { ...metadata, status: failure.status, code: failure.code } })
        return { ok: false, code: failure.code, error: failure.message, data: { status: failure.status } }
      }
    },
  }
}
