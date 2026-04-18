import type {
  SynapseConfig,
  SynapseGlobalConfig,
  SynapseLanguage,
  SynapseRepositoryConfig,
} from "../types/config"

export const DEFAULT_RULES_DIRECTORY_NAME = "rules"
export const DEFAULT_SKILLS_DIRECTORY_NAME = "skills"

export const DEFAULT_REPOSITORY_CONTENT_DIRECTORIES: Pick<
  SynapseRepositoryConfig,
  "rulesDir" | "skillsDir"
> = {
  rulesDir: DEFAULT_RULES_DIRECTORY_NAME,
  skillsDir: DEFAULT_SKILLS_DIRECTORY_NAME,
}

export const DEFAULT_WINDOW_BOUNDS = {
  width: 1000,
  height: 600,
  minWidth: 1000,
  minHeight: 600,
}

export const DEFAULT_INTERFACE_LANGUAGE: SynapseLanguage = "zh-CN"

export const DEFAULT_GLOBAL_CONFIG: SynapseGlobalConfig = {
  language: DEFAULT_INTERFACE_LANGUAGE,
  projects: [],
}

export const DEFAULT_CONFIG: SynapseConfig = {
  activeRepoUuid: null,
  repositories: [],
  global: DEFAULT_GLOBAL_CONFIG,
}
