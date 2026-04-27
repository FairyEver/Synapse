import { ClaudeCodeAdapter } from "../../../../electron/services/agent-runtime/adapters/claude-code"
import type { AgentRuntimeDefinition } from "../../main-types"
import { agentBaseDefinition } from "./agent-shared"

export const agentRuntimeDefinition = {
  ...agentBaseDefinition,
  createAdapter(view, runner) {
    return new ClaudeCodeAdapter(runner, {
      model: view.model,
      effort: view.provider?.effort,
      mode: view.mode,
      env: view.env,
      envAllowlist: view.envAllowlist,
    })
  },
  buildEnv({ provider, apiKey, model }) {
    if (!provider) return { env: {} }
    const env: Record<string, string | undefined> = {}
    if (provider.baseUrl) {
      env.ANTHROPIC_BASE_URL = provider.baseUrl
      if (apiKey) {
        env.ANTHROPIC_AUTH_TOKEN = apiKey
        env.ANTHROPIC_API_KEY = ""
      }
    } else if (apiKey) {
      env.ANTHROPIC_API_KEY = apiKey
    }
    if (model) env.ANTHROPIC_MODEL = model
    return { env: { ...env, ...provider.env } }
  },
} satisfies AgentRuntimeDefinition
