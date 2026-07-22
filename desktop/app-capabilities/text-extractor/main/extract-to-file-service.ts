import type { DispatchContext } from "../../../synapse-capabilities/shared/types"
import type { TextFileWriterService } from "../../text-file-writer/main/service"
import { TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID } from "../shared/capability"
import type {
  TextExtractionResult,
  TextExtractionToFileInput,
  TextExtractionToFileResult,
} from "../shared/schema"
import { textExtractionToFileInputSchema } from "../shared/schema"
import type { TextExtractorService } from "./service"

export type TextExtractionToFileService = {
  extractToFile(
    input: TextExtractionToFileInput,
    context?: DispatchContext,
  ): Promise<TextExtractionToFileResult>
}

export function createTextExtractionToFileService(deps: {
  readonly extractor: Pick<TextExtractorService, "extract">
  readonly writer: Pick<TextFileWriterService, "write">
}): TextExtractionToFileService {
  return {
    async extractToFile(input, context = {}) {
      const parsed = textExtractionToFileInputSchema.parse(input)
      const extracted = await deps.extractor.extract({ filePath: parsed.filePath }, context)
      const output = await deps.writer.write({
        path: parsed.outputPath,
        text: extracted.text,
        encoding: parsed.encoding,
        overwrite: parsed.overwrite,
      }, {
        actor: context.actor,
        source: context.source,
        metadata: { parentCapability: TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID },
      })

      return {
        source: sourceMetadata(extracted),
        output,
      }
    },
  }
}

function sourceMetadata(
  result: TextExtractionResult,
): TextExtractionToFileResult["source"] {
  const common = {
    fileName: result.fileName,
    size: result.size,
  }
  return result.format === "pdf"
    ? { ...common, format: result.format, ...(result.pages === undefined ? {} : { pages: result.pages }) }
    : { ...common, format: result.format }
}
