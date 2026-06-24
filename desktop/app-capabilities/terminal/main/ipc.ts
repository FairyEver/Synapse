import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import type { TerminalService } from "./service"
import {
  terminalCreateGroupInputSchema,
  terminalCreateSessionInputSchema,
  terminalDeleteGroupInputSchema,
  terminalDeleteSessionInputSchema,
  terminalGroupSchema,
  terminalOutputChunkSchema,
  terminalReadSessionInputSchema,
  terminalReadSessionResultSchema,
  terminalRenameGroupInputSchema,
  terminalRenameSessionInputSchema,
  terminalResizeSessionInputSchema,
  terminalSessionIdInputSchema,
  terminalSessionSchema,
  terminalStopSessionInputSchema,
  terminalWriteSessionInputSchema,
} from "../shared/schema"

const terminalDataEventPayloadSchema = z.object({
  sessionId: z.string().min(1),
  chunk: terminalOutputChunkSchema,
})

const terminalSessionDeletedEventPayloadSchema = z.object({
  sessionId: z.string().min(1),
})

const terminalEventWiredServices = new WeakSet<TerminalService>()

function resolveTerminalService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): TerminalService {
  const service = ctx.resolve<TerminalService>("core.terminal")
  wireTerminalEvents(ctx, service)
  return service
}

function wireTerminalEvents(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
  service: TerminalService,
): void {
  if (terminalEventWiredServices.has(service)) return

  const windowManager = ctx.resolve<WindowManager>("core.window-manager")
  service.events.on("data", (payload) => {
    windowManager.broadcast(terminalIpcModule.events.data.channel, payload)
  })
  service.events.on("sessionChanged", (payload) => {
    windowManager.broadcast(terminalIpcModule.events.sessionChanged.channel, payload)
  })
  service.events.on("sessionDeleted", (payload) => {
    windowManager.broadcast(terminalIpcModule.events.sessionDeleted.channel, payload)
  })
  terminalEventWiredServices.add(service)
}

export const terminalIpcModule: IpcModule = {
  id: "terminal",
  methods: {
    listGroups: {
      channel: "synapse:terminal:group:list",
      kind: "invoke",
      request: z.void(),
      response: z.array(terminalGroupSchema),
      handler: (ctx) => resolveTerminalService(ctx).listGroups(),
    },
    createGroup: {
      channel: "synapse:terminal:group:create",
      kind: "invoke",
      request: terminalCreateGroupInputSchema,
      response: terminalGroupSchema,
      handler: (ctx, request: z.infer<typeof terminalCreateGroupInputSchema>) =>
        resolveTerminalService(ctx).createGroup(request),
    },
    renameGroup: {
      channel: "synapse:terminal:group:rename",
      kind: "invoke",
      request: terminalRenameGroupInputSchema,
      response: terminalGroupSchema,
      handler: (ctx, request: z.infer<typeof terminalRenameGroupInputSchema>) =>
        resolveTerminalService(ctx).renameGroup(request),
    },
    deleteGroup: {
      channel: "synapse:terminal:group:delete",
      kind: "invoke",
      request: terminalDeleteGroupInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalDeleteGroupInputSchema>) =>
        resolveTerminalService(ctx).deleteGroup(request),
    },
    listSessions: {
      channel: "synapse:terminal:session:list",
      kind: "invoke",
      request: z.void(),
      response: z.array(terminalSessionSchema),
      handler: (ctx) => resolveTerminalService(ctx).listSessions(),
    },
    createSession: {
      channel: "synapse:terminal:session:create",
      kind: "invoke",
      request: terminalCreateSessionInputSchema,
      response: terminalSessionSchema,
      handler: (ctx, request: z.infer<typeof terminalCreateSessionInputSchema>) =>
        resolveTerminalService(ctx).createSession(request),
    },
    getSession: {
      channel: "synapse:terminal:session:get",
      kind: "invoke",
      request: terminalSessionIdInputSchema,
      response: terminalSessionSchema,
      handler: (ctx, request: z.infer<typeof terminalSessionIdInputSchema>) =>
        resolveTerminalService(ctx).getSession(request),
    },
    readSession: {
      channel: "synapse:terminal:session:read",
      kind: "invoke",
      request: terminalReadSessionInputSchema,
      response: terminalReadSessionResultSchema,
      handler: (ctx, request: z.infer<typeof terminalReadSessionInputSchema>) =>
        resolveTerminalService(ctx).readSession(request),
    },
    renameSession: {
      channel: "synapse:terminal:session:rename",
      kind: "invoke",
      request: terminalRenameSessionInputSchema,
      response: terminalSessionSchema,
      handler: (ctx, request: z.infer<typeof terminalRenameSessionInputSchema>) =>
        resolveTerminalService(ctx).renameSession(request),
    },
    writeSession: {
      channel: "synapse:terminal:session:write",
      kind: "invoke",
      request: terminalWriteSessionInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalWriteSessionInputSchema>) =>
        resolveTerminalService(ctx).writeSession(request),
    },
    resizeSession: {
      channel: "synapse:terminal:session:resize",
      kind: "invoke",
      request: terminalResizeSessionInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalResizeSessionInputSchema>) =>
        resolveTerminalService(ctx).resizeSession(request),
    },
    deleteSession: {
      channel: "synapse:terminal:session:delete",
      kind: "invoke",
      request: terminalDeleteSessionInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalDeleteSessionInputSchema>) =>
        resolveTerminalService(ctx).deleteSession(request),
    },
    stopSession: {
      channel: "synapse:terminal:session:stop",
      kind: "invoke",
      request: terminalStopSessionInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalStopSessionInputSchema>) =>
        resolveTerminalService(ctx).stopSession(request),
    },
  },
  events: {
    data: {
      channel: "synapse:terminal:data",
      kind: "event",
      payload: terminalDataEventPayloadSchema,
    },
    sessionChanged: {
      channel: "synapse:terminal:session-changed",
      kind: "event",
      payload: terminalSessionSchema,
    },
    sessionDeleted: {
      channel: "synapse:terminal:session-deleted",
      kind: "event",
      payload: terminalSessionDeletedEventPayloadSchema,
    },
  },
}
