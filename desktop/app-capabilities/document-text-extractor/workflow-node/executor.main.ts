import { interpolatePrompt } from "../../../electron/services/workflow/variable-resolver"
import type { DocumentTextExtractorService } from "../main/service"
import {
  DocumentTextExtractionError,
  isDocumentTextExtractionError,
} from "../shared/errors"
import { documentTextExtractionInputSchema } from "../shared/schema"
import type {
  NodeExecutionInput,
  NodeExecutionResult,
  NodeExecutor,
} from "../../../workflow-nodes/types"
import type { DocumentTextExtractNodeConfig } from "./schema"

const DOCUMENT_TEXT_EXTRACTOR_SERVICE_ID = "core.document-text-extractor"

export const documentTextExtractNodeExecutor: NodeExecutor<DocumentTextExtractNodeConfig> = {
  async execute(
    input: NodeExecutionInput<DocumentTextExtractNodeConfig>,
  ): Promise<NodeExecutionResult> {
    const startedAt = Date.now()
    try {
      const service = input.runtimeDeps?.resolveService?.<DocumentTextExtractorService>(
        DOCUMENT_TEXT_EXTRACTOR_SERVICE_ID,
      )
      if (!service) throw new Error("文档文本提取能力不可用。")

      const filePath = interpolatePrompt(input.config.filePath, input.resolvedVariables)
      const extractionInput = documentTextExtractionInputSchema.parse({ filePath })
      const task = service.createTask(extractionInput, {
        source: "workflow",
        actor: input.context.actor ?? { kind: "system", id: "workflow-engine" },
      })
      const unsubscribeTask = task.subscribe((state) => {
        if (state.status === "waiting") {
          input.onProgress?.("waiting", "等待提取")
        } else if (state.status === "running") {
          input.onProgress?.("extracting", "提取中")
        }
      })
      const cancelTask = () => task.cancel()
      if (input.context.abortSignal.aborted) cancelTask()
      else input.context.abortSignal.addEventListener("abort", cancelTask, { once: true })

      try {
        const result = await task.result
        const outputs = {
          format: result.format,
          fileName: result.fileName,
          size: result.size,
          ...("pages" in result && result.pages !== undefined ? { pages: result.pages } : {}),
        }
        return {
          status: "success",
          output: result.text,
          outputs,
          durationMs: Date.now() - startedAt,
        }
      } finally {
        unsubscribeTask()
        input.context.abortSignal.removeEventListener("abort", cancelTask)
      }
    } catch (error) {
      const normalized = input.context.abortSignal.aborted
        ? new DocumentTextExtractionError("EXTRACTION_CANCELLED")
        : isDocumentTextExtractionError(error)
          ? error
          : new DocumentTextExtractionError("EXTRACTION_FAILED")
      return {
        status: normalized.code === "EXTRACTION_CANCELLED" ? "cancelled" : "failed",
        output: "",
        error: `${normalized.code}: ${normalized.message}`,
        durationMs: Date.now() - startedAt,
      }
    }
  },
}
