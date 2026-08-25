import type {
  SynapseAgentGlobalConfig,
  SynapseConfig,
  SynapseContentSortOrder,
  SynapseFavorites,
  SynapseGlobalConfig,
  SynapseKnowledgeBaseStorageConfig,
  SynapseQuickInput,
  SynapseRecentlyViewed,
  SynapseThemeMode,
} from "../types/config"
import type { SynapseContentType } from "../types/content"
import { CONTENT_TYPE_DEFINITIONS } from "../config/content-types"
import { SYNAPSE_APP_VERSION } from "../lib/app-version"
import { DEFAULT_DOCK_APP_IDS } from "../modules/apps/dock"

export const DEFAULT_REPOSITORY_CONTENT_DIRECTORIES: Record<SynapseContentType, string> =
  Object.fromEntries(
    CONTENT_TYPE_DEFINITIONS.map((definition) => [
      definition.id,
      definition.repositoryDir.defaultDirectoryName,
    ]),
  ) as Record<SynapseContentType, string>

export const DEFAULT_WINDOW_BOUNDS = {
  width: 1000,
  height: 800,
  minWidth: 880,
  minHeight: 600,
}

export const DEFAULT_THEME_MODE: SynapseThemeMode = "light"

export const DEFAULT_QUICK_INPUTS = [
  {
    id: "builtin-quick-input-sort",
    content: "帮我捋一下\n把这里的信息重新整理一下，重点放在结论、分歧和下一步。",
    directSend: true,
  },
  {
    id: "builtin-quick-input-conclusion",
    content: "给个结论\n先说结论，再用几条要点说明理由。",
    directSend: true,
  },
  {
    id: "builtin-quick-input-problems",
    content: "哪里有问题\n帮我挑一下毛病，重点看不清楚、不完整、前后打架的地方。",
    directSend: true,
  },
  {
    id: "builtin-quick-input-formal-doc",
    content: "改得像正式文档\n保持原意，把表达改得更清楚、更克制、更适合放进文档。",
    directSend: true,
  },
  {
    id: "builtin-quick-input-todos",
    content: "整理成待办\n拆成可执行的待办事项，按优先级排一下。",
    directSend: true,
  },
  {
    id: "builtin-quick-input-desktop-md",
    content: "存到桌面\n整理成一份 Markdown 文件，保存到我的桌面。",
    directSend: true,
  },
] as const satisfies SynapseQuickInput[]

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

export const DEFAULT_KNOWLEDGE_BASE_STORAGE = {
  mode: "default",
} as const satisfies SynapseKnowledgeBaseStorageConfig

export const DEFAULT_GLOBAL_CONFIG: SynapseGlobalConfig = {
  themeMode: DEFAULT_THEME_MODE,
  projects: [],
  quickInputs: DEFAULT_QUICK_INPUTS,
  defaultQuickInputsSeededVersion: SYNAPSE_APP_VERSION,
  favorites: DEFAULT_FAVORITES,
  recentlyViewed: DEFAULT_RECENTLY_VIEWED,
  contentSortOrder: DEFAULT_CONTENT_SORT_ORDER,
  variables: [],
  knowledgeBaseStorage: DEFAULT_KNOWLEDGE_BASE_STORAGE,
  dockAppIds: [...DEFAULT_DOCK_APP_IDS],
}

export const DEFAULT_AGENT_GLOBAL_CONFIG: SynapseAgentGlobalConfig = {
  defaultPermissionMode: "default",
  defaultProviderModel: null,
  experimentalSynapseToolRouterEnabled: false,
  recentSlashSkills: [],
}

export const DEFAULT_CONFIG: SynapseConfig = {
  activeRepoUuid: null,
  repositories: [],
  global: DEFAULT_GLOBAL_CONFIG,
  agent: DEFAULT_AGENT_GLOBAL_CONFIG,
}
