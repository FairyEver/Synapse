import type {
  DispatchContext,
  DispatchResult,
} from "../../../synapse-capabilities/shared/types"
import { serializeTextFileWriteError } from "../../text-file-writer/shared/errors"
import {
  TEXT_EXTRACTOR_CAPABILITY_ID,
  TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID,
} from "../shared/capability"
import { isTextExtractionError } from "../shared/errors"
import {
  textExtractionInputSchema,
  textExtractionToFileInputSchema,
} from "../shared/schema"
import type { TextExtractionToFileService } from "./extract-to-file-service"
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
  readonly toFileService?: TextExtractionToFileService
}): TextExtractorCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (action === TEXT_EXTRACTOR_CAPABILITY_ID) {
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
      }

      if (action === TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID) {
        const parsed = textExtractionToFileInputSchema.parse(params)
        if (!deps.toFileService) throw new Error("Text extraction to file is unavailable")
        try {
          const result = await deps.toFileService.extractToFile(parsed, context)
          return { ok: true, data: result, affected: 1 }
        } catch (error) {
          const serialized = isTextExtractionError(error)
            ? { ...serializeTextExtractionError(error), retryable: false }
            : serializeTextFileWriteError(error)
          return {
            ok: false,
            code: serialized.code,
            error: serialized.message,
            data: serialized,
          }
        }
      }

      throw new Error(`Unknown text extractor action: ${action}`)
    },
  }
}
