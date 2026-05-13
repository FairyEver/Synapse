import type {
  DataNamespace,
  ProviderEntryV1,
  SecretEntryV1,
} from "../../runtime/data-repo"
import { ProviderSecretStore, providerApiKeySecretId } from "./provider-secret-store"
import type {
  CCProvider,
  CreateProviderInput,
  ProviderApiKeyField,
  ProviderCategory,
  UpdateProviderInput,
} from "./types"

export interface ProviderServiceDeps {
  readonly providers: DataNamespace<ProviderEntryV1>
  readonly secrets: DataNamespace<SecretEntryV1>
  readonly now?: () => Date
}

const PROVIDER_KIND = "cc-provider"

export class ProviderService {
  private readonly providers: DataNamespace<ProviderEntryV1>
  private readonly secretStore: ProviderSecretStore
  private readonly now?: () => Date

  constructor(deps: ProviderServiceDeps) {
    this.providers = deps.providers
    this.secretStore = new ProviderSecretStore(deps.secrets)
    this.now = deps.now
  }

  async listProviders(): Promise<readonly CCProvider[]> {
    const providers = await this.providers.list({ scope: "global", kind: PROVIDER_KIND } as Partial<ProviderEntryV1>)
    return providers
      .map(toProvider)
      .filter((provider) => !provider.archived)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
  }

  async createProvider(input: CreateProviderInput): Promise<CCProvider> {
    const now = this.isoNow()
    const secretRef = input.apiKey === undefined
      ? undefined
      : await this.secretStore.setApiKey(input.id, input.apiKey, `${input.name} API key`)
    const provider = toProviderEntry({
      id: input.id,
      name: input.name,
      category: input.category,
      baseUrl: input.baseUrl,
      apiKeyField: input.apiKeyField,
      active: input.active,
      model: input.model,
      haikuModel: input.haikuModel,
      sonnetModel: input.sonnetModel,
      opusModel: input.opusModel,
      env: input.env,
      secretRef,
      sortIndex: input.sortIndex,
      createdAt: now,
      updatedAt: now,
    })
    await this.providers.upsert(provider)
    if (input.active) {
      await this.setActiveProvider(input.id)
      const active = await this.getProvider(input.id)
      return active
    }
    return toProvider(provider)
  }

  async updateProvider(id: string, patch: UpdateProviderInput): Promise<CCProvider> {
    const existing = await this.getProvider(id)
    const secretRef = patch.apiKey === undefined
      ? existing.secretRef
      : await this.secretStore.setApiKey(id, patch.apiKey, `${patch.name ?? existing.name} API key`)
    const updated: CCProvider = {
      ...existing,
      ...providerPatch(patch),
      secretRef,
      updatedAt: this.isoNow(),
    }
    await this.providers.upsert(toProviderEntry(updated))
    if (patch.active) {
      await this.setActiveProvider(id)
      return this.getProvider(id)
    }
    return updated
  }

  async archiveProvider(id: string): Promise<void> {
    await this.updateProvider(id, { active: false, archived: true })
  }

  async setActiveProvider(id: string): Promise<void> {
    const target = await this.getProvider(id)
    const now = this.isoNow()
    const providers = await this.providers.list({ scope: "global", kind: PROVIDER_KIND } as Partial<ProviderEntryV1>)
    for (const provider of providers) {
      const current = toProvider(provider)
      await this.providers.upsert(toProviderEntry({
        ...current,
        active: current.id === target.id,
        updatedAt: now,
      }))
    }
  }

  async getActiveProvider(): Promise<CCProvider | null> {
    const providers = await this.providers.list({ scope: "global", kind: PROVIDER_KIND } as Partial<ProviderEntryV1>)
    const active = providers.map(toProvider).find((provider) => provider.active && !provider.archived)
    return active ?? null
  }

  async buildEnv(providerId: string): Promise<Record<string, string>> {
    const provider = await this.getProvider(providerId)
    const secret = provider.secretRef
      ? await this.secretStore.getSecretValue(provider.secretRef)
      : undefined
    const env: Record<string, string | undefined> = {}

    if (provider.baseUrl) env.ANTHROPIC_BASE_URL = provider.baseUrl
    if (provider.apiKeyField === "ANTHROPIC_AUTH_TOKEN") {
      env.ANTHROPIC_AUTH_TOKEN = secret
      env.ANTHROPIC_API_KEY = ""
    } else {
      env.ANTHROPIC_API_KEY = secret
    }
    if (provider.haikuModel) env.ANTHROPIC_SMALL_FAST_MODEL = provider.haikuModel
    if (provider.model) env.ANTHROPIC_MODEL = provider.model

    return compactEnv({
      ...env,
      ...provider.env,
    })
  }

  private async getProvider(id: string): Promise<CCProvider> {
    const provider = await this.providers.get(id)
    if (!provider || provider.kind !== PROVIDER_KIND) {
      throw new Error(`Provider not found: ${id}`)
    }
    return toProvider(provider)
  }

  private isoNow(): string {
    return (this.now?.() ?? new Date()).toISOString()
  }
}

function toProviderEntry(provider: CCProvider): ProviderEntryV1 {
  return removeUndefined({
    id: provider.id,
    schemaVersion: 1,
    scope: "global",
    kind: PROVIDER_KIND,
    display: provider.name,
    baseUrl: provider.baseUrl,
    secretRef: provider.secretRef ?? providerApiKeySecretId(provider.id),
    activeModel: provider.model,
    env: provider.env,
    category: provider.category,
    apiKeyField: provider.apiKeyField,
    active: provider.active,
    haikuModel: provider.haikuModel,
    sonnetModel: provider.sonnetModel,
    opusModel: provider.opusModel,
    archived: provider.archived,
    sortIndex: provider.sortIndex,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  }) as ProviderEntryV1
}

function toProvider(entry: ProviderEntryV1): CCProvider {
  return {
    id: entry.id,
    name: typeof entry.display === "string" ? entry.display : entry.id,
    category: providerCategory(entry.category),
    baseUrl: entry.baseUrl,
    apiKeyField: apiKeyField(entry.apiKeyField),
    active: booleanValue(entry.active),
    model: entry.activeModel,
    haikuModel: stringValue(entry.haikuModel),
    sonnetModel: stringValue(entry.sonnetModel),
    opusModel: stringValue(entry.opusModel),
    env: entry.env ?? {},
    secretRef: entry.secretRef,
    archived: booleanValue(entry.archived),
    sortIndex: numberValue(entry.sortIndex),
    createdAt: entry.createdAt ?? "",
    updatedAt: entry.updatedAt ?? "",
  }
}

function compactEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined),
  ) as Record<string, string>
}

function providerPatch(input: UpdateProviderInput): Partial<CCProvider> {
  return removeUndefined({
    name: input.name,
    category: input.category,
    baseUrl: input.baseUrl,
    apiKeyField: input.apiKeyField,
    active: input.active,
    model: input.model,
    haikuModel: input.haikuModel,
    sonnetModel: input.sonnetModel,
    opusModel: input.opusModel,
    env: input.env,
    archived: input.archived,
    sortIndex: input.sortIndex,
  })
}

function removeUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T
}

function providerCategory(value: unknown): ProviderCategory {
  if (
    value === "official"
    || value === "cn_official"
    || value === "cloud_provider"
    || value === "aggregator"
    || value === "third_party"
    || value === "custom"
  ) {
    return value
  }
  return "custom"
}

function apiKeyField(value: unknown): ProviderApiKeyField {
  return value === "ANTHROPIC_API_KEY" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN"
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}
