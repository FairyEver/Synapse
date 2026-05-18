import type { ProviderPreset } from "./claude-provider-presets"
import type { CreateProviderInput, ProviderApiKeyField } from "./types"

export interface BuildProviderInputFromPresetOptions {
  readonly preset: ProviderPreset
  readonly providerId?: string
  readonly name?: string
  readonly apiKey?: string
  readonly templateValues?: Record<string, string>
  readonly active?: boolean
  readonly sortIndex?: number
  readonly existingIds: ReadonlySet<string>
}

const MAPPED_ENV_KEYS = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
])

export function buildProviderInputFromClaudePreset(
  options: BuildProviderInputFromPresetOptions,
): CreateProviderInput {
  const settingsConfig = applyTemplateValues(
    options.preset.settingsConfig,
    options.templateValues ?? {},
  )
  const env = isRecord(settingsConfig) && isRecord(settingsConfig.env) ? settingsConfig.env : {}
  const apiKeyField = resolveApiKeyField(options.preset, settingsConfig, env)
  const extraEnv: Record<string, string> = {}
  const secretEnv: Record<string, string> = {}

  for (const [key, rawValue] of Object.entries(env)) {
    if (MAPPED_ENV_KEYS.has(key)) continue
    const value = stringifyEnvValue(rawValue)
    if (value === undefined) continue
    if (isSensitiveEnvName(key)) {
      secretEnv[key] = value
    } else {
      extraEnv[key] = value
    }
  }

  return {
    id: options.providerId?.trim() || providerIdFromPresetName(options.preset.name, options.existingIds),
    name: options.name?.trim() || options.preset.name,
    websiteUrl: options.preset.websiteUrl,
    category: options.preset.category ?? "custom",
    baseUrl: stringValue(env.ANTHROPIC_BASE_URL),
    apiKeyField,
    apiKey: options.apiKey,
    active: options.active,
    model: stringValue(env.ANTHROPIC_MODEL),
    haikuModel: stringValue(env.ANTHROPIC_DEFAULT_HAIKU_MODEL),
    sonnetModel: stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
    opusModel: stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
    env: extraEnv,
    secretEnv: Object.keys(secretEnv).length ? secretEnv : undefined,
    sortIndex: options.sortIndex,
  }
}

export function providerIdFromPresetName(name: string, existingIds: ReadonlySet<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "provider"
  if (!existingIds.has(base)) return base
  let suffix = 2
  while (existingIds.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function applyTemplateValues(value: unknown, templateValues: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key: string) => templateValues[key] ?? "")
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyTemplateValues(item, templateValues))
  }
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, applyTemplateValues(item, templateValues)]),
  )
}

function resolveApiKeyField(
  preset: ProviderPreset,
  settingsConfig: unknown,
  env: Record<string, unknown>,
): ProviderApiKeyField {
  if (preset.apiKeyField) return preset.apiKeyField
  if (typeof env.ANTHROPIC_API_KEY === "string") return "ANTHROPIC_API_KEY"
  if (isRecord(settingsConfig) && typeof settingsConfig.apiKey === "string") return "ANTHROPIC_API_KEY"
  return "ANTHROPIC_AUTH_TOKEN"
}

function isSensitiveEnvName(name: string): boolean {
  return /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/i.test(name)
}

function stringifyEnvValue(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
