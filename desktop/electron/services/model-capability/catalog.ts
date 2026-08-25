import catalogData from "./catalog.json"

export type ModelCapabilitySourceKind = "official-doc" | "bailian-browser-capture"

export interface ModelCapabilitySource {
  readonly id: string
  readonly provider: string
  readonly kind: ModelCapabilitySourceKind
  readonly url: string
  readonly retrievedAt: string
}

export interface ModelCapabilityProviderScope {
  readonly id: string
  readonly label: string
  readonly baseUrls: readonly string[]
  readonly sourceIds: readonly string[]
}

export interface ModelCapabilityRecord {
  readonly providerScopeId: string
  readonly modelId: string
  readonly aliases: readonly string[]
  readonly contextWindowTokens: number
  readonly maxInputTokens?: number
  readonly maxOutputTokens?: number
  readonly reasoningMaxInputTokens?: number
  readonly reasoningMaxOutputTokens?: number
  readonly maxReasoningTokens?: number
  readonly inputModalities: readonly string[]
  readonly outputModalities: readonly string[]
  readonly capabilities: readonly string[]
  readonly features: readonly string[]
  readonly author: string
  readonly inferenceProvider: string
  readonly serviceRegions: readonly string[]
  readonly status: "online" | "offline"
  readonly equivalentSnapshot?: string
  readonly publishedAt?: string
  readonly offlineAt?: string
  readonly sourceId: string
  readonly verifiedAt: string
}

export interface ModelCapabilityCatalog {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly sources: readonly ModelCapabilitySource[]
  readonly providerScopes: readonly ModelCapabilityProviderScope[]
  readonly models: readonly ModelCapabilityRecord[]
}

export interface AgentModelContextReference {
  readonly providerScopeId: string
  readonly modelId: string
  readonly contextWindowTokens: number
  readonly maxInputTokens?: number
  readonly maxOutputTokens?: number
  readonly reasoningMaxInputTokens?: number
  readonly reasoningMaxOutputTokens?: number
  readonly maxReasoningTokens?: number
  readonly sourceLabel: string
  readonly sourceUrl: string
  readonly verifiedAt: string
}

export type AgentContextWindowConfigurationSource = "catalog" | "provider-env"

export interface ResolvedModelContextConfiguration {
  readonly modelContext?: AgentModelContextReference
  readonly configurationSource?: AgentContextWindowConfigurationSource
  readonly contextWindowTokens?: number
  readonly configurationKey?: string
}

const catalog = validateModelCapabilityCatalog(catalogData)
const sourceById = new Map(catalog.sources.map((source) => [source.id, source]))
const scopeByBaseUrl = new Map(
  catalog.providerScopes.flatMap((scope) => scope.baseUrls.map((baseUrl) => [
    normalizeProviderBaseUrl(baseUrl),
    scope,
  ] as const)),
)
const modelsByScope = new Map<string, Map<string, ModelCapabilityRecord>>()

for (const model of catalog.models) {
  const entries = modelsByScope.get(model.providerScopeId) ?? new Map<string, ModelCapabilityRecord>()
  entries.set(model.modelId, model)
  for (const alias of model.aliases) entries.set(alias, model)
  modelsByScope.set(model.providerScopeId, entries)
}

export function getModelCapabilityCatalog(): ModelCapabilityCatalog {
  return catalog
}

export function normalizeProviderBaseUrl(value: string): string {
  const parsed = new URL(value.trim())
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported Provider Base URL protocol: ${parsed.protocol}`)
  }
  const pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "")
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}`
}

export function matchModelCapability(input: {
  readonly baseUrl?: string
  readonly modelId?: string
}): ModelCapabilityRecord | undefined {
  if (!input.baseUrl || !input.modelId) return undefined
  let normalizedBaseUrl: string
  try {
    normalizedBaseUrl = normalizeProviderBaseUrl(input.baseUrl)
  } catch {
    return undefined
  }
  const scope = scopeByBaseUrl.get(normalizedBaseUrl)
  if (!scope) return undefined
  return modelsByScope.get(scope.id)?.get(input.modelId)
}

export function resolveModelContextConfiguration(input: {
  readonly baseUrl?: string
  readonly modelId?: string
  readonly configuredContextWindow?: string
}): ResolvedModelContextConfiguration {
  const matched = matchModelCapability(input)
  const modelContext = matched ? contextReference(matched) : undefined
  const configuredValue = input.configuredContextWindow?.trim()
  if (configuredValue) {
    return {
      modelContext,
      configurationSource: "provider-env",
      configurationKey: `provider-env:${configuredValue}:${referenceKey(modelContext)}`,
    }
  }
  if (!matched || !modelContext) {
    return {}
  }
  return {
    modelContext,
    configurationSource: "catalog",
    contextWindowTokens: matched.contextWindowTokens,
    configurationKey: `catalog:${referenceKey(modelContext)}`,
  }
}

export function validateModelCapabilityCatalog(value: unknown): ModelCapabilityCatalog {
  const data = recordValue(value)
  if (data?.schemaVersion !== 1) throw new Error("Model capability catalog schemaVersion must be 1")
  if (!isIsoDate(data.generatedAt)) throw new Error("Model capability catalog generatedAt must be ISO-8601")
  const sources = arrayValue(data.sources, "sources").map(validateSource)
  const providerScopes = arrayValue(data.providerScopes, "providerScopes").map(validateProviderScope)
  const models = arrayValue(data.models, "models").map(validateModel)
  assertSortedUnique(sources.map((source) => source.id), "source ids")
  assertSortedUnique(providerScopes.map((scope) => scope.id), "provider scope ids")
  assertSorted(models, (model) => `${model.providerScopeId}\u0000${model.modelId}`, "models")

  const sourceIds = new Set(sources.map((source) => source.id))
  const scopeIds = new Set(providerScopes.map((scope) => scope.id))
  const normalizedBaseUrls = new Set<string>()
  for (const scope of providerScopes) {
    for (const sourceId of scope.sourceIds) {
      if (!sourceIds.has(sourceId)) throw new Error(`Unknown source ${sourceId} in scope ${scope.id}`)
    }
    for (const baseUrl of scope.baseUrls) {
      const normalized = normalizeProviderBaseUrl(baseUrl)
      if (normalizedBaseUrls.has(normalized)) throw new Error(`Duplicate Provider Base URL: ${normalized}`)
      normalizedBaseUrls.add(normalized)
    }
  }

  const modelNames = new Set<string>()
  for (const model of models) {
    if (!scopeIds.has(model.providerScopeId)) {
      throw new Error(`Unknown Provider scope ${model.providerScopeId} for ${model.modelId}`)
    }
    if (!sourceIds.has(model.sourceId)) throw new Error(`Unknown source ${model.sourceId} for ${model.modelId}`)
    for (const name of [model.modelId, ...model.aliases]) {
      const key = `${model.providerScopeId}\u0000${name}`
      if (modelNames.has(key)) throw new Error(`Duplicate model id or alias in ${model.providerScopeId}: ${name}`)
      modelNames.add(key)
    }
    for (const [field, tokenLimit] of [
      ["maxInputTokens", model.maxInputTokens],
      ["maxOutputTokens", model.maxOutputTokens],
      ["reasoningMaxInputTokens", model.reasoningMaxInputTokens],
      ["reasoningMaxOutputTokens", model.reasoningMaxOutputTokens],
      ["maxReasoningTokens", model.maxReasoningTokens],
    ] as const) {
      if (tokenLimit !== undefined && tokenLimit > model.contextWindowTokens) {
        throw new Error(`${model.providerScopeId}/${model.modelId} ${field} exceeds context window`)
      }
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: data.generatedAt,
    sources,
    providerScopes,
    models,
  }
}

function contextReference(model: ModelCapabilityRecord): AgentModelContextReference {
  const source = sourceById.get(model.sourceId)
  if (!source) throw new Error(`Missing catalog source ${model.sourceId}`)
  return {
    providerScopeId: model.providerScopeId,
    modelId: model.modelId,
    contextWindowTokens: model.contextWindowTokens,
    ...(model.maxInputTokens === undefined ? {} : { maxInputTokens: model.maxInputTokens }),
    ...(model.maxOutputTokens === undefined ? {} : { maxOutputTokens: model.maxOutputTokens }),
    ...(model.reasoningMaxInputTokens === undefined
      ? {}
      : { reasoningMaxInputTokens: model.reasoningMaxInputTokens }),
    ...(model.reasoningMaxOutputTokens === undefined
      ? {}
      : { reasoningMaxOutputTokens: model.reasoningMaxOutputTokens }),
    ...(model.maxReasoningTokens === undefined ? {} : { maxReasoningTokens: model.maxReasoningTokens }),
    sourceLabel: source.provider,
    sourceUrl: source.url,
    verifiedAt: model.verifiedAt,
  }
}

function referenceKey(reference: AgentModelContextReference | undefined): string {
  return reference
    ? `${reference.providerScopeId}:${reference.modelId}:${reference.contextWindowTokens}:${reference.verifiedAt}`
    : "unknown"
}

function validateSource(value: unknown): ModelCapabilitySource {
  const source = requiredRecord(value, "source")
  const kind = requiredString(source.kind, "source.kind")
  if (kind !== "official-doc" && kind !== "bailian-browser-capture") {
    throw new Error(`Unsupported model capability source kind: ${kind}`)
  }
  const url = requiredString(source.url, "source.url")
  normalizeProviderBaseUrl(url)
  return {
    id: requiredString(source.id, "source.id"),
    provider: requiredString(source.provider, "source.provider"),
    kind,
    url,
    retrievedAt: requiredIsoDate(source.retrievedAt, "source.retrievedAt"),
  }
}

function validateProviderScope(value: unknown): ModelCapabilityProviderScope {
  const scope = requiredRecord(value, "provider scope")
  const baseUrls = stringArray(scope.baseUrls, "providerScope.baseUrls")
  const sourceIds = stringArray(scope.sourceIds, "providerScope.sourceIds")
  assertSortedUnique(baseUrls, "provider scope baseUrls")
  assertSortedUnique(sourceIds, "provider scope sourceIds")
  return {
    id: requiredString(scope.id, "providerScope.id"),
    label: requiredString(scope.label, "providerScope.label"),
    baseUrls,
    sourceIds,
  }
}

function validateModel(value: unknown): ModelCapabilityRecord {
  const model = requiredRecord(value, "model")
  const aliases = stringArray(model.aliases, "model.aliases")
  const inputModalities = stringArray(model.inputModalities, "model.inputModalities")
  const outputModalities = stringArray(model.outputModalities, "model.outputModalities")
  const capabilities = stringArray(model.capabilities, "model.capabilities")
  const features = stringArray(model.features, "model.features")
  const serviceRegions = stringArray(model.serviceRegions, "model.serviceRegions")
  for (const [label, values] of [
    ["model.aliases", aliases],
    ["model.inputModalities", inputModalities],
    ["model.outputModalities", outputModalities],
    ["model.capabilities", capabilities],
    ["model.features", features],
    ["model.serviceRegions", serviceRegions],
  ] as const) assertSortedUnique(values, label)
  const status = requiredString(model.status, "model.status")
  if (status !== "online" && status !== "offline") throw new Error(`Unsupported model status: ${status}`)
  return {
    providerScopeId: requiredString(model.providerScopeId, "model.providerScopeId"),
    modelId: requiredString(model.modelId, "model.modelId"),
    aliases,
    contextWindowTokens: positiveInteger(model.contextWindowTokens, "model.contextWindowTokens"),
    ...optionalPositiveIntegerField(model, "maxInputTokens"),
    ...optionalPositiveIntegerField(model, "maxOutputTokens"),
    ...optionalPositiveIntegerField(model, "reasoningMaxInputTokens"),
    ...optionalPositiveIntegerField(model, "reasoningMaxOutputTokens"),
    ...optionalPositiveIntegerField(model, "maxReasoningTokens"),
    inputModalities,
    outputModalities,
    capabilities,
    features,
    author: requiredString(model.author, "model.author"),
    inferenceProvider: requiredString(model.inferenceProvider, "model.inferenceProvider"),
    serviceRegions,
    status,
    ...optionalStringField(model, "equivalentSnapshot"),
    ...optionalStringField(model, "publishedAt"),
    ...optionalStringField(model, "offlineAt"),
    sourceId: requiredString(model.sourceId, "model.sourceId"),
    verifiedAt: requiredIsoDate(model.verifiedAt, "model.verifiedAt"),
  }
}

function optionalPositiveIntegerField<T extends string>(
  record: Record<string, unknown>,
  field: T,
): Partial<Record<T, number>> {
  return record[field] === undefined ? {} : { [field]: positiveInteger(record[field], `model.${field}`) } as Record<T, number>
}

function optionalStringField<T extends string>(
  record: Record<string, unknown>,
  field: T,
): Partial<Record<T, string>> {
  return record[field] === undefined ? {} : { [field]: requiredString(record[field], `model.${field}`) } as Record<T, string>
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = recordValue(value)
  if (!record) throw new Error(`${label} must be an object`)
  return record
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function stringArray(value: unknown, label: string): readonly string[] {
  return arrayValue(value, label).map((item) => requiredString(item, label))
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty trimmed string`)
  }
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer`)
  return value as number
}

function requiredIsoDate(value: unknown, label: string): string {
  if (!isIsoDate(value)) throw new Error(`${label} must be ISO-8601`)
  return value
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function assertSortedUnique(values: readonly string[], label: string): void {
  assertSorted(values, (value) => value, label)
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`)
}

function assertSorted<T>(values: readonly T[], key: (value: T) => string, label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (key(values[index - 1]!).localeCompare(key(values[index]!), "en") > 0) {
      throw new Error(`${label} must be stably sorted`)
    }
  }
}
