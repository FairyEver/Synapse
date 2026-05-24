import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { FileConversionErrorCode, FileConversionResult } from "../../electron/services/file-conversion"
import { FileConversionError } from "../../electron/services/file-conversion"
import { sanitizeError } from "../../electron/services/error-sanitize"
import { createMainLogger } from "../../electron/services/log-store"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"
import type { NodeExecutionInput, NodeExecutionResult, NodeExecutor } from "../types"
import type { FileConversionNodeConfig } from "./schema"
import { isWorkflowFileConversionOutputPathAllowed } from "./output-boundary"

const logger = createMainLogger("workflow.node.file-conversion-executor")

export const fileConversionNodeExecutor: NodeExecutor<FileConversionNodeConfig> = {
  async execute(input: NodeExecutionInput<FileConversionNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, context, runtimeDeps } = input
    const inputPath = config.inputPath.trim()

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
      outputMode: config.outputMode ?? "result",
    })

    try {
      const converted = await runtimeDeps.fileConversionService.convert({
        filePath: inputPath,
        preferredOutput: "markdown",
      })

      input.onProgress?.("processing_output", "处理输出…")
      const outputs = buildConversionOutputs(converted)

      if (config.outputMode === "markdown-file") {
        const outputPath = config.outputPath?.trim() ?? ""
        if (!isWorkflowFileConversionOutputPathAllowed(outputPath)) {
          return fileConversionFailure({
            start,
            inputPath,
            code: "invalid_output_path",
            message: "outputPath must be inside the workflow output directory.",
          })
        }

        await mkdir(path.dirname(outputPath), { recursive: true })
        await writeFile(outputPath, converted.markdown, "utf8")
        outputs.outputPath = outputPath
      }

      const durationMs = Date.now() - start
      logger.info("file conversion node succeeded", {
        runId: context.runId,
        format: converted.format,
        kind: converted.kind,
        warningCount: converted.warnings.length,
        outputMode: config.outputMode ?? "result",
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
        errorMessage: truncateWithEllipsis(message, 200),
        durationMs,
      })
      return fileConversionFailure({ start, inputPath, code, message })
    }
  },
}

type WorkflowFileConversionFailureCode = FileConversionErrorCode | "invalid_output_path"

function buildConversionOutputs(result: FileConversionResult): Record<string, unknown> {
  return {
    sourcePath: result.sourcePath,
    format: result.format,
    kind: result.kind,
    title: result.title,
    markdown: result.markdown,
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
