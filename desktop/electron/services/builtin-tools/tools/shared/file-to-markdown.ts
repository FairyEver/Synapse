import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { FileConversionError, type FileConversionResult } from "../../../file-conversion"
import {
  type MarkdownOutputBundle,
  resolveUniqueMarkdownOutputBundle,
  writeMarkdownOutputBundle,
} from "../../../tools/file-conversion-output"
import { BuiltinToolError } from "../../errors"

export interface FileToMarkdownBaseInput {
  readonly inputPath: string
  readonly outputMode: "return" | "write-file"
  readonly outputDirectory?: string
  readonly outputPath?: string
}

export interface MarkdownToolOutput {
  readonly markdown: string
  readonly text: string
  readonly sourcePath: string
  readonly outputPath?: string
  readonly assets?: {
    readonly relativePath: string
    readonly fileName: string
    readonly mimeType: string
  }[]
  readonly metadata: Record<string, unknown>
  readonly warnings: { readonly code: string; readonly message: string }[]
}

export function assertExtension(inputPath: string, extension: string): void {
  if (path.extname(inputPath).toLowerCase() !== extension) {
    throw new BuiltinToolError("unsupported_input", `Expected a ${extension} file.`)
  }
}

export async function outputFromConversionResult(
  input: FileToMarkdownBaseInput,
  result: FileConversionResult,
  options: { readonly outputBundle?: MarkdownOutputBundle } = {},
): Promise<MarkdownToolOutput> {
  if (input.outputMode !== "write-file") {
    return mapConversionResult(result)
  }

  try {
    if (input.outputPath) {
      await mkdir(path.dirname(input.outputPath), { recursive: true })
      await writeFile(input.outputPath, ensureTrailingNewline(result.markdown), "utf8")
      return { ...mapConversionResult(result), outputPath: input.outputPath }
    }

    if (!input.outputDirectory) {
      throw new BuiltinToolError("invalid_input", "outputDirectory is required when outputMode is write-file.")
    }

    const outputBundle = options.outputBundle
      ?? await resolveUniqueMarkdownOutputBundle(input.outputDirectory, input.inputPath, new Set())
    await writeMarkdownOutputBundle(outputBundle, result.markdown, result.assets ?? [])
    return { ...mapConversionResult(result), outputPath: outputBundle.markdownPath }
  } catch (error) {
    if (error instanceof BuiltinToolError) throw error
    throw new BuiltinToolError("write_failed", "Could not write Markdown output.", { cause: error })
  }
}

export function mapConversionError(error: unknown): BuiltinToolError {
  if (error instanceof BuiltinToolError) return error
  if (error instanceof FileConversionError) {
    if (error.code === "unsupported_format" || error.code === "missing_local_helper") {
      return new BuiltinToolError("unsupported_input", error.message, { cause: error })
    }
    if (error.code === "read_failed" || error.code === "size_limit_exceeded") {
      return new BuiltinToolError("read_failed", error.message, { cause: error })
    }
    return new BuiltinToolError("conversion_failed", error.message, { cause: error })
  }
  if (error instanceof Error) {
    return new BuiltinToolError("conversion_failed", error.message, { cause: error })
  }
  return new BuiltinToolError("conversion_failed", String(error))
}

function mapConversionResult(result: FileConversionResult): MarkdownToolOutput {
  return {
    markdown: result.markdown,
    text: result.text,
    sourcePath: result.sourcePath,
    assets: result.assets?.map((asset) => ({
      relativePath: asset.relativePath,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
    })),
    metadata: result.metadata,
    warnings: result.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
  }
}

function ensureTrailingNewline(markdown: string): string {
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`
}
