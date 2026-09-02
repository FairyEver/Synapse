import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import { connectorChangedEventSchema, connectorIdInputSchema, connectorItemSchema, connectorListResultSchema } from "../shared/schema"
import type { ReturnTypeOfConnectorsService } from "./service-types"

function service(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): ReturnTypeOfConnectorsService {
  return ctx.resolve<ReturnTypeOfConnectorsService>("core.connectors")
}

export const connectorsIpcModule: IpcModule = {
  id: "connectors",
  methods: {
    list: { operationId: "app.connectors.item.list", kind: "invoke", request: z.void(), response: connectorListResultSchema, handler: (ctx) => service(ctx).list() },
    connect: { operationId: "app.connectors.item.connect", kind: "invoke", request: connectorIdInputSchema, response: connectorItemSchema, handler: (ctx, request: z.infer<typeof connectorIdInputSchema>) => service(ctx).connect(request.id) },
    disconnect: { operationId: "app.connectors.item.disconnect", kind: "invoke", request: connectorIdInputSchema, response: z.void(), handler: (ctx, request: z.infer<typeof connectorIdInputSchema>) => service(ctx).disconnect(request.id) },
  },
  events: { changed: { operationId: "app.connectors.item.changed", kind: "event", payload: connectorChangedEventSchema } },
}
