import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { PromptNodeConfig } from "./schema"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { createMainLogger } from "../../electron/services/log-store"

const logger = createMainLogger("workflow.node.prompt-executor")

export const promptNodeExecutor: NodeExecutor<PromptNodeConfig> = {
  async execute(input: NodeExecutionInput<PromptNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    input.onProgress?.("resolving_variables", "解析变量…")
    const prompt = interpolatePrompt(input.config.prompt, input.resolvedVariables)

    input.onProgress?.("calling_model", "调用模型…")
    logger.info("prompt node executing", {
      projectId: input.context.projectId, runId: input.context.runId, providerId: input.config.providerId, modelTier: input.config.modelTier,
      promptLength: prompt.length,
    })

    input.onProgress?.("awaiting_response", "等待响应…")
    const result = await input.agentDeps.sendToAgent({ providerId: input.config.providerId, modelTier: input.config.modelTier, prompt, projectId: input.context.projectId, abortSignal: input.context.abortSignal })
    const durationMs = Date.now() - start

    if (result.status === "failed") {
      logger.warn("prompt node agent call failed", {
        projectId: input.context.projectId, runId: input.context.runId, providerId: input.config.providerId, modelTier: input.config.modelTier,
        ...agentErrorDiagnostic(result.error),
        durationMs,
      })
      return { status: "failed", output: "", error: agentFailureMessage(result.error), durationMs }
    }

    input.onProgress?.("processing_output", "处理输出…")
    logger.info("prompt node succeeded", {
      projectId: input.context.projectId, runId: input.context.runId, providerId: input.config.providerId, modelTier: input.config.modelTier,
      outputLength: result.response.length, durationMs,
    })
    return { status: "success", output: result.response, durationMs }
  },
}

function agentErrorDiagnostic(error: string | undefined): { readonly errorName: string; readonly errorLength: number } {
  return {
    errorName: "agent",
    errorLength: error?.length ?? 0,
  }
}

function agentFailureMessage(error: string | undefined): string {
  return error || "Agent 调用失败"
}
