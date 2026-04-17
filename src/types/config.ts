export const SYNAPSE_LANGUAGE_OPTIONS = ["zh-CN", "en-US"] as const

export type SynapseLanguage = (typeof SYNAPSE_LANGUAGE_OPTIONS)[number]

export type SynapseProjectConfig = {
  id: string
  name: string
  path: string
}

export type SynapseRepositoryConfig = {
  uuid: string
  name: string
  localPath: string
  rulesDir: string
  skillsDir: string
}

export type SynapseGlobalConfig = {
  displayName: string
  language: SynapseLanguage
  projects: SynapseProjectConfig[]
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
