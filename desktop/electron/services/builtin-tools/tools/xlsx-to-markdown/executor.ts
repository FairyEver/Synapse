import type { BuiltinToolExecutionContext } from "../../types"
import type { XlsxToMarkdownInput, XlsxToMarkdownOutput } from "./schema"

export async function executeXlsxToMarkdown(
  input: XlsxToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<XlsxToMarkdownOutput> {
  return {
    markdown: "",
    text: "",
    sourcePath: input.inputPath,
    metadata: {},
    warnings: [],
  }
}

