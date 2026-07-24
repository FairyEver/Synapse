import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import { JSON_REPAIR_SERVICE_ID } from "../shared/capability"
import {
  createJsonRepairErrorPayload,
  serializeJsonRepairError,
} from "../shared/errors"
import {
  jsonRepairResponseSchema,
  validateJsonRepairInput,
} from "../shared/schema"
import type { JsonRepairService } from "./service"

export const jsonRepairIpcModule: IpcModule = {
  id: "jsonRepair",
  methods: {
    repairText: {
      operationId: "app.json_repair.text.repair",
      kind: "invoke",
      request: z.unknown(),
      response: jsonRepairResponseSchema,
      handler: (ctx, request) => {
        const validation = validateJsonRepairInput(request)
        if (!validation.ok) return { ok: false as const, error: validation.error }
        if (ctx.sender?.isDestroyed()) {
          return {
            ok: false as const,
            error: createJsonRepairErrorPayload("CANCELLED"),
          }
        }
        try {
          const service = ctx.resolve<JsonRepairService>(JSON_REPAIR_SERVICE_ID)
          const result = service.repair(validation.data, {
            source: "app.ui",
            actor: { kind: "user", id: "system-app:json-repair" },
          })
          return { ok: true as const, result }
        } catch (error) {
          return { ok: false as const, error: serializeJsonRepairError(error) }
        }
      },
    },
  },
  events: {},
}
