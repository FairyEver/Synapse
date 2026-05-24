import path from "node:path"

import { normalizeMarkdownTitle } from "../markdown"
import { FileConversionError, type FileConversionInput, type FileConversionResult, type FileExtractor } from "../types"

type LegacyHelperOutput = {
  readonly text: string
  readonly metadata: Record<string, unknown>
}

export interface LegacyOfficeExtractorOptions {
  readonly helperPath?: string | null
  readonly runHelper?: (input: { readonly helperPath: string; readonly filePath: string }) => Promise<LegacyHelperOutput>
}

export class LegacyOfficeExtractor implements FileExtractor {
  readonly formats = ["doc", "ppt"] as const
  private readonly helperPath: string | null
  private readonly runHelper: LegacyOfficeExtractorOptions["runHelper"]

  constructor(options: LegacyOfficeExtractorOptions = {}) {
    this.helperPath = options.helperPath ?? process.env.SYNAPSE_TIKA_APP_PATH ?? null
    this.runHelper = options.runHelper
  }

  async extract(input: FileConversionInput): Promise<FileConversionResult> {
    const format = path.extname(input.filePath).toLowerCase() === ".ppt" ? "ppt" : "doc"
    if (!this.helperPath || !this.runHelper) {
      throw new FileConversionError("missing_local_helper", `A local helper is required to convert .${format} files.`)
    }
    const output = await this.runHelper({ helperPath: this.helperPath, filePath: input.filePath })
    const title = normalizeMarkdownTitle(path.basename(input.filePath), input.filePath)
    const text = output.text.trim()
    const markdown = [`# ${title}`, "", text, ""].join("\n")
    return {
      sourcePath: input.filePath,
      format,
      kind: format === "ppt" ? "presentation" : "document",
      title,
      markdown,
      text,
      metadata: output.metadata,
      warnings: [],
    }
  }
}
