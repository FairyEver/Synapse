import type {
  DispatchContext,
  DispatchResult,
} from "../../../synapse-capabilities/shared/types"
import { mcpClientActorForSource } from "../../../synapse-capabilities/shared/types"
import { JSON_REPAIR_CAPABILITY_ID } from "../shared/capability"
import {
  createJsonRepairErrorPayload,
  serializeJsonRepairError,
} from "../shared/errors"
import { validateJsonRepairInput } from "../shared/schema"
import type { JsonRepairService } from "./service"

export type JsonRepairCapabilityDispatcher = {
  dispatch(
    action: string,
    params: Record<string, unknown>,
    context: DispatchContext,
  ): Promise<DispatchResult>
}

export function createJsonRepairCapabilityDispatcher(deps: {
  readonly service: Pick<JsonRepairService, "repair">
}): JsonRepairCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (action !== JSON_REPAIR_CAPABILITY_ID) {
        throw new Error(`Unknown JSON repair action: ${action}`)
      }
      if (context.source !== "mcp-http") {
        throw new Error("JSON repair MCP entry requires a trusted MCP source.")
      }

      const validation = validateJsonRepairInput(params)
      if (!validation.ok) {
        return {
          ok: false,
          code: validation.error.code,
          error: validation.error.message,
          data: validation.error,
        }
      }
      if (context.abortSignal?.aborted) {
        const error = createJsonRepairErrorPayload("CANCELLED")
        return { ok: false, code: error.code, error: error.message, data: error }
      }

      try {
        const result = deps.service.repair(validation.data, {
          source: context.source,
          actor: context.actor ?? mcpClientActorForSource(context.source),
          ...(context.clientId ? { clientId: context.clientId } : {}),
          ...(context.controllerInstanceId
            ? { controllerInstanceId: context.controllerInstanceId }
            : {}),
        })
        return { ok: true, data: result }
      } catch (cause) {
        const error = serializeJsonRepairError(cause)
        return { ok: false, code: error.code, error: error.message, data: error }
      }
    },
  }
}
