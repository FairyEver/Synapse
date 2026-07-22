import type {
  DispatchContext,
  DispatchResult,
} from "../../../synapse-capabilities/shared/types"
import { TEXT_EXTRACTOR_CAPABILITY_ID } from "../shared/capability"
import { textExtractionInputSchema } from "../shared/schema"
import type { TextExtractorService } from "./service"
import { serializeTextExtractionError } from "./service"

export type TextExtractorCapabilityDispatcher = {
  dispatch(
    action: string,
    params: Record<string, unknown>,
    context: DispatchContext,
  ): Promise<DispatchResult>
}

export function createTextExtractorCapabilityDispatcher(deps: {
  readonly service: TextExtractorService
}): TextExtractorCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (action !== TEXT_EXTRACTOR_CAPABILITY_ID) {
        throw new Error(`Unknown text extractor action: ${action}`)
      }
      const parsed = textExtractionInputSchema.parse(params)
      try {
        const result = await deps.service.extract(parsed, context)
        return { ok: true, data: result, affected: 1 }
      } catch (error) {
        const serialized = serializeTextExtractionError(error)
        return {
          ok: false,
          code: serialized.code,
          error: serialized.message,
        }
      }
    },
  }
}
