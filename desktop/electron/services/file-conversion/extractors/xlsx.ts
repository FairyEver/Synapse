import path from "node:path"

import * as XLSX from "xlsx"

import { markdownTable, normalizeMarkdownTitle } from "../markdown"
import type { FileConversionInput, FileConversionResult, FileExtractor } from "../types"

export class XlsxExtractor implements FileExtractor {
  readonly formats = ["xlsx"] as const

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    const workbook = XLSX.readFile(input.filePath, { cellDates: true })
    const sections: string[] = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: false })
      sections.push(`## Sheet: ${sheetName}\n`)
      sections.push(markdownTable(rows.slice(0, 201)))
    }
    const title = normalizeMarkdownTitle(path.basename(input.filePath), input.filePath)
    const markdown = [`# ${title}`, "", ...sections].join("\n")
    return {
      sourcePath: input.filePath,
      format: "xlsx",
      kind: "spreadsheet",
      title,
      markdown,
      text: sections.join("\n"),
      metadata: { sheetNames: workbook.SheetNames },
      warnings: [],
    }
  }
}
