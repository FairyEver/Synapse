export type SynapseGitRemoteKind = "http" | "https" | "ssh" | "unknown"

export type SynapseGitProtocol = "http" | "https" | "ssh" | "file" | "unknown"
export type SynapseGitProvider = "github" | "gitee" | "gitlab" | "generic"
export type SynapseGitProviderLinks = {
  readonly credentialHelpUrl: string | null
  readonly sshKeysUrl: string | null
  readonly tokenUrl: string | null
}
export type SynapseGitRemoteDescriptor = {
  readonly host: string | null
  readonly normalizedUrl: string
  readonly port: number | null
  readonly protocol: SynapseGitProtocol
  readonly provider: SynapseGitProvider
  readonly remoteKind: SynapseGitRemoteKind
  readonly username: string | null
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
  readonly port?: number | null
  readonly primaryAction: SynapseGitFailurePrimaryAction
  readonly protocol: SynapseGitProtocol
  readonly title: string
}
export type SynapseGitCredentialHelperState = {
  readonly helpers: readonly {
    readonly classification: "safe" | "plaintext" | "custom"
    readonly source: string | null
    readonly value: string
  }[]
  readonly management: "unconfigured" | "synapse-supported" | "insecure" | "external"
  /** Compatibility summary for existing callers. */
  readonly helper: string | null
  readonly safe: boolean
  readonly source: string | null
}
export type SynapseGitAccessHostState = {
  readonly host: string
  readonly lastFailure: SynapseGitUserFacingFailure | null
  readonly port: number | null
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
  readonly port?: number | null
  readonly protocol: "http" | "https"
  readonly username: string
}
export type SynapseGitClearHttpsCredentialInput = {
  readonly host: string
  readonly port?: number | null
  readonly protocol: "http" | "https"
  readonly username?: string | null
}
export type SynapseGitGenerateSshKeyInput = {
  readonly email: string
}
export type SynapseGitTestSshConnectionInput = {
  readonly host: string
  readonly port?: number | null
  readonly provider?: SynapseGitProvider
  readonly username?: string | null
}
export type SynapseGitSshTestResult = {
  readonly detail: string | null
  readonly host: string
  readonly ok: boolean
  readonly title: string
}
export type SynapseGitSshHostKeyCandidate = {
  readonly changed: boolean
  readonly fingerprints: readonly string[]
  readonly host: string
  readonly port: number
  readonly trusted: boolean
}

export type SynapseGitRepository = {
  readonly id: string
  readonly name: string
  readonly localPath: string
  readonly addedAt: string
  readonly lastOpenedAt: string | null
}

export type SynapseGitCloneResult =
  | {
    readonly status: "registered"
    readonly repository: SynapseGitRepository
    readonly localPath: string
    readonly remoteKind: SynapseGitRemoteKind
    readonly message: null
  }
  | {
    readonly status: "registration-failed"
    readonly repository: null
    readonly localPath: string
    readonly remoteKind: SynapseGitRemoteKind
    readonly message: string
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
  readonly trackingStatus: "tracked" | "untracked" | "detached" | "gone"
  readonly ahead: number
  readonly behind: number
  readonly hasConflicts: boolean
  readonly changeCount: number
  readonly changesTruncated: boolean
  readonly changes: readonly SynapseGitFileChange[]
}

export type SynapseGitPushTarget = {
  readonly name: string
  readonly url: string
  readonly preferred: boolean
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
  readonly truncated: boolean
  readonly text: string
}

export type SynapseGitChangeSelection = {
  readonly selectionId: string
  readonly repositoryId: string
  readonly expiresAt: string
  readonly changes: readonly SynapseGitFileChange[]
}

export type SynapseGitBranch = {
  readonly name: string
  readonly current: boolean
}

export type SynapseGitRemoteBranch = {
  readonly name: string
  readonly fullName: string
}

export type SynapseGitRemoteBranchGroup = {
  readonly remoteName: string
  readonly branches: readonly SynapseGitRemoteBranch[]
}

export type SynapseGitCheckoutRemoteBranchInput = {
  readonly remoteName: string
  readonly branchName: string
  readonly localBranchName: string
}

export type SynapseGitCheckoutRemoteBranchResult = {
  readonly created: boolean
  readonly localBranchName: string
  readonly remoteBranchName: string
}

export type SynapseGitDiscardChangesResult = {
  readonly completedAt: string
  readonly discardedCount: number
  readonly restoredPaths: readonly string[]
  readonly trashedPaths: readonly string[]
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
  readonly filesTruncated: boolean
  readonly diffTruncated: boolean
  readonly truncated: boolean
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

export type SynapseGitOperationState = {
  readonly operationId: string
  readonly operation: string
  readonly repositoryId: string | null
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled"
  readonly queuePosition: number
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
