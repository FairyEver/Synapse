import { matchModelCapabilityProviderScope } from "../model-capability/catalog"

export interface AgentProviderTransportPolicy {
  readonly id: "bailian-anthropic-6m"
  readonly providerScopeId: "bailian-cn"
  readonly maxRequestBodyBytes: number
  readonly requestBodyBudgetBytes: number
  readonly autoCompactWindowTokens: number
  readonly maxToolOutputBytes: number
  readonly maxToolBatchOutputBytes: number
}

const BAILIAN_ANTHROPIC_POLICY: AgentProviderTransportPolicy = {
  id: "bailian-anthropic-6m",
  providerScopeId: "bailian-cn",
  maxRequestBodyBytes: 6 * 1024 * 1024,
  requestBodyBudgetBytes: 5 * 1024 * 1024,
  autoCompactWindowTokens: 200_000,
  maxToolOutputBytes: 8 * 1024,
  maxToolBatchOutputBytes: 24 * 1024,
}

export function resolveAgentProviderTransportPolicy(input: {
  readonly baseUrl?: string
}): AgentProviderTransportPolicy | undefined {
  const scope = matchModelCapabilityProviderScope(input.baseUrl)
  return scope?.id === BAILIAN_ANTHROPIC_POLICY.providerScopeId
    ? BAILIAN_ANTHROPIC_POLICY
    : undefined
}
