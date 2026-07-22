import { interpolatePrompt } from "../../../electron/services/workflow/variable-resolver"
import type { NodeExecutionInput, NodeExecutionResult, NodeExecutor } from "../../../workflow-nodes/types"
import type { FileOpenerService } from "../main/service"
import { FILE_OPENER_SERVICE_ID } from "../shared/capability"
import { serializeFileOpenerError } from "../shared/errors"
import type { FileOpenerNodeConfig } from "./schema"

export const fileOpenerNodeExecutor: NodeExecutor<FileOpenerNodeConfig> = {
  async execute(input: NodeExecutionInput<FileOpenerNodeConfig>): Promise<NodeExecutionResult> {
    const startedAt = Date.now()
    if (input.context.abortSignal.aborted) return cancelled(startedAt)
    try {
      const service = input.runtimeDeps?.resolveService?.<FileOpenerService>(FILE_OPENER_SERVICE_ID)
      if (!service) throw new Error("默认应用打开能力不可用")
      const path = interpolatePrompt(input.config.path, input.resolvedVariables)
      input.onProgress?.("opening_file", "打开文件")
      const result = await service.open({ path }, {
        source: "workflow",
        actor: input.context.actor ?? { kind: "system", id: "workflow-engine" },
        abortSignal: input.context.abortSignal,
        metadata: {
          workflowId: input.context.workflowId,
          runId: input.context.runId,
          nodeId: input.context.nodeId,
          automationId: input.context.automationId,
          automationRunId: input.context.automationRunId,
        },
      })
      return {
        status: "success",
        output: result.path,
        outputs: { path: result.path },
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      if (input.context.abortSignal.aborted) return cancelled(startedAt)
      const serialized = serializeFileOpenerError(error)
      return {
        status: "failed",
        output: "",
        error: `${serialized.code}: ${serialized.message}`,
        durationMs: Date.now() - startedAt,
      }
    }
  },
}

function cancelled(startedAt: number): NodeExecutionResult {
  return {
    status: "cancelled",
    output: "",
    error: "文件打开已取消",
    durationMs: Date.now() - startedAt,
  }
}
