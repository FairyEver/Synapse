import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import type { SecretsService } from "./service"
import {
  secretCreateInputSchema,
  secretDeleteInputSchema,
  secretGetInputSchema,
  secretListResultSchema,
  secretSafeViewSchema,
  secretUpdateInputSchema,
  secretUpsertInputSchema,
  secretUpsertResultSchema,
  secretValueViewSchema,
  secretsChangedEventSchema,
} from "../shared/schema"

const wiredServices = new WeakSet<SecretsService>()

function resolveSecretsService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): SecretsService {
  const service = ctx.resolve<SecretsService>("core.secrets")
  if (!wiredServices.has(service)) {
    const windowManager = ctx.resolve<WindowManager>("core.window-manager")
    service.events.on("changed", (payload) => {
      windowManager.broadcast(secretsIpcModule.events.changed.channel, payload)
    })
    wiredServices.add(service)
  }
  return service
}

export const secretsIpcModule: IpcModule = {
  id: "secrets",
  methods: {
    list: {
      channel: "synapse:secrets:list",
      kind: "invoke",
      request: z.void(),
      response: secretListResultSchema,
      handler: (ctx) => resolveSecretsService(ctx).list(),
    },
    get: {
      channel: "synapse:secrets:get",
      kind: "invoke",
      request: secretGetInputSchema,
      response: z.union([secretValueViewSchema, secretSafeViewSchema]),
      handler: (ctx, request) => resolveSecretsService(ctx).get(secretGetInputSchema.parse(request)),
    },
    create: {
      channel: "synapse:secrets:create",
      kind: "invoke",
      request: secretCreateInputSchema,
      response: secretSafeViewSchema,
      handler: (ctx, request) => resolveSecretsService(ctx).create(secretCreateInputSchema.parse(request)),
    },
    update: {
      channel: "synapse:secrets:update",
      kind: "invoke",
      request: secretUpdateInputSchema,
      response: secretSafeViewSchema,
      handler: (ctx, request) => resolveSecretsService(ctx).update(secretUpdateInputSchema.parse(request)),
    },
    upsert: {
      channel: "synapse:secrets:upsert",
      kind: "invoke",
      request: secretUpsertInputSchema,
      response: secretUpsertResultSchema,
      handler: (ctx, request) => resolveSecretsService(ctx).upsert(secretUpsertInputSchema.parse(request)),
    },
    delete: {
      channel: "synapse:secrets:delete",
      kind: "invoke",
      request: secretDeleteInputSchema,
      response: secretSafeViewSchema,
      handler: (ctx, request) => resolveSecretsService(ctx).delete(secretDeleteInputSchema.parse(request)),
    },
  },
  events: {
    changed: {
      channel: "synapse:secrets:changed",
      kind: "event",
      payload: secretsChangedEventSchema,
    },
  },
}
