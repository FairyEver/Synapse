import type { SynapseRepositoryConfig } from "./config"

export type SynapseRepositoryOperationKind = "sync" | "push" | "maintenance" | "initialize"

export type SynapseRepositoryLocalStatus = "missing" | "ready"

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
  repositoryUuid: string
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

export type SynapseRepositoryInitializationPreview = {
  isEmpty: boolean
  nonGitEntries: string[]
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
  title: string | null
}

export type SynapsePendingPushState = {
  count: number
  items: SynapsePendingPushEntry[]
}

export type SynapsePendingPushUpdatedEvent = {
  repositoryUuid: string
  pendingPushes: SynapsePendingPushState
}

export type SynapseRepositoryValidationResult = {
  isValid: boolean
  missingDirectories: string[]
  message: string
}
