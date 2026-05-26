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

export type SynapseKnowledgeBaseDeleteManagedPayload = {
  projectId: string
}

export type SynapseKnowledgeBaseDeleteManagedResult = {
  projectId: string
  runtimePath: string
  deleted: boolean
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

export type SynapseKnowledgeBaseRawEntryKind = "file" | "directory"

export type SynapseKnowledgeBaseRawEntry = {
  name: string
  relativePath: string
  kind: SynapseKnowledgeBaseRawEntryKind
  size: number | null
  modifiedAt: string
}

export type SynapseKnowledgeBaseListRawDirectoryPayload = {
  projectId: string
  directoryPath: string
}

export type SynapseKnowledgeBaseListRawDirectoryResult = {
  projectId: string
  directoryPath: string
  entries: SynapseKnowledgeBaseRawEntry[]
}

export type SynapseKnowledgeBaseCreateRawFolderPayload = {
  projectId: string
  parentDirectoryPath: string
  name: string
}

export type SynapseKnowledgeBaseUploadRawFilesPayload = {
  projectId: string
  targetDirectoryPath: string
  filePaths: string[]
}

export type SynapseKnowledgeBaseRawMutationResult = {
  projectId: string
  entries: SynapseKnowledgeBaseRawEntry[]
  skipped: Array<{
    path: string
    reason: "not-file" | "not-directory" | "read-error" | "invalid-path" | "collision" | "trash-error"
  }>
}

export type SynapseKnowledgeBaseRenameRawEntryPayload = {
  projectId: string
  relativePath: string
  newName: string
}

export type SynapseKnowledgeBaseMoveRawEntriesPayload = {
  projectId: string
  relativePaths: string[]
  targetDirectoryPath: string
}

export type SynapseKnowledgeBaseTrashRawEntriesPayload = {
  projectId: string
  relativePaths: string[]
}
