import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import { TEXT_FILE_WRITER_CAPABILITY_ID } from "../shared/capability"
import { serializeTextFileWriteError } from "../shared/errors"
import type { TextFileWriterService } from "./service"

export function createTextFileWriterCapabilityDispatcher(deps: {
  readonly service: TextFileWriterService
}) {
  return {
    async dispatch(
      action: string,
      params: Record<string, unknown>,
      context: DispatchContext,
    ): Promise<DispatchResult> {
      if (action !== TEXT_FILE_WRITER_CAPABILITY_ID) {
        throw new Error(`Unknown text file writer action: ${action}`)
      }
      try {
        const result = await deps.service.write(params as never, {
          actor: context.actor,
          source: context.source,
        })
        return { ok: true, data: result, affected: 1 }
      } catch (error) {
        const serialized = serializeTextFileWriteError(error)
        return {
          ok: false,
          code: serialized.code,
          error: serialized.message,
          data: serialized,
        }
      }
    },
  }
}
