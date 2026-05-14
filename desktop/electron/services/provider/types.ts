export const PROVIDER_SERVICE_ID = "provider"
export const LOCAL_CLAUDE_CODE_PROVIDER_ID = "local-claude-code"

export type ProviderCategory =
  | "official"
  | "cn_official"
  | "cloud_provider"
  | "aggregator"
  | "third_party"
  | "custom"

export type ProviderApiKeyField = "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY"

export interface CCProvider {
  id: string
  name: string
  category: ProviderCategory
  source?: "local" | "user"
  readonly?: boolean
  configured?: boolean
  configPath?: string
  baseUrl?: string
  apiKeyField: ProviderApiKeyField
  active?: boolean
  model?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
  env: Record<string, string>
  secretRef?: string
  secretEnvRefs?: Record<string, string>
  archived?: boolean
  sortIndex?: number
  createdAt: string
  updatedAt: string
}

export interface CreateProviderInput {
  readonly id: string
  readonly name: string
  readonly category: ProviderCategory
  readonly baseUrl?: string
  readonly apiKeyField: ProviderApiKeyField
  readonly apiKey?: string
  readonly active?: boolean
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly env: Record<string, string>
  readonly secretEnv?: Record<string, string>
  readonly sortIndex?: number
}

export interface UpdateProviderInput {
  readonly name?: string
  readonly category?: ProviderCategory
  readonly baseUrl?: string
  readonly apiKeyField?: ProviderApiKeyField
  readonly apiKey?: string
  readonly active?: boolean
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly env?: Record<string, string>
  readonly secretEnv?: Record<string, string>
  readonly clearSecretEnv?: readonly string[]
  readonly archived?: boolean
  readonly sortIndex?: number
}

export interface ProviderPresetTemplateValue {
  readonly key: string
  readonly label: string
  readonly placeholder: string
  readonly defaultValue?: string
  readonly sensitive: boolean
}

export interface CCProviderPreset {
  readonly name: string
  readonly category: ProviderCategory
  readonly websiteUrl?: string
  readonly apiKeyUrl?: string
  readonly baseUrl?: string
  readonly apiKeyField: ProviderApiKeyField
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly templateValues: readonly ProviderPresetTemplateValue[]
}

export interface CreateProviderFromPresetInput {
  readonly presetName: string
  readonly providerId?: string
  readonly name?: string
  readonly apiKey?: string
  readonly templateValues?: Record<string, string>
  readonly active?: boolean
  readonly sortIndex?: number
}
