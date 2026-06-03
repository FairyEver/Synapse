import type {
  CCProvider,
  CreateProviderInput,
  ProviderApiKeyField,
  ProviderCategory,
  ProviderPackageImportPreview,
} from "./types"

const PACKAGE_KIND = "synapse.provider.package"
const PACKAGE_VERSION = 1

export interface SynapseProviderPackageV1 {
  readonly kind: typeof PACKAGE_KIND
  readonly version: typeof PACKAGE_VERSION
  readonly exportedAt: string
  readonly provider: {
    readonly id: string
    readonly name: string
    readonly category: ProviderCategory
    readonly note?: string
    readonly websiteUrl?: string
    readonly baseUrl?: string
    readonly apiKeyField: ProviderApiKeyField
    readonly model?: string
    readonly haikuModel?: string
    readonly sonnetModel?: string
    readonly opusModel?: string
    readonly env?: Record<string, string>
    readonly settingsConfig?: Record<string, unknown>
    readonly source?: "local" | "user"
  }
  readonly secrets: {
    readonly apiKey: string
    readonly env?: Record<string, string>
  }
}

function buildProviderPackage(input: {
  readonly exportedAt: string
  readonly provider: CCProvider
  readonly apiKey: string
  readonly secretEnv?: Record<string, string>
}): SynapseProviderPackageV1 {
  const provider = input.provider
  return {
    kind: PACKAGE_KIND,
    version: PACKAGE_VERSION,
    exportedAt: input.exportedAt,
    provider: removeUndefined({
      id: provider.id,
      name: provider.name,
      category: provider.category,
      note: provider.note,
      websiteUrl: provider.websiteUrl,
      baseUrl: provider.baseUrl,
      apiKeyField: provider.apiKeyField,
      model: provider.model,
      haikuModel: provider.haikuModel,
      sonnetModel: provider.sonnetModel,
      opusModel: provider.opusModel,
      env: provider.env,
      settingsConfig: provider.settingsConfig,
    }),
    secrets: {
      apiKey: input.apiKey,
      env: input.secretEnv ?? {},
    },
  }
}

function parseProviderPackage(value: unknown): SynapseProviderPackageV1 {
  if (!isRecord(value) || value.kind !== PACKAGE_KIND) {
    throw new Error("无法识别该文件")
  }
  if (value.version !== PACKAGE_VERSION) {
    throw new Error("不支持的配置版本")
  }
  if (!isRecord(value.provider) || !isRecord(value.secrets)) {
    throw new Error("配置不完整")
  }

  const provider = value.provider
  if (provider.source === "local" || provider.id === "local-claude-code") {
    throw new Error("不支持导入内置供应商")
  }
  if (!isNonEmptyString(provider.id)
    || !isNonEmptyString(provider.name)
    || !isProviderCategory(provider.category)
    || !isProviderApiKeyField(provider.apiKeyField)
    || !isNonEmptyString(value.secrets.apiKey)) {
    throw new Error("配置不完整")
  }

  return {
    kind: PACKAGE_KIND,
    version: PACKAGE_VERSION,
    exportedAt: isNonEmptyString(value.exportedAt) ? value.exportedAt : "",
    provider: removeUndefined({
      id: provider.id,
      name: provider.name,
      category: provider.category,
      note: optionalString(provider.note),
      websiteUrl: optionalString(provider.websiteUrl),
      baseUrl: optionalString(provider.baseUrl),
      apiKeyField: provider.apiKeyField,
      model: optionalString(provider.model),
      haikuModel: optionalString(provider.haikuModel),
      sonnetModel: optionalString(provider.sonnetModel),
      opusModel: optionalString(provider.opusModel),
      env: stringRecord(provider.env),
      settingsConfig: recordValue(provider.settingsConfig),
    }),
    secrets: {
      apiKey: value.secrets.apiKey,
      env: stringRecord(value.secrets.env) ?? {},
    },
  }
}

function resolveProviderPackageTargetId(sourceId: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(sourceId)) return sourceId
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${sourceId}-${index}`
    if (!existingIds.has(candidate)) return candidate
  }
  throw new Error("无法生成供应商 ID")
}

function providerPackagePreview(
  pkg: SynapseProviderPackageV1,
  sourcePath: string,
  existingIds: ReadonlySet<string>,
): ProviderPackageImportPreview {
  return {
    sourcePath,
    packageVersion: 1,
    sourceProviderId: pkg.provider.id,
    targetProviderId: resolveProviderPackageTargetId(pkg.provider.id, existingIds),
    name: pkg.provider.name,
    category: pkg.provider.category,
    baseUrl: pkg.provider.baseUrl,
    apiKeyField: pkg.provider.apiKeyField,
    model: pkg.provider.model,
    haikuModel: pkg.provider.haikuModel,
    sonnetModel: pkg.provider.sonnetModel,
    opusModel: pkg.provider.opusModel,
  }
}

function createProviderInputFromPackage(
  pkg: SynapseProviderPackageV1,
  targetProviderId: string,
  sortIndex: number,
): CreateProviderInput {
  return {
    id: targetProviderId,
    name: pkg.provider.name,
    note: pkg.provider.note,
    websiteUrl: pkg.provider.websiteUrl,
    category: pkg.provider.category,
    baseUrl: pkg.provider.baseUrl,
    apiKeyField: pkg.provider.apiKeyField,
    apiKey: pkg.secrets.apiKey,
    active: false,
    model: pkg.provider.model,
    haikuModel: pkg.provider.haikuModel,
    sonnetModel: pkg.provider.sonnetModel,
    opusModel: pkg.provider.opusModel,
    env: pkg.provider.env ?? {},
    settingsConfig: pkg.provider.settingsConfig,
    secretEnv: pkg.secrets.env ?? {},
    sortIndex,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry
  }
  return result
}

function isProviderCategory(value: unknown): value is ProviderCategory {
  return value === "official"
    || value === "cn_official"
    || value === "cloud_provider"
    || value === "aggregator"
    || value === "third_party"
    || value === "custom"
}

function isProviderApiKeyField(value: unknown): value is ProviderApiKeyField {
  return value === "ANTHROPIC_AUTH_TOKEN" || value === "ANTHROPIC_API_KEY"
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

export {
  buildProviderPackage,
  createProviderInputFromPackage,
  parseProviderPackage,
  providerPackagePreview,
  resolveProviderPackageTargetId,
}
