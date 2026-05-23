import { createRequire } from "node:module"
import path from "node:path"

import { normalizeMarkdownTitle } from "../markdown"
import { FileConversionError, type FileConversionInput, type FileConversionResult, type FileExtractor } from "../types"

const require = createRequire(__filename)

type MammothMessage = {
  readonly type: string
  readonly message: string
}

type MammothRawTextResult = {
  readonly value: string
  readonly messages: readonly MammothMessage[]
}

type ExtractRawText = (input: { readonly path: string }) => Promise<MammothRawTextResult>

type MammothModule = {
  readonly extractRawText: ExtractRawText
}

export interface DocxExtractorOptions {
  readonly extractRawText?: ExtractRawText
}

export class DocxExtractor implements FileExtractor {
  readonly formats = ["docx"] as const
  private readonly extractRawText: ExtractRawText

  constructor(options: DocxExtractorOptions = {}) {
    const mammoth = require("mammoth") as MammothModule
    this.extractRawText = options.extractRawText ?? mammoth.extractRawText
  }

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    try {
      const extracted = await this.extractRawText({ path: input.filePath })
      const title = normalizeMarkdownTitle(path.basename(input.filePath), input.filePath)
      const text = extracted.value.trim()
      return {
        sourcePath: input.filePath,
        format: "docx",
        kind: "document",
        title,
        markdown: [`# ${title}`, "", text, ""].join("\n"),
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
