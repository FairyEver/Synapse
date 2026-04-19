import type {
  SynapseConfig,
  SynapseFavorites,
  SynapseGlobalConfig,
  SynapseThemeMode,
} from "../types/config"
import type { SynapseContentType } from "../types/content"
import { CONTENT_TYPE_DEFINITIONS } from "../config/content-types"

export const DEFAULT_REPOSITORY_CONTENT_DIRECTORIES: Record<SynapseContentType, string> =
  Object.fromEntries(
    CONTENT_TYPE_DEFINITIONS.map((definition) => [
      definition.id,
      definition.repositoryDir.defaultDirectoryName,
    ]),
  ) as Record<SynapseContentType, string>

export const DEFAULT_WINDOW_BOUNDS = {
  width: 1000,
  height: 600,
  minWidth: 1000,
  minHeight: 600,
}

export const DEFAULT_THEME_MODE: SynapseThemeMode = "light"

export const DEFAULT_FAVORITES = {
  rule: [],
  skill: [],
} as const satisfies SynapseFavorites

export const DEFAULT_GLOBAL_CONFIG: SynapseGlobalConfig = {
  themeMode: DEFAULT_THEME_MODE,
  projects: [],
  favorites: DEFAULT_FAVORITES,
}

export const DEFAULT_CONFIG: SynapseConfig = {
  activeRepoUuid: null,
  repositories: [],
  global: DEFAULT_GLOBAL_CONFIG,
}
