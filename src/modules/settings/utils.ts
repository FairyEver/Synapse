import type {
  SynapseConfigPatch,
  SynapseProjectConfig,
  SynapseRepositoryConfig,
  SynapseThemeMode,
} from "@/types/config"
import type { SynapseContentType } from "@/types/content"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "@/constants/defaults"
import type { SettingItem, SettingsContext } from "@/modules/settings/types"

function updateActiveRepository(
  context: SettingsContext,
  update: (repository: SynapseRepositoryConfig) => SynapseRepositoryConfig,
): SynapseRepositoryConfig[] | null {
  if (context.activeRepository === null) {
    return null
  }

  return context.config.repositories.map((repository) =>
    repository.uuid === context.activeRepository?.uuid ? update(repository) : repository,
  )
}

function getGlobalSettingValue(key: string, context: SettingsContext, fallback: unknown): unknown {
  switch (key) {
    case "themeMode":
      return context.config.global.themeMode
    case "projects":
      return context.config.global.projects
    default:
      return fallback
  }
}

function getRepositorySettingValue(key: string, context: SettingsContext, fallback: unknown): unknown {
  if (context.activeRepository === null) {
    return fallback
  }

  if (key.startsWith("contentDirs.")) {
    const contentType = key.slice("contentDirs.".length) as SynapseContentType

    return context.activeRepository.contentDirs[contentType]
      ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES[contentType]
      ?? fallback
  }

  return fallback
}

function createGlobalSettingPatch(key: string, value: unknown): SynapseConfigPatch | null {
  switch (key) {
    case "themeMode":
      return { global: { themeMode: String(value ?? "") as SynapseThemeMode } }
    case "projects":
      return { global: { projects: value as SynapseProjectConfig[] } }
    default:
      return null
  }
}

function createRepositorySettingPatch(key: string, value: unknown, context: SettingsContext): SynapseConfigPatch | null {
  if (key.startsWith("contentDirs.")) {
    const contentType = key.slice("contentDirs.".length) as SynapseContentType
    const repositories = updateActiveRepository(context, (repository) => ({
      ...repository,
      contentDirs: {
        ...repository.contentDirs,
        [contentType]: String(value ?? ""),
      },
    }))

    return repositories ? { repositories } : null
  }

  return null
}

function getSettingValue(item: SettingItem, context: SettingsContext): unknown {
  if (item.getValue) {
    return item.getValue(context)
  }

  if (item.key === "repositories") {
    return context.config.repositories
  }

  if (item.key.startsWith("global.")) {
    return getGlobalSettingValue(item.key.slice("global.".length), context, item.defaultValue)
  }

  if (item.key.startsWith("activeRepository.")) {
    return getRepositorySettingValue(
      item.key.slice("activeRepository.".length),
      context,
      item.defaultValue,
    )
  }

  return item.defaultValue
}

function createSettingPatch(item: SettingItem, value: unknown, context: SettingsContext): SynapseConfigPatch | null {
  if (item.readOnly) {
    return null
  }

  if (item.createPatch) {
    return item.createPatch(value, context)
  }

  if (item.key === "repositories") {
    return { repositories: value as SynapseRepositoryConfig[] }
  }

  if (item.key.startsWith("global.")) {
    return createGlobalSettingPatch(item.key.slice("global.".length), value)
  }

  if (item.key.startsWith("activeRepository.")) {
    return createRepositorySettingPatch(
      item.key.slice("activeRepository.".length),
      value,
      context,
    )
  }

  return null
}

export { createSettingPatch, getSettingValue }
