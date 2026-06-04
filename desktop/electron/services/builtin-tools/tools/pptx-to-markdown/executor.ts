import type { BuiltinToolExecutionContext } from "../../types"
import type { PptxToMarkdownInput, PptxToMarkdownOutput } from "./schema"

export async function executePptxToMarkdown(
  input: PptxToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<PptxToMarkdownOutput> {
  return {
    markdown: "",
    text: "",
    sourcePath: input.inputPath,
    metadata: {},
    warnings: [],
  }
}

