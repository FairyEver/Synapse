import { CodexExecAdapter } from "../../../../electron/services/agent-runtime/adapters/codex-exec"
import type { AgentRuntimeDefinition } from "../../main-types"
import { agentBaseDefinition } from "./agent-shared"

export const agentRuntimeDefinition = {
  ...agentBaseDefinition,
  createAdapter(view, runner) {
    return new CodexExecAdapter(runner, {
      model: view.model,
      provider: view.provider?.id,
      baseUrl: view.baseUrl,
      effort: view.provider?.effort,
      mode: view.mode,
      backend: "app-server",
      env: {
        ...view.env,
        CODEX_HOME: view.provider?.codex?.codexHome ?? view.env.CODEX_HOME,
      },
      envAllowlist: [
        ...view.envAllowlist,
        ...(view.provider?.codex?.codexHome ? ["CODEX_HOME"] : []),
      ],
    })
  },
  buildEnv({ provider, apiKey }) {
    if (!provider) return { env: {} }
    const env: Record<string, string | undefined> = {}
    if (apiKey) env.OPENAI_API_KEY = apiKey
    if (provider.baseUrl) env.OPENAI_BASE_URL = provider.baseUrl
    return { env: { ...env, ...provider.env } }
  },
} satisfies AgentRuntimeDefinition
