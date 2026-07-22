import { interpolatePrompt } from "../../../electron/services/workflow/variable-resolver"
import type { NodeExecutionInput, NodeExecutionResult, NodeExecutor } from "../../../workflow-nodes/types"
import { TEXT_FILE_WRITER_SERVICE_ID } from "../shared/capability"
import { isTextFileWriteError, serializeTextFileWriteError } from "../shared/errors"
import type { TextFileWriterService } from "../main/service"
import type { TextFileWriterNodeConfig } from "./schema"

export const textFileWriterNodeExecutor: NodeExecutor<TextFileWriterNodeConfig> = {
  async execute(input: NodeExecutionInput<TextFileWriterNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    try {
      const service = input.runtimeDeps?.resolveService?.<TextFileWriterService>(TEXT_FILE_WRITER_SERVICE_ID)
      if (!service) throw new Error("文本写入文件服务不可用。")
      const result = await service.write({
        path: interpolatePrompt(input.config.path, input.resolvedVariables),
        text: interpolatePrompt(input.config.text, input.resolvedVariables),
        encoding: input.config.encoding,
        overwrite: input.config.overwrite,
      }, {
        actor: input.context.actor ?? { kind: "system", id: "workflow-engine" },
        source: "workflow",
        metadata: {
          workflowId: input.context.workflowId,
          runId: input.context.runId,
          nodeId: input.context.nodeId,
          nodeName: input.context.nodeName,
        },
        abortSignal: input.context.abortSignal,
      })
      return {
        status: "success",
        output: result.path,
        outputs: result,
        durationMs: Date.now() - start,
      }
    } catch (error) {
      const serialized = serializeTextFileWriteError(error)
      return {
        status: isTextFileWriteError(error) && error.code === "ABORTED" ? "cancelled" : "failed",
        output: "",
        outputs: serialized,
        error: serialized.message,
        durationMs: Date.now() - start,
      }
    }
  },
}
