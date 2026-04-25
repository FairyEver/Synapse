export type SynapseProviderScope = "global" | "project"

export type SynapseProviderModel = {
  model: string
  alias?: string
}

export type SynapseProviderCodexConfig = {
  wireApi?: string
  httpHeaders?: Record<string, string>
}

export type SynapseProviderEntry = {
  id: string
  schemaVersion: 1
  kind: "llm"
  name: string
  scope: SynapseProviderScope
  projectId?: string
  secretRef?: string
  baseUrl?: string
  model?: string
  thinking?: string
  env?: Record<string, string>
  agentTypes?: string[]
  models?: SynapseProviderModel[]
  endpoints?: Record<string, string>
  agentModels?: Record<string, string>
  agentModelLists?: Record<string, SynapseProviderModel[]>
  codex?: SynapseProviderCodexConfig
}

export type SynapseProviderSecretDraft = {
  id: string
  kind: "api-key"
  description: string
  value: string
}

export type SynapseProjectProviderSettings = {
  projectId: string
  providerRefs: string[]
  activeProvider: string | null
}
