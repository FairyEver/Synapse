import path from "node:path"

import * as XLSX from "xlsx"

import { markdownTable, normalizeMarkdownTitle } from "../markdown"
import type { FileConversionInput, FileConversionResult, FileConversionWarning, FileExtractor } from "../types"

export interface XlsxExtractorOptions {
  readonly maxSheets?: number
  readonly maxRowsPerSheet?: number
  readonly maxColumnsPerSheet?: number
}

export class XlsxExtractor implements FileExtractor {
  readonly formats = ["xlsx"] as const

  private readonly maxSheets: number
  private readonly maxRowsPerSheet: number
  private readonly maxColumnsPerSheet: number

  constructor(options: XlsxExtractorOptions = {}) {
    this.maxSheets = options.maxSheets ?? 20
    this.maxRowsPerSheet = options.maxRowsPerSheet ?? 200
    this.maxColumnsPerSheet = options.maxColumnsPerSheet ?? 30
  }

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    const workbook = XLSX.readFile(input.filePath, { cellDates: true })
    const sections: string[] = []
    const warnings: FileConversionWarning[] = []
    const sheetNames = workbook.SheetNames.slice(0, this.maxSheets)
    if (workbook.SheetNames.length > this.maxSheets) {
      warnings.push({
        code: "xlsx_truncated",
        message: `Rendered ${this.maxSheets} of ${workbook.SheetNames.length} sheets.`,
      })
    }
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName]
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: false })
      const rows = rawRows
        .slice(0, this.maxRowsPerSheet + 1)
        .map((row) => row.slice(0, this.maxColumnsPerSheet))
      if (rawRows.length > this.maxRowsPerSheet + 1 || rawRows.some((row) => row.length > this.maxColumnsPerSheet)) {
        warnings.push({
          code: "xlsx_truncated",
          message: `Sheet "${sheetName}" exceeded ${this.maxRowsPerSheet} rows or ${this.maxColumnsPerSheet} columns.`,
        })
      }
      sections.push(`## Sheet: ${sheetName}\n`)
      sections.push(markdownTable(rows))
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
      warnings,
    }
  }
}
