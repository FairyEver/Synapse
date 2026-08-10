import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import {
  HTML_GENERATOR_EJS_CAPABILITY_ID,
  HTML_GENERATOR_EJS_FILE_CAPABILITY_ID,
} from "../shared/capability"
import { serializeHtmlGenerationError } from "../shared/errors"
import { serializeTextFileWriteError, isTextFileWriteError } from "../../text-file-writer/shared/errors"
import type { HtmlGenerationToFileService } from "./file-service"
import type { HtmlGenerationService } from "./service"

export function createHtmlGeneratorCapabilityDispatcher(deps: {
  readonly generator: HtmlGenerationService
  readonly fileGenerator: HtmlGenerationToFileService
}) {
  return {
    async dispatch(
      action: string,
      params: Record<string, unknown>,
      context: DispatchContext,
    ): Promise<DispatchResult> {
      try {
        if (action === HTML_GENERATOR_EJS_CAPABILITY_ID) {
          const result = await deps.generator.generate(params as never, {
            actor: context.actor,
            source: context.source,
            abortSignal: context.abortSignal,
          })
          return { ok: true, data: result }
        }
        if (action === HTML_GENERATOR_EJS_FILE_CAPABILITY_ID) {
          const result = await deps.fileGenerator.generateToFile(params as never, {
            actor: context.actor,
            source: context.source,
            abortSignal: context.abortSignal,
          })
          return { ok: true, data: result, affected: 1 }
        }
        throw new Error(`Unknown HTML generator action: ${action}`)
      } catch (error) {
        const serialized = isTextFileWriteError(error)
          ? serializeTextFileWriteError(error)
          : serializeHtmlGenerationError(error)
        return { ok: false, code: serialized.code, error: serialized.message, data: serialized }
      }
    },
  }
}
