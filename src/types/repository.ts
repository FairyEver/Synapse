export type SynapseRepositoryOperationKind = "sync"

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
}

export type SynapseRepositoryOperationResult = {
  operation: SynapseRepositoryOperationKind
  repository: SynapseRepositoryLocalState
  completedAt: string
}
