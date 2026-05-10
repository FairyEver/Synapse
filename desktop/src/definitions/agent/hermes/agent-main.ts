import { HermesExecAdapter } from "../../../../electron/services/agent-runtime/adapters/hermes-exec"
import type { AgentRuntimeDefinition } from "../../main-types"
import { agentBaseDefinition } from "./agent-shared"

export const agentRuntimeDefinition = {
  ...agentBaseDefinition,
  createAdapter(view, runner) {
    return new HermesExecAdapter(runner, {
      command: view.runtimeCommand ?? "hermes",
      mode: view.mode,
      env: view.env,
      envAllowlist: view.envAllowlist,
    })
  },
  buildEnv({ provider, apiKey }) {
    const env: Record<string, string | undefined> = {}
    if (apiKey) env.HERMES_API_KEY = apiKey
    if (provider?.baseUrl) env.HERMES_BASE_URL = provider.baseUrl
    return { env: { ...env, ...provider?.env } }
  },
} satisfies AgentRuntimeDefinition
