import { createDefaultFileConversionService } from "../../../file-conversion"
import { resolveUniqueMarkdownOutputBundle } from "../../../tools/file-conversion-output"
import type { BuiltinToolExecutionContext } from "../../types"
import { assertExtension, mapConversionError, outputFromConversionResult } from "../shared/file-to-markdown"
import type { DocxToMarkdownInput, DocxToMarkdownOutput } from "./schema"

export async function executeDocxToMarkdown(
  input: DocxToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<DocxToMarkdownOutput> {
  assertExtension(input.inputPath, ".docx")
  try {
    const outputBundle = input.outputMode === "write-file" && !input.outputPath && input.outputDirectory
      ? await resolveUniqueMarkdownOutputBundle(input.outputDirectory, input.inputPath, new Set())
      : undefined
    const result = await createDefaultFileConversionService().convert({
      filePath: input.inputPath,
      preferredOutput: "markdown",
      imageHandling: { mode: "assets", assetDirectoryName: outputBundle?.assetDirectoryName ?? "assets" },
    })
    return outputFromConversionResult(input, result, { outputBundle })
  } catch (error) {
    throw mapConversionError(error)
  }
}
