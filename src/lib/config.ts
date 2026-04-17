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

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function normalizeProjectConfig(value: unknown): SynapseProjectConfig {
  if (!isRecord(value)) {
    return {
      id: "",
      name: "",
      path: "",
    }
  }

  return {
    id: asString(value.id),
    name: asString(value.name),
    path: asString(value.path),
  }
}

function normalizeRepositoryConfig(value: unknown): SynapseRepositoryConfig {
  if (!isRecord(value)) {
    return {
      uuid: "",
      name: "",
      url: "",
      credentialContext: null,
      ...DEFAULT_REPOSITORY_CONTENT_DIRECTORIES,
    }
  }

  return {
    uuid: asString(value.uuid),
    name: asString(value.name),
    url: asString(value.url),
    credentialContext: asNullableString(value.credentialContext),
    rulesDir: asString(value.rulesDir, DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.rulesDir),
    skillsDir: asString(value.skillsDir, DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.skillsDir),
  }
}

function normalizeGlobalConfig(value: unknown): SynapseGlobalConfig {
  if (!isRecord(value)) {
    return structuredClone(DEFAULT_GLOBAL_CONFIG)
  }

  return {
    displayName: asString(value.displayName, DEFAULT_GLOBAL_CONFIG.displayName),
    projects: Array.isArray(value.projects)
      ? value.projects.map(normalizeProjectConfig)
      : structuredClone(DEFAULT_GLOBAL_CONFIG.projects),
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

  const activeRepoUuid =
    value.activeRepoUuid === null
      ? null
      : typeof value.activeRepoUuid === "string" && value.activeRepoUuid.length > 0
        ? value.activeRepoUuid
        : fallbackConfig.activeRepoUuid

  return {
    activeRepoUuid,
    repositories: Array.isArray(value.repositories)
      ? value.repositories.map(normalizeRepositoryConfig)
      : fallbackConfig.repositories,
    global: normalizeGlobalConfig(value.global),
  }
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
