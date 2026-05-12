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
    const prompt = interpolate(input.config.prompt, input.resolvedVariables)

    logger.info("prompt node executing", {
      runId: input.context.runId, agent: input.config.agent,
      promptPreview: prompt.slice(0, 200),
    })

    const result = await input.agentDeps.sendToAgent({ agent: input.config.agent, prompt, abortSignal: input.context.abortSignal })
    const durationMs = Date.now() - start

    if (result.status === "failed") {
      logger.warn("prompt node agent call failed", {
        runId: input.context.runId, agent: input.config.agent,
        error: result.error, durationMs,
      })
      return { status: "failed", output: "", error: result.error, durationMs }
    }

    logger.info("prompt node succeeded", {
      runId: input.context.runId, agent: input.config.agent,
      outputPreview: result.response.slice(0, 200), durationMs,
    })
    return { status: "success", output: result.response, durationMs }
  },
}
