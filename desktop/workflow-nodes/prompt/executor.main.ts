import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { PromptNodeConfig } from "./schema"

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z0-9_\u4e00-\u9fff]+)\}\}/g, (_, n) => vars[n] ?? `{{${n}}}`)
}

export const promptNodeExecutor: NodeExecutor<PromptNodeConfig> = {
  async execute(input: NodeExecutionInput<PromptNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const prompt = interpolate(input.config.prompt, input.resolvedVariables)
    const result = await input.agentDeps.sendToAgent({ agent: input.config.agent, prompt, abortSignal: input.context.abortSignal })
    const durationMs = Date.now() - start
    if (result.status === "failed") return { status: "failed", output: "", error: result.error, durationMs }
    return { status: "success", output: result.response, durationMs }
  },
}
