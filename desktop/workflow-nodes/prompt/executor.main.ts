import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { PromptNodeConfig } from "./schema"
import { createMainLogger } from "../../electron/services/log-store"

const logger = createMainLogger("workflow.node.prompt-executor")

function interpolate(template: string, vars: Record<string, string>): string {
  // Supports both {{varName}} and {{$varName}} syntax (design spec uses $-prefix)
  return template.replace(/\{\{\$?([a-zA-Z0-9_一-鿿]+)\}\}/g, (match, n) => vars[n] ?? match)
}

export const promptNodeExecutor: NodeExecutor<PromptNodeConfig> = {
  async execute(input: NodeExecutionInput<PromptNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    input.onProgress?.("resolving_variables", "解析变量…")
    const prompt = interpolate(input.config.prompt, input.resolvedVariables)

    input.onProgress?.("calling_model", "调用模型…")
    logger.info("prompt node executing", {
      runId: input.context.runId, agent: input.config.agent,
      promptPreview: prompt.slice(0, 200),
    })

    input.onProgress?.("awaiting_response", "等待响应…")
    const result = await input.agentDeps.sendToAgent({ agent: input.config.agent, prompt, abortSignal: input.context.abortSignal })
    const durationMs = Date.now() - start

    if (result.status === "failed") {
      logger.warn("prompt node agent call failed", {
        runId: input.context.runId, agent: input.config.agent,
        error: result.error, durationMs,
      })
      return { status: "failed", output: "", error: result.error, durationMs }
    }

    input.onProgress?.("processing_output", "处理输出…")
    logger.info("prompt node succeeded", {
      runId: input.context.runId, agent: input.config.agent,
      outputPreview: result.response.slice(0, 200), durationMs,
    })
    return { status: "success", output: result.response, durationMs }
  },
}
