import { createDefaultFileConversionService } from "../../../file-conversion"
import type { BuiltinToolExecutionContext } from "../../types"
import { assertExtension, mapConversionError, outputFromConversionResult } from "../shared/file-to-markdown"
import type { XlsxToMarkdownInput, XlsxToMarkdownOutput } from "./schema"

export async function executeXlsxToMarkdown(
  input: XlsxToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<XlsxToMarkdownOutput> {
  assertExtension(input.inputPath, ".xlsx")
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
