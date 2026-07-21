import type {
  DispatchContext,
  DispatchResult,
} from "../../../synapse-capabilities/shared/types"
import { DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID } from "../shared/capability"
import { documentTextExtractionInputSchema } from "../shared/schema"
import type { DocumentTextExtractorService } from "./service"
import { serializeDocumentTextExtractionError } from "./service"

export type DocumentTextExtractorCapabilityDispatcher = {
  dispatch(
    action: string,
    params: Record<string, unknown>,
    context: DispatchContext,
  ): Promise<DispatchResult>
}

export function createDocumentTextExtractorCapabilityDispatcher(deps: {
  readonly service: DocumentTextExtractorService
}): DocumentTextExtractorCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (action !== DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID) {
        throw new Error(`Unknown document text extractor action: ${action}`)
      }
      const parsed = documentTextExtractionInputSchema.parse(params)
      try {
        const result = await deps.service.extract(parsed, context)
        return { ok: true, data: result, affected: 1 }
      } catch (error) {
        const serialized = serializeDocumentTextExtractionError(error)
        return {
          ok: false,
          code: serialized.code,
          error: serialized.message,
        }
      }
    },
  }
}
