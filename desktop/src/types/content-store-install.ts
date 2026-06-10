export type SynapseContentStoreInstallWindowRequest = {
  session: string
}

export type SynapseContentStoreInstallSession = {
  readonly id: string
  readonly contentId: string
  readonly versionId: string
  readonly type: "skill" | "rule"
  readonly title: string
  readonly packageSha256: string
  readonly packageSize?: string
  readonly expiresAt: string
}

export type SynapseContentStoreInstallResolveResult =
  | { readonly status: "unauthenticated" }
  | {
      readonly status: "ready"
      readonly session: SynapseContentStoreInstallSession
    }

export type SynapseContentStorePreparedFile = {
  readonly path: string
  readonly size: number
  readonly kind: "text" | "binary"
}

export type SynapseContentStorePreparedSource = {
  readonly id: string
  readonly contentId: string
  readonly versionId: string
  readonly type: "skill" | "rule"
  readonly title: string
  readonly mainFile: "content/SKILL.md" | "content/RULE.md"
  readonly mainContent: string
  readonly files: SynapseContentStorePreparedFile[]
}

export type SynapseContentStoreInstallPrepareResult =
  | { readonly status: "unauthenticated" }
  | {
      readonly status: "prepared"
      readonly source: SynapseContentStorePreparedSource
    }
