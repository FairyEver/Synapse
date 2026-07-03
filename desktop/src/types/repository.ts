import type { SynapseRepositoryConfig } from "./config"

export type SynapseRepositoryOperationKind =
  | "sync"
  | "push"
  | "maintenance"
  | "initialize"
  | "disappeared"
  | "variables"

export const SYNAPSE_REPOSITORY_SYNC_FAILURE_CATEGORIES = [
  "network",
  "timeout",
  "auth",
  "upstream-missing",
  "diverged",
  "missing-path",
  "not-git",
  "ignored-paths",
  "git-missing",
  "no-changes",
  "unknown",
] as const

export type SynapseRepositorySyncFailureCategory =
  (typeof SYNAPSE_REPOSITORY_SYNC_FAILURE_CATEGORIES)[number]

export type SynapseRepositorySyncStatus =
  | "synced"
  | "syncing"
  | "pending"
  | "offline"
  | "attention"

export type SynapseRepositorySyncPhase =
  | "preparing"
  | "running"
  | "retry-wait"
  | "blocked"
  | "completed"

export type SynapseRepositorySyncPrimaryAction =
  | "retry"
  | "open-settings"
  | "resolve-git"
  | null

export type SynapseRepositoryLocalStatus = "missing" | "ready" | "inaccessible"

export type SynapseRepositoryLocalState = {
  repositoryUuid: string
  localPath: string
  status: SynapseRepositoryLocalStatus
  isGitRepository: boolean
  gitRootPath: string | null
}

export type SynapseRepositoryProgressEvent = {
  repositoryUuid: string
  operation: SynapseRepositoryOperationKind
  statusText: string
  percent: number | null
}

export type SynapseRepositoryUpdatedEvent = {
  repositoryUuid?: string
  operation: SynapseRepositoryOperationKind
  completedAt: string
  message?: string
  error?: string
}

export type SynapseRepositoryOperationResult = {
  operation: SynapseRepositoryOperationKind
  repository: SynapseRepositoryLocalState
  completedAt: string
  message?: string
  pendingPushCount?: number
}

export type SynapseRepositoryInitializationDangerFlag =
  | "home"
  | "desktop"
  | "documents"
  | "downloads"
  | "filesystem-root"
  | "synapse-source-checkout"
  | "source-repository"

export type SynapseRepositoryInitializationPreview = {
  isEmpty: boolean
  nonGitEntries: string[]
  operationToken: string
  dangerFlags: SynapseRepositoryInitializationDangerFlag[]
}

export type SynapseRepositoryInitializationOptions = {
  confirmedOperationToken?: string
}

export type SynapseRepositoryInitializationResult = {
  initializedAt: string
  message?: string
  pendingPushCount?: number
  repository: SynapseRepositoryLocalState
}

export type SynapseCreateLocalRepositoryPayload = {
  name: string
  parentPath: string
}

export type SynapseCreateLocalRepositoryResult = {
  createdAt: string
  message?: string
  repository: SynapseRepositoryConfig
}

export type SynapsePendingPushEntry = {
  id: number
  commitHash: string | null
  action: string
  targetId: string
  createdAt: string
  retryCount: number
  lastError: string | null
  lastErrorCategory?: SynapseRepositorySyncFailureCategory | null
  lastAttemptAt?: string | null
  nextRetryAt?: string | null
  title: string | null
}

export type SynapseRepositorySyncSnapshot = {
  repositoryUuid: string
  status: SynapseRepositorySyncStatus
  operation: SynapseRepositoryOperationKind | null
  phase: SynapseRepositorySyncPhase
  pendingCount: number
  pendingItems: SynapsePendingPushEntry[]
  message: string
  detail?: string
  failureCategory?: SynapseRepositorySyncFailureCategory | null
  lastAttemptAt?: string | null
  nextRetryAt?: string | null
  retryCount: number
  canRetryNow: boolean
  primaryAction: SynapseRepositorySyncPrimaryAction
}

export type SynapseRepositorySyncSnapshotUpdatedEvent = {
  repositoryUuid: string
  snapshot: SynapseRepositorySyncSnapshot
}

export type SynapsePendingPushState = {
  count: number
  items: SynapsePendingPushEntry[]
  itemsTruncated?: boolean
  firstErrorItem?: SynapsePendingPushEntry | null
  lastAttemptAt?: string | null
  nextRetryAt?: string | null
  retryCount?: number
}

export type SynapsePendingPushUpdatedEvent = {
  repositoryUuid: string
  pendingPushes: SynapsePendingPushState
}

export type SynapseRepositoryValidationResult = {
  isValid: boolean
  initializationPreview: SynapseRepositoryInitializationPreview
  missingDirectories: string[]
  message: string
}
