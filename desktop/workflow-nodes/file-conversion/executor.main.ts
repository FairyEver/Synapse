import path from "node:path"

import type { FileConversionErrorCode, FileConversionResult } from "../../electron/services/file-conversion"
import { FileConversionError } from "../../electron/services/file-conversion"
import { sanitizeError } from "../../electron/services/error-sanitize"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { createMainLogger } from "../../electron/services/log-store"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"
import type { NodeExecutionInput, NodeExecutionResult, NodeExecutor } from "../types"
import type { FileConversionNodeConfig } from "./schema"
import { isWorkflowFileConversionOutputPathAllowed, WorkflowFileConversionOutputWriteError } from "./output-boundary"

const logger = createMainLogger("workflow.node.file-conversion-executor")

export const fileConversionNodeExecutor: NodeExecutor<FileConversionNodeConfig> = {
  async execute(input: NodeExecutionInput<FileConversionNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, context, runtimeDeps } = input
    const interpolated = interpolateFileConversionConfig(config, input.resolvedVariables)
    const inputPath = interpolated.inputPath.trim()

    if (!runtimeDeps?.fileConversionService) {
      return { status: "failed", output: "", error: "文件转换能力不可用", durationMs: Date.now() - start }
    }

    if (!inputPath) {
      return fileConversionFailure({
        start,
        inputPath,
        code: "read_failed",
        message: "inputPath is required.",
      })
    }

    input.onProgress?.("converting_file", "转换文件…")
    logger.info("file conversion node executing", {
      runId: context.runId,
      inputPathLength: inputPath.length,
      outputMode: interpolated.outputMode ?? "result",
    })

    try {
      const converted = await runtimeDeps.fileConversionService.convert({
        filePath: inputPath,
        preferredOutput: "markdown",
        ocr: normalizeOcrOptions(interpolated.ocr),
      })

      input.onProgress?.("processing_output", "处理输出…")
      const outputs = buildConversionOutputs(converted)

      if (interpolated.outputMode === "markdown-file") {
        const outputPath = resolveMarkdownOutputPath(interpolated, converted)
        if (!isWorkflowFileConversionOutputPathAllowed(outputPath)) {
          return fileConversionFailure({
            start,
            inputPath,
            code: "invalid_output_path",
            message: "outputPath must be inside the workflow output directory.",
          })
        }
        if (!runtimeDeps.writeWorkflowFileConversionOutput) {
          return fileConversionFailure({
            start,
            inputPath: converted.sourcePath,
            code: "write_failed",
            message: "Workflow output writer is unavailable.",
          })
        }

        try {
          await runtimeDeps.writeWorkflowFileConversionOutput({
            outputPath,
            markdown: converted.markdown,
            actor: context.actor,
            runId: context.runId,
            abortSignal: context.abortSignal,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const code = error instanceof WorkflowFileConversionOutputWriteError ? error.code : "write_failed"
          logger.warn("file conversion node output write failed", {
            runId: context.runId,
            code,
            errorMessage: truncateWithEllipsis(sanitizeError(message), 200),
            durationMs: Date.now() - start,
          })
          return fileConversionFailure({ start, inputPath: converted.sourcePath, code, message })
        }
        outputs.outputPath = outputPath
      }

      const durationMs = Date.now() - start
      logger.info("file conversion node succeeded", {
        runId: context.runId,
        format: converted.format,
        kind: converted.kind,
        warningCount: converted.warnings.length,
        outputMode: interpolated.outputMode ?? "result",
        durationMs,
      })

      return {
        status: "success",
        output: converted.markdown,
        outputs,
        durationMs,
      }
    } catch (error) {
      const durationMs = Date.now() - start
      const message = error instanceof Error ? error.message : String(error)
      const code = error instanceof FileConversionError ? error.code : "parse_failed"
      logger.warn("file conversion node failed", {
        runId: context.runId,
        code,
        errorMessage: truncateWithEllipsis(sanitizeError(message), 200),
        durationMs,
      })
      return fileConversionFailure({ start, inputPath, code, message })
    }
  },
}

type WorkflowFileConversionFailureCode = FileConversionErrorCode | "invalid_output_path" | "write_failed"

function interpolateFileConversionConfig(
  config: FileConversionNodeConfig,
  variables: Record<string, string>,
): FileConversionNodeConfig {
  return {
    ...config,
    inputPath: interpolatePrompt(config.inputPath, variables),
    outputPath: config.outputPath ? interpolatePrompt(config.outputPath, variables) : config.outputPath,
    outputDirectory: config.outputDirectory ? interpolatePrompt(config.outputDirectory, variables) : config.outputDirectory,
  }
}

function normalizeOcrOptions(ocr: FileConversionNodeConfig["ocr"]): { enabled: boolean; languages?: readonly string[]; maxPages?: number } | undefined {
  if (!ocr?.enabled) return undefined
  const languages = (ocr.languages ?? []).map((language) => language.trim()).filter(Boolean)
  return {
    enabled: true,
    ...(languages.length > 0 ? { languages } : {}),
    ...(typeof ocr.maxPages === "number" && Number.isFinite(ocr.maxPages) ? { maxPages: ocr.maxPages } : {}),
  }
}

function resolveMarkdownOutputPath(config: FileConversionNodeConfig, result: FileConversionResult): string {
  const explicitPath = config.outputPath?.trim()
  if (explicitPath) return explicitPath

  const outputDirectory = config.outputDirectory?.trim()
  if (!outputDirectory) return ""

  return path.join(outputDirectory, markdownFileName(result))
}

function markdownFileName(result: FileConversionResult): string {
  const sourceBaseName = path.basename(result.sourcePath).replace(/\.[^.]+$/, "")
  const rawName = path.basename((result.title || sourceBaseName || "converted").trim()).replace(/\.md$/i, "")
  const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").trim() || "converted"
  return `${safeName}.md`
}

function buildConversionOutputs(result: FileConversionResult): Record<string, unknown> {
  return {
    sourcePath: result.sourcePath,
    format: result.format,
    kind: result.kind,
    title: result.title,
    text: result.text,
    metadata: result.metadata,
    warnings: result.warnings,
  }
}

function fileConversionFailure(input: {
  readonly start: number
  readonly inputPath: string
  readonly code: WorkflowFileConversionFailureCode
  readonly message: string
}): NodeExecutionResult {
  const message = sanitizeError(input.message)
  return {
    status: "failed",
    output: "",
    outputs: {
      ok: false,
      code: input.code,
      message,
      sourcePath: input.inputPath,
    },
    error: `文件转换失败（${input.code}）：${truncateWithEllipsis(message, 120)}`,
    durationMs: Date.now() - input.start,
  }
}
