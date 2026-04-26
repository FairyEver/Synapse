import type {
  SynapseProviderCodexConfig,
  SynapseProviderEntry,
  SynapseProviderModel,
  SynapseProviderScope,
  SynapseProviderSecretDraft,
} from "../types/provider"
import type { SynapseProjectConfig } from "../types/config"

type ProviderInput = {
  name: string
  scope?: SynapseProviderScope
  projectId?: string
  apiKey?: string
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

type ProviderDraft = {
  provider: SynapseProviderEntry
  secret: SynapseProviderSecretDraft | null
}

type CCSwitchProviderRow = {
  name: string
  appType: string
  settingsConfig: string
  isCurrent?: boolean
}

function trim(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function stableSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "provider"
}

function normalizeProviderName(name: string): string {
  return stableSlug(name)
}

function removeProviderRefsFromProjects(
  projects: readonly SynapseProjectConfig[],
  providerName: string,
): SynapseProjectConfig[] {
  const normalizedName = normalizeProviderName(providerName)

  return projects.map((project) => {
    const providerRefs = project.providerRefs?.filter(
      (ref) => normalizeProviderName(ref) !== normalizedName,
    )

    if (!project.providerRefs && !providerRefs?.length) {
      return project
    }

    return {
      ...project,
      providerRefs: providerRefs?.length ? providerRefs : undefined,
    }
  })
}

function cleanStringRecord(value: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined
  }

  const entries = Object.entries(value)
    .map(([key, item]) => [key.trim(), item.trim()] as const)
    .filter(([key, item]) => key.length > 0 && item.length > 0)

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function cleanStrings(values: string[] | undefined): string[] | undefined {
  const cleaned = values?.map((value) => value.trim()).filter(Boolean) ?? []
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined
}

function secretRefForProvider(name: string, scope: SynapseProviderScope, projectId?: string): string {
  const scopeKey = scope === "project" ? `project-${stableSlug(projectId ?? "unknown")}` : "global"
  return `provider:${scopeKey}:${stableSlug(name)}:api-key`
}

function createProviderDraft(input: ProviderInput): ProviderDraft {
  const name = normalizeProviderName(input.name)
  const scope = input.scope ?? "global"
  const apiKey = trim(input.apiKey)
  const secretRef = apiKey ? secretRefForProvider(name, scope, input.projectId) : undefined
  const provider: SynapseProviderEntry = {
    id: `${scope}:${input.projectId ? `${stableSlug(input.projectId)}:` : ""}${name}`,
    schemaVersion: 1,
    kind: "llm",
    name,
    scope,
    ...(input.projectId ? { projectId: input.projectId } : undefined),
    ...(secretRef ? { secretRef } : undefined),
    ...(trim(input.baseUrl) ? { baseUrl: trim(input.baseUrl) } : undefined),
    ...(trim(input.model) ? { model: trim(input.model) } : undefined),
    ...(trim(input.thinking) ? { thinking: trim(input.thinking) } : undefined),
    ...(cleanStringRecord(input.env) ? { env: cleanStringRecord(input.env) } : undefined),
    ...(cleanStrings(input.agentTypes) ? { agentTypes: cleanStrings(input.agentTypes) } : undefined),
    ...(input.models?.length ? { models: input.models } : undefined),
    ...(cleanStringRecord(input.endpoints) ? { endpoints: cleanStringRecord(input.endpoints) } : undefined),
    ...(cleanStringRecord(input.agentModels) ? { agentModels: cleanStringRecord(input.agentModels) } : undefined),
    ...(input.agentModelLists ? { agentModelLists: input.agentModelLists } : undefined),
    ...(input.codex ? { codex: input.codex } : undefined),
  }

  return {
    provider,
    secret: apiKey && secretRef
      ? {
          id: secretRef,
          kind: "api-key",
          description: `Provider ${name} API key`,
          value: apiKey,
        }
      : null,
  }
}

function supportsAgent(provider: SynapseProviderEntry, agentType: string): boolean {
  return !provider.agentTypes?.length || provider.agentTypes.includes(agentType)
}

function resolveProviderForAgent(
  provider: SynapseProviderEntry,
  agentType: string,
): SynapseProviderEntry {
  const baseUrl = provider.endpoints?.[agentType] || provider.baseUrl
  const model = provider.agentModels?.[agentType] || provider.model
  const modelList = provider.agentModelLists?.[agentType] || provider.models

  return {
    ...provider,
    ...(baseUrl ? { baseUrl } : { baseUrl: undefined }),
    ...(model ? { model } : { model: undefined }),
    ...(modelList?.length ? { models: modelList } : { models: undefined }),
  }
}

function resolveProjectProviders(
  globalProviders: readonly SynapseProviderEntry[],
  inlineProviders: readonly SynapseProviderEntry[],
  providerRefs: readonly string[],
  agentType: string,
): SynapseProviderEntry[] {
  const inlineNames = new Set(inlineProviders.map((provider) => provider.name))
  const globalByName = new Map(globalProviders.map((provider) => [provider.name, provider]))
  const resolved: SynapseProviderEntry[] = []

  for (const ref of providerRefs) {
    const name = normalizeProviderName(ref)
    if (inlineNames.has(name)) {
      continue
    }

    const provider = globalByName.get(name)
    if (provider && supportsAgent(provider, agentType)) {
      resolved.push(resolveProviderForAgent(provider, agentType))
    }
  }

  for (const provider of inlineProviders) {
    if (supportsAgent(provider, agentType)) {
      resolved.push(resolveProviderForAgent(provider, agentType))
    }
  }

  return resolved
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function readNestedRecord(value: unknown, key: string): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return readStringRecord((value as Record<string, unknown>)[key])
}

function parseCodexConfigToml(configText: string): Pick<ProviderInput, "baseUrl" | "model"> {
  let baseUrl: string | undefined
  let model: string | undefined

  for (const rawLine of configText.split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#") || line.startsWith("[")) {
      continue
    }

    const separatorIndex = line.indexOf("=")
    if (separatorIndex < 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "")

    if (key === "base_url" && !baseUrl) {
      baseUrl = value
    }
    if (key === "model" && !model) {
      model = value
    }
  }

  return { baseUrl, model }
}

function convertCCSwitchProvider(row: CCSwitchProviderRow): ProviderDraft {
  let parsed: unknown

  try {
    parsed = JSON.parse(row.settingsConfig)
  } catch (error) {
    throw new Error(`invalid settings_config JSON: ${error instanceof Error ? error.message : "unknown error"}`)
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid settings_config JSON: object expected")
  }

  const record = parsed as Record<string, unknown>

  if (row.appType === "claude") {
    const env = readNestedRecord(record, "env")
    const apiKey = env?.ANTHROPIC_AUTH_TOKEN
    const { ANTHROPIC_AUTH_TOKEN: _token, ANTHROPIC_BASE_URL: _baseUrl, ANTHROPIC_MODEL: _model, ...extraEnv } = env ?? {}
    void _token
    void _baseUrl
    void _model

    if (!apiKey && Object.keys(extraEnv).length === 0) {
      throw new Error("no API key or env found")
    }

    return createProviderDraft({
      name: row.name,
      apiKey,
      baseUrl: env?.ANTHROPIC_BASE_URL,
      model: env?.ANTHROPIC_MODEL,
      env: extraEnv,
      agentTypes: ["claudecode"],
    })
  }

  if (row.appType === "codex") {
    const auth = readNestedRecord(record, "auth")
    const apiKey = auth?.OPENAI_API_KEY
    const configText = typeof record.config === "string" ? record.config : ""
    const codexConfig = parseCodexConfigToml(configText)

    if (!apiKey) {
      throw new Error("no OPENAI_API_KEY found")
    }

    return createProviderDraft({
      name: row.name,
      apiKey,
      baseUrl: codexConfig.baseUrl,
      model: codexConfig.model,
      agentTypes: ["codex"],
    })
  }

  throw new Error(`unsupported app_type ${JSON.stringify(row.appType)}`)
}

export {
  convertCCSwitchProvider,
  createProviderDraft,
  normalizeProviderName,
  removeProviderRefsFromProjects,
  resolveProjectProviders,
  resolveProviderForAgent,
}
export type { CCSwitchProviderRow, ProviderDraft, ProviderInput }
