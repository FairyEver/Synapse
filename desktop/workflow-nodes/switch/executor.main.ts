import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { SwitchNodeConfig } from "./schema"

function interpolate(t: string, v: Record<string, string>): string {
  return t.replace(/\{\{\$([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, n) => v[n] ?? `{{$${n}}}`)
}

export const switchNodeExecutor: NodeExecutor<SwitchNodeConfig> = {
  async execute(input: NodeExecutionInput<SwitchNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, resolvedVariables, agentDeps, context } = input
    const ids = config.branches.map((b) => b.id)
    const basePrompt = interpolate(config.prompt, resolvedVariables)
    const prompt = `${basePrompt}\n\n---\n你必须只回复以下选项之一（不要包含任何其他文字）：\n${ids.map((id) => `- ${id}`).join("\n")}`

    const agentResult = await agentDeps.sendToAgent({ agent: config.agent, prompt, abortSignal: context.abortSignal })
    const durationMs = Date.now() - start
    if (agentResult.status === "failed") return { status: "failed", output: "", error: agentResult.error, durationMs }

    const raw = agentResult.response.trim().toLowerCase()
    const matched = ids.find((id) => id === raw)
    if (matched) return { status: "success", output: raw, activeBranch: matched, durationMs }
    if (config.defaultBranch) return { status: "success", output: config.defaultBranch, activeBranch: config.defaultBranch, durationMs }
    return {
      status: "failed", output: "", durationMs,
      error: `Agent 响应 "${agentResult.response.trim()}" 不匹配任何分支 [${ids.join(", ")}]`,
    }
  },
}
