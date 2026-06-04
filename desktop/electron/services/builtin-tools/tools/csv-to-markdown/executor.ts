import type { BuiltinToolExecutionContext } from "../../types"
import type { CsvToMarkdownInput, CsvToMarkdownOutput } from "./schema"

export async function executeCsvToMarkdown(
  input: CsvToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<CsvToMarkdownOutput> {
  return {
    markdown: "",
    text: "",
    sourcePath: input.inputPath,
    metadata: {},
    warnings: [],
  }
}

