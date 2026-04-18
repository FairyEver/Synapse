import {
  DEFAULT_CONFIG,
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_REPOSITORY_CONTENT_DIRECTORIES,
  DEFAULT_THEME_MODE,
} from "../constants/defaults"
import {
  CONTENT_TYPE_DEFINITIONS,
  getContentTypeDefinition,
} from "../config/content-types"
import { SYNAPSE_THEME_MODE_OPTIONS } from "../types/config"
import type { SynapseContentType } from "../types/content"
import type {
  SynapseConfig,
  SynapseConfigPatch,
  SynapseGlobalConfig,
  SynapseProjectConfig,
  SynapseRepositoryConfig,
  SynapseThemeMode,
} from "../types/config"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isDefined<T>(value: T | null): value is T {
  return value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isSynapseThemeMode(value: unknown): value is SynapseThemeMode {
  return typeof value === "string" && SYNAPSE_THEME_MODE_OPTIONS.includes(value as SynapseThemeMode)
}

function asTrimmedString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback
}

function normalizeDirectoryName(value: unknown, fallback: string): string {
  const nextValue = asTrimmedString(value, fallback)

  return nextValue.length > 0 ? nextValue : fallback
}

function hasContentDirsFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  return Object.values(value).some((directoryName) => typeof directoryName !== "string")
}

function normalizeThemeMode(value: unknown, fallback: SynapseThemeMode): SynapseThemeMode {
  return isSynapseThemeMode(value) ? value : fallback
}

function dedupeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seenKeys = new Set<string>()

  return items.filter((item) => {
    const key = getKey(item)

    if (seenKeys.has(key)) {
      return false
    }

    seenKeys.add(key)

    return true
  })
}

function getPathDisplayName(localPath: string): string {
  const normalizedPath = localPath.replace(/[\\/]+$/, "")
  const segments = normalizedPath.split(/[\\/]/).filter((segment) => segment.length > 0)

  return segments.at(-1) ?? localPath
}

function hasProjectConfigFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  if (hasOwnKey(value, "id") && typeof value.id !== "string") {
    return true
  }

  if (hasOwnKey(value, "name") && typeof value.name !== "string") {
    return true
  }

  if (hasOwnKey(value, "path") && typeof value.path !== "string") {
    return true
  }

  return false
}

function hasRepositoryConfigFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  if (hasOwnKey(value, "uuid") && typeof value.uuid !== "string") {
    return true
  }

  if (hasOwnKey(value, "name") && typeof value.name !== "string") {
    return true
  }

  if (hasOwnKey(value, "localPath") && typeof value.localPath !== "string") {
    return true
  }

  if (hasOwnKey(value, "rulesDir") && typeof value.rulesDir !== "string") {
    return true
  }

  if (hasOwnKey(value, "skillsDir") && typeof value.skillsDir !== "string") {
    return true
  }

  if (hasOwnKey(value, "contentDirs") && hasContentDirsFormatError(value.contentDirs)) {
    return true
  }

  return false
}

function hasGlobalConfigFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  if (hasOwnKey(value, "themeMode") && typeof value.themeMode !== "string") {
    return true
  }

  if (!hasOwnKey(value, "projects")) {
    return false
  }

  if (!Array.isArray(value.projects)) {
    return true
  }

  return value.projects.some(hasProjectConfigFormatError)
}

export function hasRecoverableSynapseConfigFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  if (
    hasOwnKey(value, "activeRepoUuid")
    && value.activeRepoUuid !== null
    && typeof value.activeRepoUuid !== "string"
  ) {
    return true
  }

  if (hasOwnKey(value, "repositories")) {
    if (!Array.isArray(value.repositories)) {
      return true
    }

    if (value.repositories.some(hasRepositoryConfigFormatError)) {
      return true
    }
  }

  if (hasOwnKey(value, "global") && hasGlobalConfigFormatError(value.global)) {
    return true
  }

  return false
}

function normalizeProjectConfig(value: unknown): SynapseProjectConfig | null {
  if (!isRecord(value)) {
    return null
  }

  const id = asTrimmedString(value.id)
  const name = asTrimmedString(value.name)
  const projectPath = asTrimmedString(value.path)

  if (!id || !name || !projectPath) {
    return null
  }

  return {
    id,
    name,
    path: projectPath,
  }
}

function normalizeRepositoryConfig(value: unknown): SynapseRepositoryConfig | null {
  if (!isRecord(value)) {
    return null
  }

  const uuid = asTrimmedString(value.uuid)
  const localPath = asTrimmedString(value.localPath)
  const name = asTrimmedString(value.name, getPathDisplayName(localPath))

  if (!uuid || !name || !localPath) {
    return null
  }

  return {
    uuid,
    name,
    localPath,
    contentDirs: resolveContentDirs(value),
  }
}

function resolveContentDirs(
  value: Record<string, unknown>,
): Record<SynapseContentType, string> {
  const directories = CONTENT_TYPE_DEFINITIONS.map((definition) => {
    const contentDirs = isRecord(value.contentDirs) ? value.contentDirs : null
    const fromMap = contentDirs?.[definition.id]

    if (typeof fromMap === "string" && fromMap.trim().length > 0) {
      return [definition.id, fromMap.trim()] as const
    }

    if (definition.repositoryDir.legacyConfigKey) {
      const legacyValue = value[definition.repositoryDir.legacyConfigKey]

      if (typeof legacyValue === "string" && legacyValue.trim().length > 0) {
        return [definition.id, legacyValue.trim()] as const
      }
    }

    return [definition.id, DEFAULT_REPOSITORY_CONTENT_DIRECTORIES[definition.id]] as const
  })

  return Object.fromEntries(directories) as Record<SynapseContentType, string>
}

function normalizeProjects(value: unknown): SynapseProjectConfig[] {
  if (!Array.isArray(value)) {
    return structuredClone(DEFAULT_GLOBAL_CONFIG.projects)
  }

  return dedupeByKey(
    value.map(normalizeProjectConfig).filter(isDefined),
    (project) => project.id,
  )
}

function normalizeRepositories(value: unknown): SynapseRepositoryConfig[] {
  if (!Array.isArray(value)) {
    return structuredClone(DEFAULT_CONFIG.repositories)
  }

  return dedupeByKey(
    value.map(normalizeRepositoryConfig).filter(isDefined),
    (repository) => repository.uuid,
  )
}

function normalizeGlobalConfig(value: unknown): SynapseGlobalConfig {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_GLOBAL_CONFIG)
  }

  return {
    themeMode: normalizeThemeMode(value.themeMode, DEFAULT_THEME_MODE),
    projects: normalizeProjects(value.projects),
  }
}

export function createDefaultConfig(): SynapseConfig {
  return structuredClone(DEFAULT_CONFIG)
}

export function sanitizeSynapseConfig(value: unknown): SynapseConfig {
  const fallbackConfig = createDefaultConfig()

  if (!isRecord(value)) {
    return fallbackConfig
  }

  const repositories = normalizeRepositories(value.repositories)
  const requestedActiveRepoUuid =
    value.activeRepoUuid === null
      ? null
      : isNonEmptyString(value.activeRepoUuid)
        ? value.activeRepoUuid.trim()
        : fallbackConfig.activeRepoUuid
  const activeRepoUuid =
    requestedActiveRepoUuid !== null
    && repositories.some((repository) => repository.uuid === requestedActiveRepoUuid)
      ? requestedActiveRepoUuid
      : null

  return {
    activeRepoUuid,
    repositories,
    global: normalizeGlobalConfig(value.global),
  }
}

export function getActiveRepositoryConfig(config: SynapseConfig): SynapseRepositoryConfig | null {
  if (config.activeRepoUuid === null) {
    return null
  }

  return config.repositories.find((repository) => repository.uuid === config.activeRepoUuid) ?? null
}

export function getContentDir(
  repository: SynapseRepositoryConfig,
  contentType: SynapseContentType,
): string {
  const legacyConfigKey = getContentTypeDefinition(contentType).repositoryDir.legacyConfigKey

  return repository.contentDirs?.[contentType]
    ?? (legacyConfigKey ? repository[legacyConfigKey] : undefined)
    ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES[contentType]
}

export function applySynapseConfigPatch(
  config: SynapseConfig,
  patch: SynapseConfigPatch,
): SynapseConfig {
  const nextGlobal = patch.global
    ? {
        ...config.global,
        ...patch.global,
        projects: patch.global.projects ?? config.global.projects,
      }
    : config.global

  return sanitizeSynapseConfig({
    ...config,
    activeRepoUuid:
      patch.activeRepoUuid !== undefined ? patch.activeRepoUuid : config.activeRepoUuid,
    repositories: patch.repositories ?? config.repositories,
    global: nextGlobal,
  })
}
