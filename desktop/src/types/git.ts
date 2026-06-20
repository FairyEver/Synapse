export type SynapseGitRemoteKind = "https" | "ssh" | "unknown"

export type SynapseGitProtocol = "https" | "ssh" | "file" | "unknown"
export type SynapseGitProvider = "github" | "gitee" | "gitlab" | "generic"
export type SynapseGitProviderLinks = {
  readonly credentialHelpUrl: string | null
  readonly sshKeysUrl: string | null
  readonly tokenUrl: string | null
}
export type SynapseGitRemoteDescriptor = {
  readonly host: string | null
  readonly normalizedUrl: string
  readonly protocol: SynapseGitProtocol
  readonly provider: SynapseGitProvider
  readonly remoteKind: SynapseGitRemoteKind
}
export type SynapseGitFailureCategory =
  | "git-missing"
  | "missing-identity"
  | "https-auth"
  | "github-auth"
  | "ssh-auth"
  | "credential-helper-missing"
  | "repository-not-found"
  | "network"
  | "path"
  | "dirty"
  | "conflict"
  | "non-fast-forward"
  | "timeout"
  | "not-git-repository"
  | "unknown"
export type SynapseGitFailurePrimaryAction =
  | "install-git"
  | "set-identity"
  | "login-host"
  | "handle-github-auth"
  | "handle-ssh"
  | "configure-credential-helper"
  | "retry"
  | "choose-directory"
  | "open-workbench"
  | "copy-diagnostics"
  | null
export type SynapseGitUserFacingFailure = {
  readonly category: SynapseGitFailureCategory
  readonly detail: string | null
  readonly host: string | null
  readonly message: string
  readonly primaryAction: SynapseGitFailurePrimaryAction
  readonly protocol: SynapseGitProtocol
  readonly title: string
}
export type SynapseGitCredentialHelperState = {
  readonly helper: string | null
  readonly safe: boolean
  readonly source: string | null
}
export type SynapseGitAccessHostState = {
  readonly host: string
  readonly lastFailure: SynapseGitUserFacingFailure | null
  readonly protocol: SynapseGitProtocol
  readonly provider: SynapseGitProvider
}
export type SynapseGitAccessState = {
  readonly checkedAt: string
  readonly credentialHelper: SynapseGitCredentialHelperState
  readonly hosts: readonly SynapseGitAccessHostState[]
  readonly providerLinks: Readonly<Record<SynapseGitProvider, SynapseGitProviderLinks>>
  readonly ssh: {
    readonly available: boolean
    readonly publicKeyComment: string | null
    readonly publicKeyFingerprint: string | null
    readonly publicKeyPath: string | null
    readonly publicKeyType: string | null
  }
}
export type SynapseGitSaveHttpsCredentialInput = {
  readonly host: string
  readonly password: string
  readonly protocol: "https"
  readonly username: string
}
export type SynapseGitClearHttpsCredentialInput = {
  readonly host: string
  readonly protocol: "https"
  readonly username?: string | null
}
export type SynapseGitGenerateSshKeyInput = {
  readonly email: string
}
export type SynapseGitTestSshConnectionInput = {
  readonly host: string
  readonly provider?: SynapseGitProvider
}
export type SynapseGitSshTestResult = {
  readonly detail: string | null
  readonly host: string
  readonly ok: boolean
  readonly title: string
}

export type SynapseGitRepositoryRemoveMode = "keep-local" | "trash-local"

export type SynapseGitRepositoryRemoveInput = {
  readonly repositoryId: string
  readonly mode: SynapseGitRepositoryRemoveMode
}

export type SynapseGitRepository = {
  readonly id: string
  readonly name: string
  readonly localPath: string
  readonly addedAt: string
  readonly lastOpenedAt: string | null
}

export type SynapseGitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted"
  | "unknown"

export type SynapseGitFileChange = {
  readonly path: string
  readonly originalPath: string | null
  readonly status: SynapseGitFileStatus
  readonly staged: boolean
  readonly conflicted: boolean
}

export type SynapseGitRepositorySnapshot = {
  readonly repositoryId: string
  readonly pathExists: boolean
  readonly isGitRepository: boolean
  readonly currentBranch: string | null
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly hasConflicts: boolean
  readonly changes: readonly SynapseGitFileChange[]
}

export type SynapseGitRepositorySummary = {
  readonly repository: SynapseGitRepository
  readonly snapshot: SynapseGitRepositorySnapshot | null
  readonly error: string | null
}

export type SynapseGitStatusParseResult = Omit<
  SynapseGitRepositorySnapshot,
  "repositoryId" | "pathExists" | "isGitRepository"
>

export type SynapseGitDiffResult = {
  readonly path: string
  readonly originalPath: string | null
  readonly binary: boolean
  readonly text: string
}

export type SynapseGitBranch = {
  readonly name: string
  readonly current: boolean
}

export type SynapseGitCommitSummary = {
  readonly hash: string
  readonly shortHash: string
  readonly subject: string
  readonly authorName: string
  readonly authorEmail: string
  readonly committedAt: string
}

export type SynapseGitCommitDetail = SynapseGitCommitSummary & {
  readonly files: readonly SynapseGitFileChange[]
  readonly diff: string
}

export type SynapseGitEnvironmentState = {
  readonly checkedAt: string
  readonly platform: string
  readonly homeDir: string
  readonly gitAvailable: boolean
  readonly gitVersion: string | null
  readonly gitPath: string | null
  readonly processPath: string
  readonly shellPath: string | null
  readonly effectivePath: string
  readonly processGitPath: string | null
  readonly shellGitPath: string | null
  readonly effectiveGitPath: string | null
  readonly sshAvailable: boolean
  readonly userName: string | null
  readonly userEmail: string | null
  readonly userNameSource: string | null
  readonly userEmailSource: string | null
  readonly commonSshKeyExists: boolean
  readonly sshPublicKeyPath: string | null
  readonly sshPublicKeyType: string | null
  readonly sshPublicKeyComment: string | null
  readonly sshPublicKeyFingerprint: string | null
  readonly installHint: string | null
}

export type SynapseGitSshPublicKey = {
  readonly path: string
  readonly content: string
}

export type SynapseGitOperationResult = {
  readonly completedAt: string
  readonly message: string
}

export type SynapseGitErrorCategory =
  | "git-missing"
  | "auth-failed"
  | "network-failed"
  | "path-missing"
  | "not-git-repository"
  | "working-tree-dirty"
  | "non-fast-forward"
  | "conflict"
  | "unknown"
