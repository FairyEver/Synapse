import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import type { TerminalService } from "./service"
import {
  terminalCreateGroupInputSchema,
  terminalCreateSessionInputSchema,
  terminalGroupSchema,
  terminalOutputChunkSchema,
  terminalReadSessionInputSchema,
  terminalReadSessionResultSchema,
  terminalResizeSessionInputSchema,
  terminalSessionIdInputSchema,
  terminalSessionSchema,
  terminalStopSessionInputSchema,
  terminalWriteSessionInputSchema,
} from "../shared/schema"

const terminalSetAgentControlInputSchema = z.object({
  sessionId: z.string().min(1),
  enabled: z.boolean(),
}).strict()

const terminalDataEventPayloadSchema = z.object({
  sessionId: z.string().min(1),
  chunk: terminalOutputChunkSchema,
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
    writeSession: {
      channel: "synapse:terminal:session:write",
      kind: "invoke",
      request: terminalWriteSessionInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalWriteSessionInputSchema>) =>
        resolveTerminalService(ctx).writeSession({ ...request, actor: "user" }),
    },
    resizeSession: {
      channel: "synapse:terminal:session:resize",
      kind: "invoke",
      request: terminalResizeSessionInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalResizeSessionInputSchema>) =>
        resolveTerminalService(ctx).resizeSession(request),
    },
    setAgentControl: {
      channel: "synapse:terminal:session:agent-control",
      kind: "invoke",
      request: terminalSetAgentControlInputSchema,
      response: terminalSessionSchema,
      handler: (ctx, request: z.infer<typeof terminalSetAgentControlInputSchema>) =>
        resolveTerminalService(ctx).setAgentControl(request),
    },
    stopSession: {
      channel: "synapse:terminal:session:stop",
      kind: "invoke",
      request: terminalStopSessionInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof terminalStopSessionInputSchema>) =>
        resolveTerminalService(ctx).stopSession({ ...request, actor: "user" }),
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
  },
}
