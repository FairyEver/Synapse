import path from "node:path"

import { OfficeParser } from "officeparser"

import { normalizeMarkdownTitle } from "../markdown"
import { FileConversionError, type FileConversionInput, type FileConversionResult, type FileExtractor } from "../types"

type ParseOffice = (filePath: string) => Promise<string>

export interface PptxExtractorOptions {
  readonly parseOffice?: ParseOffice
}

export class PptxExtractor implements FileExtractor {
  readonly formats = ["pptx"] as const
  private readonly parseOffice: ParseOffice

  constructor(options: PptxExtractorOptions = {}) {
    this.parseOffice = options.parseOffice ?? defaultParseOffice
  }

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    try {
      const text = (await this.parseOffice(input.filePath)).trim()
      const title = normalizeMarkdownTitle(path.basename(input.filePath), input.filePath)
      return {
        sourcePath: input.filePath,
        format: "pptx",
        kind: "presentation",
        title,
        markdown: [`# ${title}`, "", "## Slides", "", text, ""].join("\n"),
        text,
        metadata: {},
        warnings: [{
          code: "presentation_structure_limited",
          message: "Slide boundaries were not fully available from the parser.",
        }],
      }
    } catch (error) {
      throw new FileConversionError("parse_failed", "Could not parse PPTX file.", { cause: error })
    }
  }
}

async function defaultParseOffice(filePath: string): Promise<string> {
  const parsed = await OfficeParser.parseOffice(filePath, { ocr: false })
  if (typeof parsed === "object" && parsed !== null && "toText" in parsed && typeof parsed.toText === "function") {
    return String(parsed.toText())
  }
  return String(parsed)
}
