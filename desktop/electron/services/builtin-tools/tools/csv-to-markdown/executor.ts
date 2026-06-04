import { readFile } from "node:fs/promises"

import { BuiltinToolError } from "../../errors"
import type { BuiltinToolExecutionContext } from "../../types"
import { assertExtension, outputFromConversionResult } from "../shared/file-to-markdown"
import { csvRowsToMarkdown, parseCsv } from "./csv"
import type { CsvToMarkdownInput, CsvToMarkdownOutput } from "./schema"

export async function executeCsvToMarkdown(
  input: CsvToMarkdownInput,
  _context: BuiltinToolExecutionContext,
): Promise<CsvToMarkdownOutput> {
  assertExtension(input.inputPath, ".csv")
  let raw: string
  try {
    raw = await readFile(input.inputPath, "utf8")
  } catch (error) {
    throw new BuiltinToolError("read_failed", "Could not read CSV file.", { cause: error })
  }

  const parsed = parseCsv(raw, { delimiter: input.delimiter, maxRows: input.maxRows })
  const markdown = csvRowsToMarkdown(parsed.rows)
  const warnings = parsed.truncated ? [{ code: "truncated", message: "CSV rows were truncated by maxRows." }] : []
  return outputFromConversionResult(input, {
    sourcePath: input.inputPath,
    format: "xlsx",
    kind: "spreadsheet",
    title: input.inputPath,
    markdown,
    text: parsed.rows.map((row) => row.join("\t")).join("\n"),
    metadata: { rowCount: parsed.rows.length, delimiter: input.delimiter },
    warnings,
  })
}
