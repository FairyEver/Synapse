export type AgentPersonaModelTier = "default" | "haiku" | "sonnet" | "opus"

export type AgentPersonaProviderModelDto = {
  readonly providerId: string
  readonly modelTier: AgentPersonaModelTier
}

export type AgentPersonaToolPolicyDto =
  | { readonly mode: "all" }
  | { readonly mode: "disabled" }
  | { readonly mode: "allowlist"; readonly allowedTools: readonly string[] }

export type AgentPersonaSource = "builtin" | "user"

export type AgentPersonaBaseDto = {
  readonly id: string
  readonly schemaVersion: 1
  readonly name: string
  readonly description: string
  readonly systemPrompt: string
  readonly providerModel: AgentPersonaProviderModelDto | null
  readonly toolPolicy: AgentPersonaToolPolicyDto | null
  readonly version: number
  readonly createdAt?: string
  readonly updatedAt?: string
}

export type AgentPersonaDto =
  | (AgentPersonaBaseDto & { readonly source: "builtin"; readonly readonly: true })
  | (AgentPersonaBaseDto & { readonly source: "user"; readonly readonly: false })

export type AgentPersonaListResponseDto = {
  readonly items: readonly AgentPersonaDto[]
}

export type AgentPersonaCreateInputDto = {
  readonly name: string
  readonly description: string
  readonly systemPrompt: string
  readonly providerModel?: AgentPersonaProviderModelDto | null
  readonly toolPolicy?: AgentPersonaToolPolicyDto | null
}

export type AgentPersonaUpdateInputDto = AgentPersonaCreateInputDto

export type AgentPersonaPreferenceUpdateInputDto = {
  readonly providerModel: AgentPersonaProviderModelDto | null
  readonly toolPolicy: AgentPersonaToolPolicyDto | null
}

type ParseSuccess<T> = { readonly success: true; readonly data: T }
type ParseFailure = { readonly success: false; readonly error: Error }
type ParseResult<T> = ParseSuccess<T> | ParseFailure

type SchemaLike<T> = {
  parse(value: unknown): T
  safeParse(value: unknown): ParseResult<T>
}

export const agentPersonaProviderModelSchema = createSchema(parseProviderModel)
export const agentPersonaToolPolicySchema = createSchema(parseToolPolicy)
export const agentPersonaDtoSchema = createSchema(parsePersonaDto)
export const agentPersonaListResponseSchema = createSchema(parsePersonaListResponse)
export const agentPersonaCreateInputSchema = createSchema(parseCreateInput)
export const agentPersonaUpdateInputSchema = agentPersonaCreateInputSchema
export const agentPersonaPreferenceUpdateInputSchema = createSchema(parsePreferenceUpdateInput)

function createSchema<T>(parser: (value: unknown) => T): SchemaLike<T> {
  return {
    parse: parser,
    safeParse(value) {
      try {
        return { success: true, data: parser(value) }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error : new Error(String(error)) }
      }
    },
  }
}

function parsePersonaListResponse(value: unknown): AgentPersonaListResponseDto {
  const record = requireRecord(value, "Agent persona list response must be an object.")
  if (!Array.isArray(record.items)) throw new Error("Agent persona list items must be an array.")
  return { items: record.items.map(parsePersonaDto) }
}

function parsePersonaDto(value: unknown): AgentPersonaDto {
  const record = requireRecord(value, "Agent persona must be an object.")
  const source = requireLiteral(record.source, ["builtin", "user"], "Agent persona source is invalid.")
  const readonly = requireBoolean(record.readonly, "Agent persona readonly flag is invalid.")
  if (source === "builtin" && readonly !== true) throw new Error("Built-in persona must be readonly.")
  if (source === "user" && readonly !== false) throw new Error("User persona must be editable.")

  const base = {
    id: requireNonEmptyString(record.id, "Agent persona id is required."),
    schemaVersion: requireLiteral(record.schemaVersion, [1], "Agent persona schemaVersion is invalid."),
    name: requireLengthString(record.name, 1, 120, "Agent persona name is invalid."),
    description: requireLengthString(record.description, 1, 1000, "Agent persona description is invalid."),
    systemPrompt: requireNonEmptyString(record.systemPrompt, "Agent persona system prompt is required."),
    providerModel: record.providerModel === null ? null : parseProviderModel(record.providerModel),
    toolPolicy: record.toolPolicy === null ? null : parseToolPolicy(record.toolPolicy),
    version: requirePositiveInteger(record.version, "Agent persona version is invalid."),
    ...optionalStringProp(record, "createdAt"),
    ...optionalStringProp(record, "updatedAt"),
  }

  return source === "builtin"
    ? { ...base, source, readonly: true }
    : { ...base, source, readonly: false }
}

function parseCreateInput(value: unknown): AgentPersonaCreateInputDto {
  const record = requireRecord(value, "Agent persona input must be an object.")
  return {
    name: requireLengthString(record.name, 1, 120, "Agent persona name is invalid."),
    description: requireLengthString(record.description, 1, 1000, "Agent persona description is invalid."),
    systemPrompt: requireNonEmptyString(record.systemPrompt, "Agent persona system prompt is required."),
    ...(record.providerModel === undefined
      ? {}
      : { providerModel: record.providerModel === null ? null : parseProviderModel(record.providerModel) }),
    ...(record.toolPolicy === undefined
      ? {}
      : { toolPolicy: record.toolPolicy === null ? null : parseToolPolicy(record.toolPolicy) }),
  }
}

function parsePreferenceUpdateInput(value: unknown): AgentPersonaPreferenceUpdateInputDto {
  const record = requireRecord(value, "Agent persona preference input must be an object.")
  return {
    providerModel: record.providerModel === null ? null : parseProviderModel(record.providerModel),
    toolPolicy: record.toolPolicy === null ? null : parseToolPolicy(record.toolPolicy),
  }
}

function parseProviderModel(value: unknown): AgentPersonaProviderModelDto {
  const record = requireRecord(value, "Agent persona provider model must be an object.")
  return {
    providerId: requireNonEmptyString(record.providerId, "Agent persona provider id is required."),
    modelTier: requireLiteral(record.modelTier, ["default", "haiku", "sonnet", "opus"], "Agent persona model tier is invalid."),
  }
}

function parseToolPolicy(value: unknown): AgentPersonaToolPolicyDto {
  const record = requireRecord(value, "Agent persona tool policy must be an object.")
  const mode = requireLiteral(record.mode, ["all", "disabled", "allowlist"], "Agent persona tool policy mode is invalid.")
  if (mode !== "allowlist") return { mode }
  if (record.allowedTools === undefined) return { mode, allowedTools: [] }
  if (!Array.isArray(record.allowedTools)) throw new Error("Agent persona allowed tools must be an array.")
  return {
    mode,
    allowedTools: record.allowedTools.map((tool) =>
      requireNonEmptyString(tool, "Agent persona allowed tool is invalid.")),
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message)
  const normalized = value.trim()
  if (!normalized) throw new Error(message)
  return normalized
}

function requireLengthString(value: unknown, min: number, max: number, message: string): string {
  const normalized = requireNonEmptyString(value, message)
  if (normalized.length < min || normalized.length > max) throw new Error(message)
  return normalized
}

function requireLiteral<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  message: string,
): T {
  if (!allowed.includes(value as T)) throw new Error(message)
  return value as T
}

function requireBoolean(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") throw new Error(message)
  return value
}

function requirePositiveInteger(value: unknown, message: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1) throw new Error(message)
  return value
}

function optionalStringProp(record: Record<string, unknown>, key: "createdAt" | "updatedAt"): Record<string, string> {
  const value = record[key]
  if (value === undefined) return {}
  return { [key]: requireNonEmptyString(value, `Agent persona ${key} is invalid.`) }
}
