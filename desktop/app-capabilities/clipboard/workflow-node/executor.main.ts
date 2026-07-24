import { interpolatePromptSafely } from "../../../electron/services/workflow/variable-resolver"
import type {
  NodeExecutionInput,
  NodeExecutionResult,
  NodeExecutor,
  WorkflowRuntimeContext,
} from "../../../workflow-nodes/types"
import type { ClipboardService } from "../main/service"
import { CLIPBOARD_SERVICE_ID } from "../shared/capability"
import {
  createClipboardErrorPayload,
  serializeClipboardError,
  type ClipboardErrorPayload,
} from "../shared/errors"
import { validateClipboardWriteText } from "../shared/schema"
import type {
  ClipboardTextReadNodeConfig,
  ClipboardTextWriteNodeConfig,
} from "./schema"

export const clipboardTextWriteNodeExecutor: NodeExecutor<ClipboardTextWriteNodeConfig> = {
  async execute(
    input: NodeExecutionInput<ClipboardTextWriteNodeConfig>,
  ): Promise<NodeExecutionResult> {
    const startedAt = Date.now()
    if (input.context.abortSignal.aborted) return cancelled(startedAt)

    let text: string
    try {
      text = interpolatePromptSafely(input.config.text, input.resolvedVariables)
    } catch {
      return failed(createClipboardErrorPayload("INVALID_INPUT"), startedAt)
    }

    const validation = validateClipboardWriteText(text)
    if (!validation.ok) return failed(validation.error, startedAt)

    const context = createServiceContext(input.context)
    if (!context) {
      return failed(createClipboardErrorPayload("INTERNAL_ERROR"), startedAt)
    }
    if (input.context.abortSignal.aborted) return cancelled(startedAt)

    const service = input.runtimeDeps?.resolveService?.<ClipboardService>(
      CLIPBOARD_SERVICE_ID,
    )
    if (!service) {
      return failed(createClipboardErrorPayload("INTERNAL_ERROR"), startedAt)
    }

    try {
      const result = service.write(validation.text, context)
      return {
        status: "success",
        output: JSON.stringify(result),
        outputs: result,
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      return failed(serializeClipboardError(error), startedAt)
    }
  },
}

export const clipboardTextReadNodeExecutor: NodeExecutor<ClipboardTextReadNodeConfig> = {
  async execute(
    input: NodeExecutionInput<ClipboardTextReadNodeConfig>,
  ): Promise<NodeExecutionResult> {
    const startedAt = Date.now()
    if (input.context.abortSignal.aborted) return cancelled(startedAt)

    const context = createServiceContext(input.context)
    if (!context) {
      return failed(createClipboardErrorPayload("INTERNAL_ERROR"), startedAt)
    }
    if (input.context.abortSignal.aborted) return cancelled(startedAt)

    const service = input.runtimeDeps?.resolveService?.<ClipboardService>(
      CLIPBOARD_SERVICE_ID,
    )
    if (!service) {
      return failed(createClipboardErrorPayload("INTERNAL_ERROR"), startedAt)
    }

    try {
      const result = service.read(context)
      return {
        status: "success",
        output: result.text,
        outputs: result,
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      return failed(serializeClipboardError(error), startedAt)
    }
  },
}

function createServiceContext(context: WorkflowRuntimeContext) {
  if (
    !isNonEmpty(context.workflowId)
    || !isNonEmpty(context.runId)
    || !isNonEmpty(context.nodeId)
  ) {
    return null
  }
  return {
    source: "workflow" as const,
    actor: context.actor ?? { kind: "system" as const, id: "workflow-engine" },
    workflowId: context.workflowId,
    runId: context.runId,
    nodeId: context.nodeId,
  }
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function failed(
  error: ClipboardErrorPayload,
  startedAt: number,
): NodeExecutionResult {
  return {
    status: "failed",
    output: "",
    outputs: { ...error },
    error: error.message,
    errorCode: error.code,
    errorReason: error.code === "INVALID_INPUT"
      ? error.data?.reason
      : undefined,
    durationMs: Date.now() - startedAt,
  }
}

function cancelled(startedAt: number): NodeExecutionResult {
  const error = createClipboardErrorPayload("CANCELLED")
  return {
    status: "cancelled",
    output: "",
    outputs: { ...error },
    error: error.message,
    errorCode: error.code,
    durationMs: Date.now() - startedAt,
  }
}
