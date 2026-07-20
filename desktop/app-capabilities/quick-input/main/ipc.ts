import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import { ipcOperationIdToChannel } from "../../../synapse-capabilities/shared/naming"
import type { QuickInputService } from "./service"
import {
  quickInputChangedEventSchema,
  quickInputCreateInputSchema,
  quickInputIdInputSchema,
  quickInputItemSchema,
  quickInputUpdateInputSchema,
} from "../shared/schema"

const quickInputEventWiredServices = new WeakSet<QuickInputService>()

function resolveQuickInputService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): QuickInputService {
  const service = ctx.resolve<QuickInputService>("core.quick-input")
  wireQuickInputEvents(ctx, service)
  return service
}

function wireQuickInputEvents(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
  service: QuickInputService,
): void {
  if (quickInputEventWiredServices.has(service)) return

  const windowManager = ctx.resolve<WindowManager>("core.window-manager")
  service.events.on("changed", (payload) => {
    windowManager.broadcast(ipcOperationIdToChannel(quickInputIpcModule.events.changed.operationId), payload)
  })
  quickInputEventWiredServices.add(service)
}

export const quickInputIpcModule: IpcModule = {
  id: "quick-input",
  methods: {
    list: {
      operationId: "app.quick_input.item.list",
      kind: "invoke",
      request: z.void(),
      response: z.array(quickInputItemSchema),
      handler: (ctx) => resolveQuickInputService(ctx).list(),
    },
    create: {
      operationId: "app.quick_input.item.create",
      kind: "invoke",
      request: quickInputCreateInputSchema,
      response: quickInputItemSchema,
      handler: (ctx, request: z.infer<typeof quickInputCreateInputSchema>) =>
        resolveQuickInputService(ctx).create(request),
    },
    update: {
      operationId: "app.quick_input.item.update",
      kind: "invoke",
      request: quickInputUpdateInputSchema,
      response: quickInputItemSchema,
      handler: (ctx, request: z.infer<typeof quickInputUpdateInputSchema>) =>
        resolveQuickInputService(ctx).update(request),
    },
    delete: {
      operationId: "app.quick_input.item.delete",
      kind: "invoke",
      request: quickInputIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof quickInputIdInputSchema>) =>
        resolveQuickInputService(ctx).delete(request),
    },
  },
  events: {
    changed: {
      operationId: "app.quick_input.item.changed",
      kind: "event",
      payload: quickInputChangedEventSchema,
    },
  },
}
