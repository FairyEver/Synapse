import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import { ipcOperationIdToChannel } from "../../../synapse-capabilities/shared/naming"
import type { AgentPersonaService } from "./service"
import {
  agentPersonaBuiltinModelUpdateInputSchema,
  agentPersonaChangedEventSchema,
  agentPersonaCreateInputSchema,
  agentPersonaIdInputSchema,
  agentPersonaListResultSchema,
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
  service.events.on("changed", (result) => {
    windowManager.broadcast(ipcOperationIdToChannel(agentPersonasIpcModule.events.changed.operationId), {
      result,
      items: result.items,
    })
  })
  wiredServices.add(service)
}

export const agentPersonasIpcModule: IpcModule = {
  id: "agentPersonas",
  methods: {
    list: {
      operationId: "app.agent_personas.operation.list",
      kind: "invoke",
      request: z.void(),
      response: agentPersonaListResultSchema,
      handler: (ctx) => resolveAgentPersonaService(ctx).list(),
    },
    create: {
      operationId: "app.agent_personas.operation.create",
      kind: "invoke",
      request: agentPersonaCreateInputSchema,
      response: agentPersonaSchema,
      handler: (ctx, request: z.infer<typeof agentPersonaCreateInputSchema>) =>
        resolveAgentPersonaService(ctx).create(request),
    },
    update: {
      operationId: "app.agent_personas.operation.update",
      kind: "invoke",
      request: agentPersonaUpdateInputSchema,
      response: agentPersonaSchema,
      handler: (ctx, request: z.infer<typeof agentPersonaUpdateInputSchema>) =>
        resolveAgentPersonaService(ctx).update(request),
    },
    updateBuiltinModel: {
      operationId: "app.agent_personas.builtin_model.update",
      kind: "invoke",
      request: agentPersonaBuiltinModelUpdateInputSchema,
      response: agentPersonaSchema,
      handler: (ctx, request: z.infer<typeof agentPersonaBuiltinModelUpdateInputSchema>) =>
        resolveAgentPersonaService(ctx).updateBuiltinModel(request),
    },
    delete: {
      operationId: "app.agent_personas.operation.delete",
      kind: "invoke",
      request: agentPersonaIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof agentPersonaIdInputSchema>) =>
        resolveAgentPersonaService(ctx).delete(request),
    },
  },
  events: {
    changed: {
      operationId: "app.agent_personas.operation.changed",
      kind: "event",
      payload: agentPersonaChangedEventSchema,
    },
  },
}
