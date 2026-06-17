export type SynapseGitRemoteKind = "https" | "ssh" | "unknown"

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
  readonly gitAvailable: boolean
  readonly gitVersion: string | null
  readonly gitPath: string | null
  readonly sshAvailable: boolean
  readonly userName: string | null
  readonly userEmail: string | null
  readonly commonSshKeyExists: boolean
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
