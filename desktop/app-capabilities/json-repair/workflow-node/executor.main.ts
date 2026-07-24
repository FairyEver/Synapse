import { interpolatePromptSafely } from "../../../electron/services/workflow/variable-resolver"
import type {
  NodeExecutionInput,
  NodeExecutionResult,
  NodeExecutor,
} from "../../../workflow-nodes/types"
import { JSON_REPAIR_SERVICE_ID } from "../shared/capability"
import {
  createJsonRepairErrorPayload,
  serializeJsonRepairError,
} from "../shared/errors"
import { validateJsonRepairInput } from "../shared/schema"
import type { JsonRepairService } from "../main/service"
import type { JsonRepairNodeConfig } from "./schema"

export const jsonRepairNodeExecutor: NodeExecutor<JsonRepairNodeConfig> = {
  async execute(input: NodeExecutionInput<JsonRepairNodeConfig>): Promise<NodeExecutionResult> {
    const startedAt = Date.now()
    if (input.context.abortSignal.aborted) return cancelled(startedAt)

    let text: string
    try {
      text = interpolatePromptSafely(input.config.text, input.resolvedVariables)
    } catch {
      return failed(createJsonRepairErrorPayload("INTERNAL_ERROR"), startedAt)
    }

    try {
      const validation = validateJsonRepairInput({ text })
      if (!validation.ok) return failed(validation.error, startedAt)
      if (input.context.abortSignal.aborted) return cancelled(startedAt)

      const service = input.runtimeDeps?.resolveService?.<JsonRepairService>(
        JSON_REPAIR_SERVICE_ID,
      )
      if (!service) return failed(createJsonRepairErrorPayload("INTERNAL_ERROR"), startedAt)

      try {
        const result = service.repair(validation.data, {
          source: "workflow",
          actor: input.context.actor ?? { kind: "system", id: "workflow-engine" },
          ...(input.context.workflowId ? { workflowId: input.context.workflowId } : {}),
          runId: input.context.runId,
          ...(input.context.nodeId ? { nodeId: input.context.nodeId } : {}),
        })
        return {
          status: "success",
          output: result.json,
          outputs: result,
          durationMs: Date.now() - startedAt,
        }
      } catch (error) {
        return failed(serializeJsonRepairError(error), startedAt)
      }
    } catch {
      return failed(createJsonRepairErrorPayload("INTERNAL_ERROR"), startedAt)
    }
  },
}

function failed(
  error: ReturnType<typeof createJsonRepairErrorPayload>,
  startedAt: number,
): NodeExecutionResult {
  return {
    status: "failed",
    output: "",
    outputs: { ...error },
    error: error.message,
    durationMs: Date.now() - startedAt,
  }
}

function cancelled(startedAt: number): NodeExecutionResult {
  const error = createJsonRepairErrorPayload("CANCELLED")
  return {
    status: "cancelled",
    output: "",
    outputs: { ...error },
    error: error.message,
    durationMs: Date.now() - startedAt,
  }
}
