import { FileConversionError, type FileConversionErrorCode } from "./types"

const ENCRYPTED_MESSAGE_PATTERN = /password|encrypted|decrypt/i

export function parserError(formatLabel: string, error: unknown): FileConversionError {
  const detail = errorMessage(error)
  const code: FileConversionErrorCode = ENCRYPTED_MESSAGE_PATTERN.test(detail) ? "encrypted" : "parse_failed"
  return new FileConversionError(code, `Could not parse ${formatLabel} file: ${detail}`, { cause: error })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim()
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim()
  }
  return "Unknown parser error."
}
