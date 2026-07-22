import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { PromptNodeConfig } from "./schema"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { agentErrorDiagnostic, sanitizeAgentError, agentFailureMessage, agentProviderFailureFromResponse } from "../../electron/services/workflow/workflow-utils"
import { createMainLogger } from "../../electron/services/log-store"
import { resolveAgentTimeoutMins } from "../agent-timeout"
import { workflowNodeLogContext } from "../log-context"

const logger = createMainLogger("workflow.node.prompt-executor")

export const promptNodeExecutor: NodeExecutor<PromptNodeConfig> = {
  async execute(input: NodeExecutionInput<PromptNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const logContext = workflowNodeLogContext(input.context)
    input.onProgress?.("resolving_variables", "解析变量…")
    let prompt: string
    try {
      prompt = interpolatePrompt(input.config.prompt, input.resolvedVariables)
    } catch (err) {
      return { status: "failed", output: "", error: `模板变量解析失败：${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - start }
    }

    input.onProgress?.("calling_model", "调用模型…")
    logger.info("prompt node executing", {
      ...logContext, providerId: input.config.providerId, modelTier: input.config.modelTier,
      promptLength: prompt.length,
    })

    input.onProgress?.("awaiting_response", "等待响应…")
    let agentConversation: NodeExecutionResult["agentConversation"]
    const result = await input.agentDeps.sendToAgent({
      providerId: input.config.providerId ?? "",
      modelTier: input.config.modelTier ?? "default",
      prompt,
      projectId: input.context.projectId ?? "",
      abortSignal: input.context.abortSignal,
      timeoutMins: resolveAgentTimeoutMins(input.config.timeoutMins),
      workflowId: input.context.workflowId,
      workflowName: input.context.workflowName,
      workflowRunId: input.context.runId,
      workflowNodeId: input.context.nodeId,
      workflowNodeName: input.context.nodeName,
      onConversationCreated: (target) => {
        agentConversation = target
        input.onAgentConversation?.(target)
      },
      onResponseStarted: () => input.onProgress?.("processing_response", "处理中…"),
    })
    const durationMs = Date.now() - start

    if (result.status === "failed") {
      const sanitizedError = sanitizeAgentError(result.error)
      logger.warn("prompt node agent call failed", {
        ...logContext, providerId: input.config.providerId, modelTier: input.config.modelTier,
        ...agentErrorDiagnostic(result.error),
        sanitizedError,
        durationMs,
      })
      return { status: "failed", output: "", error: agentFailureMessage(result.error), durationMs, usage: result.usage, modelName: result.modelName, costUsd: result.costUsd, costCny: result.costCny, costBreakdownCny: result.costBreakdownCny, costCurrency: result.costCurrency, agentConversation: agentConversation ?? result.agentConversation }
    }

    const providerFailure = agentProviderFailureFromResponse(result.response)
    if (providerFailure) {
      const sanitizedError = sanitizeAgentError(providerFailure)
      logger.warn("prompt node agent call failed", {
        ...logContext, providerId: input.config.providerId, modelTier: input.config.modelTier,
        ...agentErrorDiagnostic(providerFailure),
        sanitizedError,
        durationMs,
      })
      return { status: "failed", output: "", error: agentFailureMessage(providerFailure), durationMs, usage: result.usage, modelName: result.modelName, costUsd: result.costUsd, costCny: result.costCny, costBreakdownCny: result.costBreakdownCny, costCurrency: result.costCurrency, agentConversation: agentConversation ?? result.agentConversation }
    }

    input.onProgress?.("processing_output", "处理输出…")
    logger.info("prompt node succeeded", {
      ...logContext, providerId: input.config.providerId, modelTier: input.config.modelTier,
      outputLength: result.response.length, durationMs,
    })
    return { status: "success", output: result.response, durationMs, usage: result.usage, modelName: result.modelName, costUsd: result.costUsd, costCny: result.costCny, costBreakdownCny: result.costBreakdownCny, costCurrency: result.costCurrency, agentConversation: agentConversation ?? result.agentConversation }
  },
}
