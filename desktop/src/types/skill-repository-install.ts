export type SynapseSkillRepositoryInstallWindowRequest = {
  session: string
}

export type SynapseSkillRepositoryInstallSession = {
  readonly id: string
  readonly repository: {
    readonly id: string
    readonly name: string
    readonly title: string
    readonly owner: {
      readonly id: string
      readonly handle: string
    }
  }
  readonly packageSha256: string
  readonly packageSize: number
  readonly expiresAt: string
}

export type SynapseSkillRepositoryInstallResolveResult =
  | { readonly status: "unauthenticated" }
  | {
      readonly status: "ready"
      readonly session: SynapseSkillRepositoryInstallSession
    }

export type SynapseSkillRepositoryPreparedFile = {
  readonly path: string
  readonly size: number
  readonly kind: "text" | "binary"
}

export type SynapseSkillRepositoryPreparedSource = {
  readonly id: string
  readonly repositoryId: string
  readonly repositoryName: string
  readonly ownerHandle: string
  readonly title: string
  readonly mainFile: "content/SKILL.md"
  readonly mainContent: string
  readonly files: SynapseSkillRepositoryPreparedFile[]
}

export type SynapseSkillRepositoryInstallPrepareResult =
  | { readonly status: "unauthenticated" }
  | {
      readonly status: "prepared"
      readonly source: SynapseSkillRepositoryPreparedSource
    }
