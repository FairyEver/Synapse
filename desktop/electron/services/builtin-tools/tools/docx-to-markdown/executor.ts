import type { BuiltinToolExecutionContext } from "../../types"
import type { DocxToMarkdownInput, DocxToMarkdownOutput } from "./schema"

export async function executeDocxToMarkdown(
  input: DocxToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<DocxToMarkdownOutput> {
  return {
    markdown: "",
    text: "",
    sourcePath: input.inputPath,
    metadata: {},
    warnings: [],
  }
}

