import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import type { AgentPersonaService } from "./service"
import {
  agentPersonaBuiltinModelUpdateInputSchema,
  agentPersonaChangedEventSchema,
  agentPersonaCreateInputSchema,
  agentPersonaIdInputSchema,
  agentPersonaSchema,
  agentPersonaUpdateInputSchema,
} from "../shared/schema"

const wiredServices = new WeakSet<AgentPersonaService>()

function resolveAgentPersonaService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): AgentPersonaService {
  const service = ctx.resolve<AgentPersonaService>("core.agent-personas")
  wireAgentPersonaEvents(ctx, service)
  return service
}

function wireAgentPersonaEvents(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
  service: AgentPersonaService,
): void {
  if (wiredServices.has(service)) return

  const windowManager = ctx.resolve<WindowManager>("core.window-manager")
  service.events.on("changed", (payload) => {
    windowManager.broadcast(agentPersonasIpcModule.events.changed.channel, payload)
  })
  wiredServices.add(service)
}

export const agentPersonasIpcModule: IpcModule = {
  id: "agentPersonas",
  methods: {
    list: {
      channel: "synapse:agent-personas:list",
      kind: "invoke",
      request: z.void(),
      response: z.array(agentPersonaSchema),
      handler: (ctx) => resolveAgentPersonaService(ctx).list(),
    },
    create: {
      channel: "synapse:agent-personas:create",
      kind: "invoke",
      request: agentPersonaCreateInputSchema,
      response: agentPersonaSchema,
      handler: (ctx, request: z.infer<typeof agentPersonaCreateInputSchema>) =>
        resolveAgentPersonaService(ctx).create(request),
    },
    update: {
      channel: "synapse:agent-personas:update",
      kind: "invoke",
      request: agentPersonaUpdateInputSchema,
      response: agentPersonaSchema,
      handler: (ctx, request: z.infer<typeof agentPersonaUpdateInputSchema>) =>
        resolveAgentPersonaService(ctx).update(request),
    },
    updateBuiltinModel: {
      channel: "synapse:agent-personas:builtin-model:update",
      kind: "invoke",
      request: agentPersonaBuiltinModelUpdateInputSchema,
      response: agentPersonaSchema,
      handler: (ctx, request: z.infer<typeof agentPersonaBuiltinModelUpdateInputSchema>) =>
        resolveAgentPersonaService(ctx).updateBuiltinModel(request),
    },
    delete: {
      channel: "synapse:agent-personas:delete",
      kind: "invoke",
      request: agentPersonaIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof agentPersonaIdInputSchema>) =>
        resolveAgentPersonaService(ctx).delete(request),
    },
  },
  events: {
    changed: {
      channel: "synapse:agent-personas:changed",
      kind: "event",
      payload: agentPersonaChangedEventSchema,
    },
  },
}
