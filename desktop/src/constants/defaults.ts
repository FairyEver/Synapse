import type {
  SynapseCcConnectSettings,
  SynapseConfig,
  SynapseContentSortOrder,
  SynapseFavorites,
  SynapseGlobalConfig,
  SynapseRecentlyViewed,
  SynapseLocale,
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
  height: 700,
  minWidth: 1000,
  minHeight: 600,
}

export const DEFAULT_THEME_MODE: SynapseThemeMode = "light"

export const DEFAULT_LOCALE: SynapseLocale = "auto"

export const DEFAULT_FAVORITES = {
  rule: [],
  skill: [],
  prompt: [],
} as const satisfies SynapseFavorites

export const DEFAULT_RECENTLY_VIEWED = {
  rule: [],
  skill: [],
  prompt: [],
} as const satisfies SynapseRecentlyViewed

export const DEFAULT_CONTENT_SORT_ORDER: SynapseContentSortOrder = "modified-desc"

export const DEFAULT_CC_CONNECT_SETTINGS: SynapseCcConnectSettings = {
  language: "en",
  attachmentSend: "",
  logLevel: "info",
  idleTimeoutMins: 120,
  thinkingMessages: true,
  thinkingMaxLen: 300,
  toolMessages: true,
  toolMaxLen: 500,
  streamPreviewEnabled: true,
  streamPreviewIntervalMs: 1500,
  rateLimitMaxMessages: 20,
  rateLimitWindowSecs: 60,
  lastReloadAt: null,
  lastRestartRequestedAt: null,
}

export const DEFAULT_GLOBAL_CONFIG: SynapseGlobalConfig = {
  themeMode: DEFAULT_THEME_MODE,
  locale: DEFAULT_LOCALE,
  projects: [],
  providers: [],
  ccConnect: DEFAULT_CC_CONNECT_SETTINGS,
  defaultProjectId: null,
  workspaceBindings: [],
  favorites: DEFAULT_FAVORITES,
  recentlyViewed: DEFAULT_RECENTLY_VIEWED,
  contentSortOrder: DEFAULT_CONTENT_SORT_ORDER,
}

export const DEFAULT_CONFIG: SynapseConfig = {
  activeRepoUuid: null,
  repositories: [],
  global: DEFAULT_GLOBAL_CONFIG,
}
