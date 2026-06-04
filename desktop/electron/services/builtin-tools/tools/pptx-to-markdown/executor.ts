import { createDefaultFileConversionService } from "../../../file-conversion"
import type { BuiltinToolExecutionContext } from "../../types"
import { assertExtension, mapConversionError, outputFromConversionResult } from "../shared/file-to-markdown"
import type { PptxToMarkdownInput, PptxToMarkdownOutput } from "./schema"

export async function executePptxToMarkdown(
  input: PptxToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<PptxToMarkdownOutput> {
  assertExtension(input.inputPath, ".pptx")
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
