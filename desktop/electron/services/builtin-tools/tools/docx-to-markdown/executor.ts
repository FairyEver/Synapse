import { createDefaultFileConversionService } from "../../../file-conversion"
import type { BuiltinToolExecutionContext } from "../../types"
import { assertExtension, mapConversionError, outputFromConversionResult } from "../shared/file-to-markdown"
import type { DocxToMarkdownInput, DocxToMarkdownOutput } from "./schema"

export async function executeDocxToMarkdown(
  input: DocxToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<DocxToMarkdownOutput> {
  assertExtension(input.inputPath, ".docx")
  try {
    const result = await createDefaultFileConversionService().convert({
      filePath: input.inputPath,
      preferredOutput: "markdown",
      imageHandling: { mode: "assets", assetDirectoryName: "assets" },
    })
    return outputFromConversionResult(input, result)
  } catch (error) {
    throw mapConversionError(error)
  }
}
