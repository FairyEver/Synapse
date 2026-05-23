import { readFile } from "node:fs/promises"

import { PDFParse } from "pdf-parse"

import { normalizeMarkdownTitle } from "../markdown"
import {
  FileConversionError,
  type FileConversionInput,
  type FileConversionResult,
  type FileConversionWarning,
  type FileExtractor,
} from "../types"

type PdfParseResult = {
  readonly text: string
  readonly numpages?: number
  readonly total?: number
  readonly info?: Record<string, unknown>
}

type ParsePdf = (buffer: Buffer) => Promise<PdfParseResult>

type PdfParserInstance = {
  getText(): Promise<{ readonly text: string; readonly total?: number }>
  getInfo(options?: { readonly parsePageInfo?: boolean }): Promise<{ readonly total?: number; readonly info?: Record<string, unknown> }>
  destroy(): Promise<void> | void
}

type PdfParserConstructor = new (input: { readonly data: Buffer }) => PdfParserInstance

export interface PdfExtractorOptions {
  readonly parsePdf?: ParsePdf
}

export class PdfExtractor implements FileExtractor {
  readonly formats = ["pdf"] as const
  private readonly parsePdf: ParsePdf

  constructor(options: PdfExtractorOptions = {}) {
    this.parsePdf = options.parsePdf ?? defaultParsePdf
  }

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    try {
      const data = await this.parsePdf(await readFile(input.filePath))
      const title = normalizeMarkdownTitle(asString(data.info?.Title), input.filePath)
      const text = data.text.trim()
      const warnings: FileConversionWarning[] = []
      if (text.length === 0) {
        warnings.push({
          code: "empty_extraction",
          message: "PDF parser returned no text.",
        })
      }
      return {
        sourcePath: input.filePath,
        format: "pdf",
        kind: "pdf",
        title,
        markdown: [`# ${title}`, "", text, ""].join("\n"),
        text,
        metadata: {
          pages: data.numpages ?? data.total,
          info: data.info ?? {},
        },
        warnings,
      }
    } catch (error) {
      throw new FileConversionError("parse_failed", "Could not parse PDF file.", { cause: error })
    }
  }
}

async function defaultParsePdf(buffer: Buffer): Promise<PdfParseResult> {
  const Parser = PDFParse as unknown as PdfParserConstructor
  const parser = new Parser({ data: buffer })
  try {
    const [text, info] = await Promise.all([
      parser.getText(),
      parser.getInfo({ parsePageInfo: false }).catch(() => ({ total: undefined, info: {} })),
    ])
    return {
      text: text.text,
      total: text.total ?? info.total,
      info: info.info,
    }
  } finally {
    await parser.destroy()
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
