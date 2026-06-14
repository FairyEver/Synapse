import { existsSync, readFileSync, statSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import {
  CC_SWITCH_IMPORT_JSON_MAX_BYTES,
  CC_SWITCH_IMPORT_MAX_PROVIDER_ROWS,
} from "../../../config"

import type {
  CcSwitchClaudeImportPreview,
  CcSwitchClaudeProviderImportCandidate,
  CcSwitchClaudeProviderPreviewItem,
  CcSwitchImportSource,
  CreateProviderInput,
  ProviderApiKeyField,
  ProviderCategory,
} from "./types"

interface ResolveCcSwitchSourcesOptions {
  readonly platform?: NodeJS.Platform
  readonly homeDir?: string
  readonly envHome?: string
  readonly exists?: (filePath: string) => boolean
}

interface CcSwitchProviderRow {
  readonly id: unknown
  readonly name: unknown
  readonly settings_config: unknown
  readonly website_url: unknown
  readonly category: unknown
  readonly sort_index: unknown
  readonly notes: unknown
}

export interface ReadCcSwitchSourceResult {
  readonly kind: CcSwitchImportSource["kind"]
  readonly providers: readonly CcSwitchClaudeProviderImportCandidate[]
}

const CLAUDE_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
] as const

const API_KEY_FIELDS = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] as const
const MAPPED_ENV_KEYS = new Set<string>(CLAUDE_ENV_KEYS)

export function resolveCcSwitchCandidateSources(
  options: ResolveCcSwitchSourcesOptions = {},
): readonly CcSwitchImportSource[] {
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? os.homedir()
  const envHome = options.envHome ?? process.env.HOME
  const exists = options.exists ?? existsSync
  const sources = uniqueSources([
    sourcePair(homeDir, "sqlite"),
    sourcePair(homeDir, "json"),
    ...(platform === "win32" && envHome && envHome !== homeDir
      ? [sourcePair(envHome, "sqlite"), sourcePair(envHome, "json")]
      : []),
  ])

  return [...sources].sort((left, right) => Number(exists(right.path)) - Number(exists(left.path)))
}

export function readCcSwitchClaudeProvidersFromSource(source: CcSwitchImportSource): ReadCcSwitchSourceResult {
  if (source.kind === "sqlite") {
    return {
      kind: source.kind,
      providers: readSqliteProviders(source.path),
    }
  }

  return {
    kind: source.kind,
    providers: readLegacyJsonProviders(source.path),
  }
}

export async function readCcSwitchClaudeProvidersFromSourceAsync(
  source: CcSwitchImportSource,
): Promise<ReadCcSwitchSourceResult> {
  if (source.kind === "sqlite") {
    return readCcSwitchClaudeProvidersFromSource(source)
  }

  return {
    kind: source.kind,
    providers: parseLegacyJsonProviders(await readLegacyJsonProviderFile(source.path)),
  }
}

export function buildCcSwitchClaudeImportPreview(
  providers: readonly CcSwitchClaudeProviderImportCandidate[],
  existingProviderIds: ReadonlySet<string>,
): CcSwitchClaudeImportPreview {
  return {
    items: providers.map((provider) => {
      const env = settingsEnv(provider.settingsConfig)
      const apiKeyField = detectApiKeyField(env)
      const hasApiKey = API_KEY_FIELDS.some((key) => Boolean(env[key]?.trim()))
      const status = existingProviderIds.has(provider.id)
        ? "duplicate"
        : hasApiKey
          ? "ready"
          : "missing_api_key"
      return {
        id: provider.id,
        name: provider.name,
        category: provider.category,
        websiteUrl: provider.websiteUrl,
        note: provider.note,
        baseUrl: env.ANTHROPIC_BASE_URL,
        apiKeyField,
        model: env.ANTHROPIC_MODEL,
        haikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
        sonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
        opusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
        status,
        selectedByDefault: status === "ready",
      }
    }),
  }
}

export function buildProviderInputFromCcSwitchCandidate(
  provider: CcSwitchClaudeProviderImportCandidate,
  sortIndex: number,
): CreateProviderInput {
  const env = settingsEnv(provider.settingsConfig)
  const apiKeyField = detectApiKeyField(env)
  const apiKey = env[apiKeyField]
  const extraEnv = pickExtraEnv(provider.settingsConfig)

  return {
    id: provider.id,
    name: provider.name,
    note: provider.note,
    websiteUrl: provider.websiteUrl,
    category: provider.category,
    baseUrl: env.ANTHROPIC_BASE_URL,
    apiKeyField,
    apiKey,
    model: env.ANTHROPIC_MODEL,
    haikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    sonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    opusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    env: extraEnv.publicEnv,
    settingsConfig: redactedSettingsConfig(provider.settingsConfig),
    secretEnv: Object.keys(extraEnv.secretEnv).length ? extraEnv.secretEnv : undefined,
    sortIndex,
  }
}

function sourcePair(homeDir: string, kind: CcSwitchImportSource["kind"]): CcSwitchImportSource {
  return {
    kind,
    path: path.join(homeDir, ".cc-switch", kind === "sqlite" ? "cc-switch.db" : "config.json"),
  }
}

function uniqueSources(sources: readonly CcSwitchImportSource[]): readonly CcSwitchImportSource[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = `${source.kind}:${source.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function readSqliteProviders(filePath: string): readonly CcSwitchClaudeProviderImportCandidate[] {
  const db = new DatabaseSync(filePath, { readOnly: true })
  try {
    const rows = db.prepare(`
      SELECT id, name, settings_config, website_url, category, sort_index, notes
      FROM providers
      WHERE app_type = 'claude'
      ORDER BY sort_index ASC, created_at ASC, name ASC
      LIMIT ${CC_SWITCH_IMPORT_MAX_PROVIDER_ROWS + 1}
    `).all() as unknown as readonly CcSwitchProviderRow[]

    return rows.slice(0, CC_SWITCH_IMPORT_MAX_PROVIDER_ROWS).map(rowToCandidate).filter(isImportCandidate)
  } finally {
    db.close()
  }
}

function readLegacyJsonProviders(filePath: string): readonly CcSwitchClaudeProviderImportCandidate[] {
  assertLegacyJsonFileSize(statSync(filePath).size)
  return parseLegacyJsonProviders(readFileSync(filePath, "utf8"))
}

async function readLegacyJsonProviderFile(filePath: string): Promise<string> {
  assertLegacyJsonFileSize((await stat(filePath)).size)
  return readFile(filePath, "utf8")
}

function assertLegacyJsonFileSize(size: number): void {
  if (size > CC_SWITCH_IMPORT_JSON_MAX_BYTES) {
    throw new Error("CC Switch 配置文件过大，无法导入。")
  }
}

function parseLegacyJsonProviders(raw: string): readonly CcSwitchClaudeProviderImportCandidate[] {
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed) || !isRecord(parsed.apps) || !isRecord(parsed.apps.claude)) return []
  const providers = parsed.apps.claude.providers
  if (!isRecord(providers)) return []

  return Object.entries(providers)
    .map(([id, value]) => legacyProviderToCandidate(id, value))
    .filter(isImportCandidate)
}

function rowToCandidate(row: CcSwitchProviderRow): CcSwitchClaudeProviderImportCandidate | null {
  if (typeof row.id !== "string" || typeof row.name !== "string") return null
  return {
    id: row.id,
    name: row.name,
    category: providerCategory(row.category),
    websiteUrl: stringValue(row.website_url),
    note: stringValue(row.notes),
    settingsConfig: parseSettingsConfig(row.settings_config),
    sortIndex: numberValue(row.sort_index),
  }
}

function legacyProviderToCandidate(
  id: string,
  value: unknown,
): CcSwitchClaudeProviderImportCandidate | null {
  if (!isRecord(value)) return null
  const candidateId = stringValue(value.id) ?? id
  const name = stringValue(value.name) ?? candidateId
  return {
    id: candidateId,
    name,
    category: providerCategory(value.category),
    websiteUrl: stringValue(value.websiteUrl ?? value.website_url),
    note: stringValue(value.notes ?? value.note),
    settingsConfig: settingsConfigValue(value.settingsConfig ?? value.settings_config),
    sortIndex: numberValue(value.sortIndex ?? value.sort_index),
  }
}

function parseSettingsConfig(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {}
  try {
    return settingsConfigValue(JSON.parse(value) as unknown)
  } catch {
    return {}
  }
}

function settingsConfigValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function settingsEnv(settingsConfig: Record<string, unknown>): Record<(typeof CLAUDE_ENV_KEYS)[number], string | undefined> {
  const env = isRecord(settingsConfig.env) ? settingsConfig.env : {}
  return Object.fromEntries(
    CLAUDE_ENV_KEYS.map((key) => [key, stringValue(env[key])]),
  ) as Record<(typeof CLAUDE_ENV_KEYS)[number], string | undefined>
}

function detectApiKeyField(
  env: Record<(typeof CLAUDE_ENV_KEYS)[number], string | undefined>,
): ProviderApiKeyField {
  return env.ANTHROPIC_API_KEY?.trim() ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN"
}

function pickExtraEnv(settingsConfig: Record<string, unknown>): {
  readonly publicEnv: Record<string, string>
  readonly secretEnv: Record<string, string>
} {
  const env = isRecord(settingsConfig.env) ? settingsConfig.env : {}
  const publicEnv: Record<string, string> = {}
  const secretEnv: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(env)) {
    if (MAPPED_ENV_KEYS.has(key) || typeof rawValue !== "string" || !rawValue.trim()) continue
    if (isSensitiveEnvName(key)) {
      secretEnv[key] = rawValue
    } else {
      publicEnv[key] = rawValue
    }
  }
  return { publicEnv, secretEnv }
}

function redactedSettingsConfig(settingsConfig: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(settingsConfig.env)) return settingsConfig
  return {
    ...settingsConfig,
    env: Object.fromEntries(
      Object.entries(settingsConfig.env).filter(([key, value]) =>
        typeof value === "string" && value.trim() && !isSensitiveEnvName(key),
      ),
    ),
  }
}

function isSensitiveEnvName(key: string): boolean {
  return /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_KEY)/i.test(key)
}

function isImportCandidate(value: CcSwitchClaudeProviderImportCandidate | null): value is CcSwitchClaudeProviderImportCandidate {
  return value !== null && Boolean(value.id.trim()) && Boolean(value.name.trim())
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}
