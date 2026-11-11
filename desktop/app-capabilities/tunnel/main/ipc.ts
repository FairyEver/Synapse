import { z } from "zod"
import type { IpcModule, IpcMethodDescriptor } from "../../../electron/runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import { TUNNEL_SERVICE_ID } from "../shared/capability"
import { tunnelFailure } from "./cloud-client"
import { tunnelListSchema, tunnelLocatorSchema, tunnelCreateSchema, tunnelUpdateSchema, tunnelEnableSchema, tunnelDeleteSchema, tunnelMappingSchema, tunnelPageSchema, tunnelDeletedSchema, tunnelResultSchema } from "../shared/schema"
import type { TunnelAppService } from "./service"
import { createTunnelCapabilityDispatcher } from "./dispatcher"

function method(action: string, request: z.ZodType, result: z.ZodType): IpcMethodDescriptor {
  return {
    operationId: action as IpcMethodDescriptor["operationId"], kind: "invoke", request, response: tunnelResultSchema(result),
    async handler(ctx, input) {
      try {
        const dispatcher = createTunnelCapabilityDispatcher({ service: ctx.resolve<TunnelAppService>(TUNNEL_SERVICE_ID),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"), auditSink: ctx.resolve<AuditSink>("core.audit-sink") })
        const response = await dispatcher.dispatch(action, input as Record<string, unknown>, { source: "api", actor: { kind: "user", id: "tunnel-app" } })
        return response.ok ? { ok: true, data: response.data } : { ok: false, failure: { status: (response.data as { status: number }).status, code: response.code, message: response.error } }
      } catch (error) { return { ok: false, failure: tunnelFailure(error) } }
    },
  }
}
export const tunnelIpcModule: IpcModule = {
  id: "tunnel",
  methods: {
    list: { ...method("app.tunnel.mapping.list", tunnelListSchema, tunnelPageSchema), operationId: "app.tunnel.mapping.list" },
    get: { ...method("app.tunnel.mapping.get", tunnelLocatorSchema, tunnelMappingSchema), operationId: "app.tunnel.mapping.get" },
    create: { ...method("app.tunnel.mapping.create", tunnelCreateSchema, tunnelMappingSchema), operationId: "app.tunnel.mapping.create" },
    update: { ...method("app.tunnel.mapping.update", tunnelUpdateSchema, tunnelMappingSchema), operationId: "app.tunnel.mapping.update" },
    setEnabled: { ...method("app.tunnel.mapping.set_enabled", tunnelEnableSchema, tunnelMappingSchema), operationId: "app.tunnel.mapping.set_enabled" },
    delete: { ...method("app.tunnel.mapping.delete", tunnelDeleteSchema, tunnelDeletedSchema), operationId: "app.tunnel.mapping.delete" },
  },
  events: {},
}
