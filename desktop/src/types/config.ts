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

export type SynapseProjectConfig = {
  id: string
  name: string
  path: string
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
  projects: SynapseProjectConfig[]
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
