import type { SynapseContentType } from "./content"

export const SYNAPSE_CONTENT_SORT_OPTIONS = [
  "modified-desc",
  "created-desc",
  "name-asc",
  "name-desc",
] as const

export type SynapseContentSortOrder = (typeof SYNAPSE_CONTENT_SORT_OPTIONS)[number]

export const SYNAPSE_THEME_MODE_OPTIONS = ["light", "dark", "system"] as const

export type SynapseThemeMode = (typeof SYNAPSE_THEME_MODE_OPTIONS)[number]

export const SYNAPSE_LOCALE_OPTIONS = ["auto", "en", "zh", "zh-TW", "ja", "es"] as const

export type SynapseLocale = (typeof SYNAPSE_LOCALE_OPTIONS)[number]

export type SynapseProjectMode = "single" | "multi-workspace"

export type SynapseProjectPlatformConnection = {
  id: string
  type: string
  name: string
  status: "draft" | "configured" | "disabled" | "invalid"
  enabled: boolean
  options?: Record<string, string | boolean | number>
  secretRefs?: Record<string, string>
  allowFrom?: string
  shareSessionInChannel?: boolean
  groupReplyAll?: boolean
  createdAt: string
  updatedAt: string
}

export type SynapseProjectHeartbeatConfig = {
  enabled: boolean
  paused?: boolean
  intervalMins?: number
  sessionKey?: string
  lastRunAt?: string
  lastError?: string
}

export type SynapseWorkspaceBinding = {
  id: string
  projectId: string | null
  channelKey: string
  channelName: string
  workspacePath: string
  boundAt: string
}

export type SynapseProjectConfig = {
  id: string
  name: string
  path: string
  agentType?: string
  permissionMode?: string
  language?: string
  adminFrom?: string
  disabledCommands?: string[]
  showContextIndicator?: boolean
  replyFooter?: boolean
  injectSender?: boolean
  providerRefs?: string[]
  heartbeat?: SynapseProjectHeartbeatConfig
  mode?: SynapseProjectMode
  workDir?: string
  workDirOverride?: string
  baseDir?: string
  source?: "synapse" | "cc-connect"
  platformConnections?: SynapseProjectPlatformConnection[]
  workspaceDirOverrides?: Record<string, string>
}

export type SynapseFavorites = {
  rule: string[]
  skill: string[]
  prompt: string[]
}

export type SynapseRecentlyViewed = {
  rule: string[]
  skill: string[]
  prompt: string[]
}

export type SynapseVariable = {
  name: string
  value: string
  description?: string
}

export type SynapseRepositoryConfig = {
  uuid: string
  name: string
  localPath: string
  contentDirs: Partial<Record<SynapseContentType, string>>
  rulesDir?: string
  skillsDir?: string
  variables?: SynapseVariable[]
}

export type SynapseGlobalConfig = {
  themeMode: SynapseThemeMode
  locale: SynapseLocale
  projects: SynapseProjectConfig[]
  defaultProjectId: string | null
  workspaceBindings: SynapseWorkspaceBinding[]
  favorites: SynapseFavorites
  recentlyViewed: SynapseRecentlyViewed
  contentSortOrder: SynapseContentSortOrder
}

export type SynapseConfig = {
  activeRepoUuid: string | null
  repositories: SynapseRepositoryConfig[]
  global: SynapseGlobalConfig
}

export type SynapseConfigPatch = {
  activeRepoUuid?: SynapseConfig["activeRepoUuid"]
  repositories?: SynapseRepositoryConfig[]
  global?: Partial<SynapseGlobalConfig> & {
    projects?: SynapseProjectConfig[]
  }
}

export type SynapseLegacyCcProviderPreview = {
  name: string
  source: "global" | "project"
  projectName: string | null
  baseUrl: string | null
  model: string | null
  agentTypes: string[]
  hasApiKey: boolean
}

export type SynapseLegacyCcProjectPreview = {
  name: string
  mode: string | null
  workDir: string | null
  baseDir: string | null
  agentType: string | null
  providerRefs: string[]
  activeProvider: string | null
  platformTypes: string[]
  runAsUser: string | null
  runAsEnv: string[]
  issues: string[]
}

export type SynapseLegacyCcConfigImportPreview = {
  valid: boolean
  errors: string[]
  warnings: string[]
  ignoredTopLevelKeys: string[]
  global: {
    dataDir: string
    language: string | null
    attachmentSend: "on" | "off"
    logLevel: string
  }
  projects: SynapseLegacyCcProjectPreview[]
  providers: SynapseLegacyCcProviderPreview[]
}
