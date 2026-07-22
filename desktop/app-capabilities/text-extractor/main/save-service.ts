import type { TextFileWriterService, TextFileWriteContext } from "../../text-file-writer/main/service"
import { isTextFileWriteError } from "../../text-file-writer/shared/errors"
import { DEFAULT_TEXT_FILE_ENCODING } from "../../text-file-writer/shared/schema"
import { TextSaveError, isTextSaveError } from "../shared/errors"
import { textSaveInputSchema, type TextSaveInput, type TextSaveResult } from "../shared/schema"

export type TextSaveService = {
  save(input: TextSaveInput, context?: TextFileWriteContext): Promise<TextSaveResult>
}

export function createTextSaveService(writer: Pick<TextFileWriterService, "write">): TextSaveService {
  return {
    async save(input, context) {
      const parsed = textSaveInputSchema.parse(input)
      try {
        const result = await writer.write({
          path: parsed.outputPath,
          text: parsed.text,
          encoding: DEFAULT_TEXT_FILE_ENCODING,
          overwrite: true,
        }, context)
        return {
          outputPath: result.path,
          fileName: result.fileName,
          size: result.size,
        }
      } catch (error) {
        throw mapTextFileWriterError(error)
      }
    },
  }
}

export function serializeTextSaveError(error: unknown): {
  readonly code: TextSaveError["code"]
  readonly message: string
} {
  const normalized = isTextSaveError(error)
    ? error
    : new TextSaveError("WRITE_FAILED", { cause: error })
  return { code: normalized.code, message: normalized.message }
}

function mapTextFileWriterError(error: unknown): TextSaveError {
  if (!isTextFileWriteError(error)) return new TextSaveError("WRITE_FAILED", { cause: error })
  if (error.code === "INVALID_PATH" || error.code === "UNSUPPORTED_EXTENSION" || error.code === "INVALID_ENCODING") {
    return new TextSaveError("INVALID_OUTPUT", { cause: error })
  }
  if (error.code === "UNSAFE_TARGET") return new TextSaveError("UNSAFE_OUTPUT_TARGET", { cause: error })
  if (error.code === "TARGET_CHANGED" || error.code === "TARGET_EXISTS") {
    return new TextSaveError("OUTPUT_CHANGED", { cause: error })
  }
  if (error.code === "PERMISSION_DENIED") return new TextSaveError("PERMISSION_DENIED", { cause: error })
  return new TextSaveError("WRITE_FAILED", { cause: error })
}
