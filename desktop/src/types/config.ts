import type { SynapseContentType } from "./content"
import type { SynapseAgentPermissionMode } from "./agent"
import type { ModelTier } from "./provider-model"
import type { SynapseSystemAppId } from "../modules/apps/types"

export const SYNAPSE_CONTENT_SORT_OPTIONS = [
  "modified-desc",
  "created-desc",
  "name-asc",
  "name-desc",
] as const

export type SynapseContentSortOrder = (typeof SYNAPSE_CONTENT_SORT_OPTIONS)[number]

export const SYNAPSE_THEME_MODE_OPTIONS = ["light", "dark", "system"] as const

export type SynapseThemeMode = (typeof SYNAPSE_THEME_MODE_OPTIONS)[number]

export type SynapseKnowledgeBaseProjectCapability = {
  enabled: true
  schemaVersion: 1
  templateVersion: string
  managed?: true
  runtimeId?: string
}

export type SynapseProjectCapabilities = {
  knowledgeBase?: SynapseKnowledgeBaseProjectCapability
}

export type SynapseProjectConfig = {
  id: string
  name: string
  path: string
  capabilities?: SynapseProjectCapabilities
}

export type SynapseQuickInput = {
  id: string
  content: string
  directSend: boolean
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
}

export type SynapseKnowledgeBaseStorageConfig =
  | { mode: "default" }
  | { mode: "custom"; rootPath: string }

export type SynapseGlobalConfig = {
  themeMode: SynapseThemeMode
  projects: SynapseProjectConfig[]
  quickInputs: SynapseQuickInput[]
  defaultQuickInputsSeededVersion: string | null
  favorites: SynapseFavorites
  recentlyViewed: SynapseRecentlyViewed
  contentSortOrder: SynapseContentSortOrder
  variables: SynapseVariable[]
  knowledgeBaseStorage: SynapseKnowledgeBaseStorageConfig
  dockAppIds: SynapseSystemAppId[]
}

export type SynapseAgentGlobalConfig = {
  defaultPermissionMode: SynapseAgentPermissionMode
  defaultProviderModel: { providerId: string; modelTier: ModelTier } | null
  experimentalSynapseToolRouterEnabled: boolean
  recentSlashSkills: string[]
  allowedWriteDirectories: string[]
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
    quickInputs?: SynapseQuickInput[]
  }
  agent?: Partial<SynapseAgentGlobalConfig>
}
