import path from "node:path"

import * as XLSX from "xlsx"

import { parserError } from "../errors"
import { markdownTable, normalizeMarkdownTitle } from "../markdown"
import type { FileConversionInput, FileConversionResult, FileConversionWarning, FileExtractor } from "../types"

type ParseWorkbook = (filePath: string) => XLSX.WorkBook

export interface XlsxExtractorOptions {
  readonly maxSheets?: number
  readonly maxRowsPerSheet?: number
  readonly maxColumnsPerSheet?: number
  readonly parseWorkbook?: ParseWorkbook
}

export class XlsxExtractor implements FileExtractor {
  readonly formats = ["xlsx"] as const

  private readonly maxSheets: number
  private readonly maxRowsPerSheet: number
  private readonly maxColumnsPerSheet: number
  private readonly parseWorkbook: ParseWorkbook

  constructor(options: XlsxExtractorOptions = {}) {
    this.maxSheets = options.maxSheets ?? 20
    this.maxRowsPerSheet = options.maxRowsPerSheet ?? 200
    this.maxColumnsPerSheet = options.maxColumnsPerSheet ?? 30
    this.parseWorkbook = options.parseWorkbook ?? defaultParseWorkbook
  }

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    try {
      const workbook = this.parseWorkbook(input.filePath)
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
        const boundedRange = boundedSheetRange(sheet, this.maxRowsPerSheet, this.maxColumnsPerSheet)
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: false,
          blankrows: false,
          ...(boundedRange.range ? { range: boundedRange.range } : undefined),
        })
        if (boundedRange.truncated) {
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
    } catch (error) {
      throw parserError("XLSX", error)
    }
  }
}

function defaultParseWorkbook(filePath: string): XLSX.WorkBook {
  return XLSX.readFile(filePath, { cellDates: true })
}

function boundedSheetRange(
  sheet: XLSX.WorkSheet | undefined,
  maxRowsPerSheet: number,
  maxColumnsPerSheet: number,
): { range?: string; truncated: boolean } {
  const ref = sheet?.["!ref"]
  if (!ref) return { truncated: false }

  const decoded = XLSX.utils.decode_range(ref)
  const maxMaterializedRows = maxRowsPerSheet + 1
  const originalRows = decoded.e.r - decoded.s.r + 1
  const originalColumns = decoded.e.c - decoded.s.c + 1
  const bounded = {
    s: decoded.s,
    e: {
      r: Math.min(decoded.e.r, decoded.s.r + maxMaterializedRows - 1),
      c: Math.min(decoded.e.c, decoded.s.c + maxColumnsPerSheet - 1),
    },
  }

  return {
    range: XLSX.utils.encode_range(bounded),
    truncated: originalRows > maxMaterializedRows || originalColumns > maxColumnsPerSheet,
  }
}
