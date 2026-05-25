import { lstat, writeFile } from "node:fs/promises"
import path from "node:path"
import { parentPort, workerData } from "node:worker_threads"

import {
  createDefaultFileConversionService,
  FileConversionError,
} from "../services/file-conversion"
import { resolveUniqueMarkdownOutputPath } from "../services/tools/file-conversion-output"
import type {
  ToolsFileConversionFailure,
  ToolsFileConversionPayload,
  ToolsFileConversionResult,
  ToolsFileConversionSuccess,
} from "../services/tools/file-conversion-types"

const SUPPORTED_EXTENSIONS = new Set([".docx", ".xlsx", ".pdf", ".pptx"])

function asWorkerPayload(value: unknown): ToolsFileConversionPayload {
  const input = value as Partial<ToolsFileConversionPayload>
  if (!Array.isArray(input.filePaths) || typeof input.outputDirectory !== "string") {
    throw new Error("Invalid file conversion worker input")
  }
  return {
    filePaths: input.filePaths.filter((filePath): filePath is string => typeof filePath === "string"),
    outputDirectory: input.outputDirectory,
  }
}

async function runConversion(): Promise<ToolsFileConversionResult> {
  const input = asWorkerPayload(workerData)
  const outputStat = await lstat(input.outputDirectory).catch(() => null)
  if (!outputStat?.isDirectory()) {
    return {
      successes: [],
      failures: input.filePaths.map((sourcePath) => ({
        sourcePath,
        reason: "invalid-output-path",
        message: "输出目录不可用。",
      })),
    }
  }

  const service = createDefaultFileConversionService()
  const reservedOutputPaths = new Set<string>()
  const successes: ToolsFileConversionSuccess[] = []
  const failures: ToolsFileConversionFailure[] = []

  for (const sourcePath of input.filePaths) {
    const extension = path.extname(sourcePath).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      failures.push({
        sourcePath,
        reason: "unsupported-format",
        message: "不支持的文件格式。",
      })
      continue
    }

    try {
      const result = await service.convert({ filePath: sourcePath, preferredOutput: "markdown" })
      const outputPath = await resolveUniqueMarkdownOutputPath(input.outputDirectory, sourcePath, reservedOutputPaths)
      await writeMarkdownOutput(outputPath, result.markdown)
      reservedOutputPaths.add(outputPath)
      successes.push({
        sourcePath,
        outputPath,
        warningCount: result.warnings.length,
      })
    } catch (error) {
      failures.push({
        sourcePath,
        ...toFailure(error),
      })
    }
  }

  return { successes, failures }
}

function ensureTrailingNewline(markdown: string): string {
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`
}

async function writeMarkdownOutput(outputPath: string, markdown: string): Promise<void> {
  try {
    await writeFile(outputPath, ensureTrailingNewline(markdown), "utf8")
  } catch (error) {
    throw new FileConversionWorkerWriteError(error)
  }
}

class FileConversionWorkerWriteError extends Error {
  constructor(readonly cause: unknown) {
    super("Could not write converted Markdown file.")
    this.name = "FileConversionWorkerWriteError"
  }
}

function toFailure(error: unknown): Omit<ToolsFileConversionFailure, "sourcePath"> {
  if (error instanceof FileConversionWorkerWriteError) {
    return { reason: "write-failed", message: error.message }
  }
  if (error instanceof FileConversionError) {
    if (error.code === "unsupported_format" || error.code === "missing_local_helper") {
      return { reason: "unsupported-format", message: error.message }
    }
    if (error.code === "read_failed" || error.code === "size_limit_exceeded") {
      return { reason: "read-failed", message: error.message }
    }
    return { reason: "conversion-failed", message: error.message }
  }
  return {
    reason: "conversion-failed",
    message: error instanceof Error ? error.message : String(error),
  }
}

void runConversion()
  .then((result) => {
    parentPort?.postMessage({ type: "success", result })
  })
  .catch((error: unknown) => {
    const workerError = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) }
    parentPort?.postMessage({ type: "error", error: workerError })
  })
