import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import { connectorChangedEventSchema, connectorIdInputSchema, connectorItemSchema, connectorListResultSchema } from "../shared/schema"
import {
  wecomMailDetailSchema,
  wecomMailGetInputSchema,
  wecomMailSearchInputSchema,
  wecomMailSearchResultSchema,
  wecomMailSendInputSchema,
  wecomMailSendResultSchema,
} from "../shared/wecom-mail"
import type { ReturnTypeOfConnectorsService } from "./service-types"

function service(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): ReturnTypeOfConnectorsService {
  return ctx.resolve<ReturnTypeOfConnectorsService>("core.connectors")
}

const mailSearchRequestSchema = z.object({ id: z.string().min(1), input: wecomMailSearchInputSchema }).strict()
const mailGetRequestSchema = z.object({ id: z.string().min(1), input: wecomMailGetInputSchema }).strict()
const mailSendRequestSchema = z.object({ id: z.string().min(1), input: wecomMailSendInputSchema }).strict()

export const connectorsIpcModule: IpcModule = {
  id: "connectors",
  methods: {
    list: { operationId: "app.connectors.item.list", kind: "invoke", request: z.void(), response: connectorListResultSchema, handler: (ctx) => service(ctx).list() },
    connect: { operationId: "app.connectors.item.connect", kind: "invoke", request: connectorIdInputSchema, response: connectorItemSchema, handler: (ctx, request: z.infer<typeof connectorIdInputSchema>) => service(ctx).connect(request.id) },
    retry: { operationId: "app.connectors.item.retry", kind: "invoke", request: connectorIdInputSchema, response: connectorItemSchema, handler: (ctx, request: z.infer<typeof connectorIdInputSchema>) => service(ctx).retry(request.id) },
    disconnect: { operationId: "app.connectors.item.disconnect", kind: "invoke", request: connectorIdInputSchema, response: z.void(), handler: (ctx, request: z.infer<typeof connectorIdInputSchema>) => service(ctx).disconnect(request.id) },
    mailSearch: { operationId: "app.connectors.mail.search", kind: "invoke", request: mailSearchRequestSchema, response: wecomMailSearchResultSchema, handler: (ctx, request: z.infer<typeof mailSearchRequestSchema>) => service(ctx).mailSearch(request.id, request.input) },
    mailGet: { operationId: "app.connectors.mail.get", kind: "invoke", request: mailGetRequestSchema, response: wecomMailDetailSchema, handler: (ctx, request: z.infer<typeof mailGetRequestSchema>) => service(ctx).mailGet(request.id, request.input) },
    mailSend: { operationId: "app.connectors.mail.send", kind: "invoke", request: mailSendRequestSchema, response: wecomMailSendResultSchema, handler: (ctx, request: z.infer<typeof mailSendRequestSchema>) => service(ctx).mailSend(request.id, request.input) },
  },
  events: { changed: { operationId: "app.connectors.item.changed", kind: "event", payload: connectorChangedEventSchema } },
}
