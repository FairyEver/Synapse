import { interpolatePrompt } from "../../../electron/services/workflow/variable-resolver"
import type { NodeExecutionInput, NodeExecutionResult, NodeExecutor } from "../../../workflow-nodes/types"
import type { HtmlGenerationToFileService } from "../main/file-service"
import type { HtmlGenerationService } from "../main/service"
import {
  HTML_GENERATOR_FILE_SERVICE_ID,
  HTML_GENERATOR_SERVICE_ID,
} from "../shared/capability"
import {
  HtmlGenerationError,
  isHtmlGenerationError,
  serializeHtmlGenerationError,
} from "../shared/errors"
import type { JsonObject } from "../shared/schema"
import { isTextFileWriteError, serializeTextFileWriteError } from "../../text-file-writer/shared/errors"
import type { HtmlGeneratorEjsFileNodeConfig, HtmlGeneratorEjsNodeConfig } from "./schema"

export const htmlGeneratorEjsNodeExecutor: NodeExecutor<HtmlGeneratorEjsNodeConfig> = {
  async execute(input) {
    const start = Date.now()
    try {
      const service = input.runtimeDeps?.resolveService?.<HtmlGenerationService>(HTML_GENERATOR_SERVICE_ID)
      if (!service) throw new Error("HTML 生成服务不可用。")
      const result = await service.generate({
        template: input.config.template,
        data: parseWorkflowData(input.resolvedVariables.data),
      }, renderContext(input))
      return {
        status: "success",
        output: result.html,
        outputs: { size: result.size },
        durationMs: Date.now() - start,
      }
    } catch (error) {
      return renderFailure(error, start)
    }
  },
}

export const htmlGeneratorEjsFileNodeExecutor: NodeExecutor<HtmlGeneratorEjsFileNodeConfig> = {
  async execute(input) {
    const start = Date.now()
    try {
      const service = input.runtimeDeps?.resolveService?.<HtmlGenerationToFileService>(HTML_GENERATOR_FILE_SERVICE_ID)
      if (!service) throw new Error("HTML 文件生成服务不可用。")
      const pathVariables = Object.fromEntries(
        Object.entries(input.resolvedVariables).filter(([name]) => name !== "data"),
      )
      const result = await service.generateToFile({
        template: input.config.template,
        data: parseWorkflowData(input.resolvedVariables.data),
        outputPath: interpolatePrompt(input.config.outputPath, pathVariables),
        overwrite: input.config.overwrite,
      }, renderContext(input))
      return {
        status: "success",
        output: result.output.path,
        outputs: result.output,
        durationMs: Date.now() - start,
      }
    } catch (error) {
      if (isTextFileWriteError(error)) {
        const serialized = serializeTextFileWriteError(error)
        return {
          status: error.code === "ABORTED" ? "cancelled" : "failed",
          output: "",
          outputs: serialized,
          error: serialized.message,
          durationMs: Date.now() - start,
        }
      }
      return renderFailure(error, start)
    }
  },
}

function parseWorkflowData(value: string | undefined): JsonObject {
  if (typeof value !== "string" || value.length === 0) throw new HtmlGenerationError("INVALID_DATA")
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new HtmlGenerationError("INVALID_DATA")
    }
    return parsed as JsonObject
  } catch (error) {
    if (isHtmlGenerationError(error)) throw error
    throw new HtmlGenerationError("INVALID_DATA")
  }
}

function renderContext<T extends HtmlGeneratorEjsNodeConfig | HtmlGeneratorEjsFileNodeConfig>(input: NodeExecutionInput<T>) {
  return {
    actor: input.context.actor ?? { kind: "system" as const, id: "workflow-engine" },
    source: "workflow" as const,
    metadata: {
      workflowId: input.context.workflowId,
      runId: input.context.runId,
      nodeId: input.context.nodeId,
      nodeName: input.context.nodeName,
    },
    abortSignal: input.context.abortSignal,
  }
}

function renderFailure(error: unknown, start: number): NodeExecutionResult {
  const serialized = serializeHtmlGenerationError(error)
  return {
    status: isHtmlGenerationError(error) && error.code === "RENDER_CANCELLED" ? "cancelled" : "failed",
    output: "",
    outputs: serialized,
    error: serialized.message,
    durationMs: Date.now() - start,
  }
}
