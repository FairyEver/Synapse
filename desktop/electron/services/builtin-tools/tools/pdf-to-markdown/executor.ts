import type { BuiltinToolExecutionContext } from "../../types"
import type { PdfToMarkdownInput, PdfToMarkdownOutput } from "./schema"

export async function executePdfToMarkdown(
  input: PdfToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<PdfToMarkdownOutput> {
  return {
    markdown: "",
    text: "",
    sourcePath: input.inputPath,
    metadata: {},
    warnings: [],
  }
}

