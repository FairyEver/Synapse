export type SynapseRepositoryOperationKind = "clone" | "sync"

export type SynapseRepositoryLocalStatus = "missing" | "ready" | "invalid"

export type SynapseRepositoryLocalState = {
  repositoryUuid: string
  localPath: string
  status: SynapseRepositoryLocalStatus
  isShallow: boolean
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
