import { readFile } from "node:fs/promises"

import { PDFParse } from "pdf-parse"

import { parserError } from "../errors"
import { normalizeMarkdownTitle } from "../markdown"
import { createUnavailableLocalOcrEngine, localOcrResultMetadata } from "../ocr/local-ocr"
import type { LocalOcrEngine } from "../ocr/types"
import {
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
  readonly localOcrEngine?: LocalOcrEngine
}

export class PdfExtractor implements FileExtractor {
  readonly formats = ["pdf"] as const
  private readonly parsePdf: ParsePdf
  private readonly localOcrEngine: LocalOcrEngine

  constructor(options: PdfExtractorOptions = {}) {
    this.parsePdf = options.parsePdf ?? defaultParsePdf
    this.localOcrEngine = options.localOcrEngine ?? createUnavailableLocalOcrEngine()
  }

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    try {
      const data = await this.parsePdf(await readFile(input.filePath))
      const title = normalizeMarkdownTitle(asString(data.info?.Title), input.filePath)
      const text = data.text.trim()
      if (text.length === 0 && input.ocr?.enabled) {
        return this.extractOcr(input, title, data)
      }
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
      throw parserError("PDF", error)
    }
  }

  private async extractOcr(input: FileConversionInput, title: string, data: PdfParseResult): Promise<FileConversionResult> {
    const ocr = await this.localOcrEngine.recognize({ filePath: input.filePath, mimeType: "application/pdf" })
    const text = ocr.text.trim()
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
        ocr: localOcrResultMetadata(ocr),
      },
      warnings: ocr.warnings ?? [],
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
