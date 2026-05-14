import type { SynapseContentType } from "./content"
import type { SynapseAgentPermissionMode } from "./agent"

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

export type SynapseAgentGlobalConfig = {
  defaultPermissionMode: SynapseAgentPermissionMode
}

export type SynapseConfig = {
  activeRepoUuid: string | null
  repositories: SynapseRepositoryConfig[]
  global: SynapseGlobalConfig
  agent: SynapseAgentGlobalConfig
}

export type SynapseConfigPatch = {
  activeRepoUuid?: SynapseConfig["activeRepoUuid"]
  repositories?: SynapseRepositoryConfig[]
  global?: Partial<SynapseGlobalConfig> & {
    projects?: SynapseProjectConfig[]
  }
  agent?: Partial<SynapseAgentGlobalConfig>
}
