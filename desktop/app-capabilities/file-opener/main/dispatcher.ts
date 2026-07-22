import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import { FILE_OPENER_CAPABILITY_ID } from "../shared/capability"
import { serializeFileOpenerError } from "../shared/errors"
import type { FileOpenerService } from "./service"

export function createFileOpenerCapabilityDispatcher(deps: { readonly service: FileOpenerService }) {
  return {
    async dispatch(
      action: string,
      params: Record<string, unknown>,
      context: DispatchContext,
    ): Promise<DispatchResult> {
      if (action !== FILE_OPENER_CAPABILITY_ID) throw new Error(`Unknown file opener action: ${action}`)
      try {
        const result = await deps.service.open(params as { path: string }, context)
        return { ok: true, data: result, affected: 1 }
      } catch (error) {
        const serialized = serializeFileOpenerError(error)
        return { ok: false, code: serialized.code, error: serialized.message }
      }
    },
  }
}
