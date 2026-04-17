import { DEFAULT_CONFIG, DEFAULT_GLOBAL_CONFIG, DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "../constants/defaults"
import type {
  SynapseConfig,
  SynapseConfigPatch,
  SynapseGlobalConfig,
  SynapseProjectConfig,
  SynapseRepositoryConfig,
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

function asTrimmedString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback
}

function asNullableTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmedValue = value.trim()

  return trimmedValue.length > 0 ? trimmedValue : null
}

function normalizeDirectoryName(value: unknown, fallback: string): string {
  const nextValue = asTrimmedString(value, fallback)

  return nextValue.length > 0 ? nextValue : fallback
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

  if (hasOwnKey(value, "url") && typeof value.url !== "string") {
    return true
  }

  if (
    hasOwnKey(value, "credentialContext")
    && value.credentialContext !== null
    && typeof value.credentialContext !== "string"
  ) {
    return true
  }

  if (hasOwnKey(value, "rulesDir") && typeof value.rulesDir !== "string") {
    return true
  }

  if (hasOwnKey(value, "skillsDir") && typeof value.skillsDir !== "string") {
    return true
  }

  return false
}

function hasGlobalConfigFormatError(value: unknown): boolean {
  if (!isRecord(value)) {
    return true
  }

  if (hasOwnKey(value, "displayName") && typeof value.displayName !== "string") {
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
  const name = asTrimmedString(value.name)
  const url = asTrimmedString(value.url)

  if (!uuid || !name || !url) {
    return null
  }

  return {
    uuid,
    name,
    url,
    credentialContext: asNullableTrimmedString(value.credentialContext),
    rulesDir: normalizeDirectoryName(value.rulesDir, DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.rulesDir),
    skillsDir: normalizeDirectoryName(value.skillsDir, DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.skillsDir),
  }
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
    displayName: asTrimmedString(value.displayName, DEFAULT_GLOBAL_CONFIG.displayName),
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
