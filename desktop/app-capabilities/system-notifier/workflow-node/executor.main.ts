import { interpolatePromptSafely } from "../../../electron/services/workflow/variable-resolver"
import type {
  NodeExecutionInput,
  NodeExecutionResult,
  NodeExecutor,
} from "../../../workflow-nodes/types"
import { SYSTEM_NOTIFIER_SERVICE_ID } from "../shared/capability"
import { validateSystemNotificationInput } from "../shared/schema"
import type { SystemNotifierService } from "../main/service"
import type { SystemNotifierNodeConfig } from "./schema"

export const systemNotifierNodeExecutor: NodeExecutor<SystemNotifierNodeConfig> = {
  async execute(input: NodeExecutionInput<SystemNotifierNodeConfig>): Promise<NodeExecutionResult> {
    const startedAt = Date.now()
    if (input.context.abortSignal.aborted) return cancelled(startedAt)

    try {
      const interpolated = {
        title: interpolatePromptSafely(input.config.title, input.resolvedVariables),
        body: interpolatePromptSafely(input.config.body, input.resolvedVariables),
      }
      const validation = validateSystemNotificationInput(interpolated)
      if (!validation.ok) {
        return {
          status: "failed",
          output: "",
          outputs: { ...validation },
          error: validation.error,
          durationMs: Date.now() - startedAt,
        }
      }
      if (input.context.abortSignal.aborted) return cancelled(startedAt)

      const service = input.runtimeDeps?.resolveService?.<SystemNotifierService>(
        SYSTEM_NOTIFIER_SERVICE_ID,
      )
      if (!service) throw new Error("系统通知能力不可用")

      const result = service.trigger(validation.data, {
        source: "workflow",
        actor: input.context.actor ?? { kind: "system", id: "workflow-engine" },
        identityKey: workflowIdentityKey(input.context.workflowId, input.context.nodeId),
        ...(input.context.workflowId ? { workflowId: input.context.workflowId } : {}),
        runId: input.context.runId,
        ...(input.context.nodeId ? { nodeId: input.context.nodeId } : {}),
      })
      return {
        status: "success",
        output: JSON.stringify(result),
        outputs: result,
        durationMs: Date.now() - startedAt,
      }
    } catch {
      return {
        status: "failed",
        output: "",
        error: "系统通知节点执行失败",
        durationMs: Date.now() - startedAt,
      }
    }
  },
}

function workflowIdentityKey(workflowId: string | undefined, nodeId: string | undefined): string {
  return `workflow\u0000${workflowId ?? "anonymous"}\u0000${nodeId ?? "anonymous"}`
}

function cancelled(startedAt: number): NodeExecutionResult {
  return {
    status: "cancelled",
    output: "",
    error: "系统通知已取消",
    durationMs: Date.now() - startedAt,
  }
}
