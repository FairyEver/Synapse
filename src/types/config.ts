export type SynapseProjectConfig = {
  id: string
  name: string
  path: string
}

export type SynapseRepositoryConfig = {
  uuid: string
  name: string
  url: string
  credentialContext: string | null
  rulesDir: string
  skillsDir: string
}

export type SynapseGlobalConfig = {
  displayName: string
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
