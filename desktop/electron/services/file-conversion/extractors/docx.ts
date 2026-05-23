import { createRequire } from "node:module"
import path from "node:path"

import { htmlToMarkdown } from "../html-to-markdown"
import { normalizeMarkdownTitle } from "../markdown"
import { FileConversionError, type FileConversionInput, type FileConversionResult, type FileExtractor } from "../types"

const require = createRequire(__filename)

type MammothMessage = {
  readonly type: string
  readonly message: string
}

type MammothHtmlResult = {
  readonly value: string
  readonly messages: readonly MammothMessage[]
}

type ConvertToHtml = (input: { readonly path: string }) => Promise<MammothHtmlResult>

type MammothModule = {
  readonly convertToHtml: ConvertToHtml
}

export interface DocxExtractorOptions {
  readonly convertToHtml?: ConvertToHtml
}

export class DocxExtractor implements FileExtractor {
  readonly formats = ["docx"] as const
  private readonly convertToHtml: ConvertToHtml

  constructor(options: DocxExtractorOptions = {}) {
    const mammoth = require("mammoth") as MammothModule
    this.convertToHtml = options.convertToHtml ?? mammoth.convertToHtml
  }

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    try {
      const extracted = await this.convertToHtml({ path: input.filePath })
      const markdownBody = htmlToMarkdown(extracted.value)
      const title = extractFirstMarkdownHeading(markdownBody) ?? normalizeMarkdownTitle(path.basename(input.filePath), input.filePath)
      const markdown = markdownBody.startsWith("# ")
        ? `${markdownBody}\n`
        : [`# ${title}`, "", markdownBody, ""].join("\n")
      const text = markdownBody.replace(/^#{1,6}\s+/gm, "").replace(/\|/g, " ").trim()
      return {
        sourcePath: input.filePath,
        format: "docx",
        kind: "document",
        title,
        markdown,
        text,
        metadata: { messages: extracted.messages },
        warnings: extracted.messages.map((message) => ({
          code: message.type,
          message: message.message,
        })),
      }
    } catch (error) {
      throw new FileConversionError("parse_failed", "Could not parse DOCX file.", { cause: error })
    }
  }
}

function extractFirstMarkdownHeading(markdown: string): string | null {
  const match = /^#\s+(.+)$/m.exec(markdown)
  return match?.[1]?.trim() || null
}
