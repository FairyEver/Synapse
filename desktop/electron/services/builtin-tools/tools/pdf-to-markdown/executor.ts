import { createDefaultFileConversionService } from "../../../file-conversion"
import type { BuiltinToolExecutionContext } from "../../types"
import { assertExtension, mapConversionError, outputFromConversionResult } from "../shared/file-to-markdown"
import type { PdfToMarkdownInput, PdfToMarkdownOutput } from "./schema"

export async function executePdfToMarkdown(
  input: PdfToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<PdfToMarkdownOutput> {
  assertExtension(input.inputPath, ".pdf")
  try {
    const result = await createDefaultFileConversionService().convert({
      filePath: input.inputPath,
      preferredOutput: "markdown",
      imageHandling: { mode: "omit" },
    })
    return outputFromConversionResult(input, result)
  } catch (error) {
    throw mapConversionError(error)
  }
}
