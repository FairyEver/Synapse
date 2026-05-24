export type SynapseKnowledgeBaseCreateManagedPayload = {
  projectId: string
  name: string
}

export type SynapseKnowledgeBaseCreateManagedResult = {
  projectId: string
  projectPath: string
  runtimePath: string
  templateVersion: string
  templateSource?: {
    repo?: string
    commit?: string
    syncedAt?: string
  }
}

export type SynapseKnowledgeBaseOpenSourceManagerPayload = {
  projectId: string
  projectName: string
}

export type SynapseKnowledgeBaseSourceStatus =
  | "pending"
  | "changed"
  | "imported"
  | "unsupported"
  | "error"

export type SynapseKnowledgeBaseSourceEntry = {
  relativePath: string
  name: string
  size: number
  modifiedAt: string
  supported: boolean
  status: SynapseKnowledgeBaseSourceStatus
  hash?: string
}

export type SynapseKnowledgeBaseListSourcesResult = {
  projectId: string
  sources: SynapseKnowledgeBaseSourceEntry[]
}

export type SynapseKnowledgeBaseUploadSourcesPayload = {
  projectId: string
  filePaths: string[]
}

export type SynapseKnowledgeBaseAddUrlSourcePayload = {
  projectId: string
  url: string
}

export type SynapseKnowledgeBaseFileConversionWarning = {
  readonly code: string
  readonly message: string
}

export type SynapseKnowledgeBaseUploadedSource = {
  originalPath: string
  relativePath: string
  name: string
  size: number
  readonly sourceKind?: "file" | "url"
  readonly sourceUrl?: string
  readonly originalRelativePath?: string
  readonly conversionWarnings?: readonly SynapseKnowledgeBaseFileConversionWarning[]
}

export type SynapseKnowledgeBaseUploadSourcesResult = {
  projectId: string
  uploaded: SynapseKnowledgeBaseUploadedSource[]
  skipped: Array<{
    path: string
    reason: "not-file" | "read-error" | "conversion-error"
  }>
}
