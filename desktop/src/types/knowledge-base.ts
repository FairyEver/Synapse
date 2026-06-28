export type SynapseKnowledgeBaseCreateManagedPayload = {
  projectId: string
  name: string
}

export type SynapseKnowledgeBaseCreateManagedResult = {
  projectId: string
  projectPath: string
  templateVersion: string
  templateSource?: {
    repo?: string
    commit?: string
    syncedAt?: string
  }
}

export type SynapseKnowledgeBaseDeleteManagedPayload = {
  projectId: string
  runtimeId?: string
}

export type SynapseKnowledgeBaseDeleteManagedResult = {
  projectId: string
  deleted: boolean
}

export type SynapseKnowledgeBaseOpenSourceManagerPayload = {
  projectId: string
  projectName: string
}

export type SynapseKnowledgeBaseAddUrlSourcePayload = {
  projectId: string
  targetDirectoryPath?: string
  url: string
}

export type SynapseKnowledgeBaseUploadedSource = {
  originalPath: string
  relativePath: string
  name: string
  size: number
  readonly sourceKind?: "file" | "url"
  readonly sourceUrl?: string
  readonly originalRelativePath?: string
}

export type SynapseKnowledgeBaseUrlSkipReason =
  | "invalid_url"
  | "unsupported_protocol"
  | "url_credentials"
  | "local_or_private_host"
  | "http_error"
  | "unsupported_content_type"
  | "size_limit_exceeded"
  | "network_error"

export type SynapseKnowledgeBaseUploadSourcesResult = {
  projectId: string
  uploaded: SynapseKnowledgeBaseUploadedSource[]
  skipped: Array<{
    path: string
    reason: "not-file" | "read-error" | "unsupported" | SynapseKnowledgeBaseUrlSkipReason
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
  entryKind?: "all" | "directory"
  query?: string
  offset?: number
  limit?: number
}

export type SynapseKnowledgeBaseListRawDirectoryResult = {
  projectId: string
  directoryPath: string
  entries: SynapseKnowledgeBaseRawEntry[]
  totalCount?: number
  offset?: number
  limit?: number
  hasMore?: boolean
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

export type SynapseKnowledgeBaseUploadRawItemsPayload = {
  projectId: string
  targetDirectoryPath: string
  itemPaths: string[]
}

export type SynapseKnowledgeBaseSelectAndUploadRawDirectoryPayload = {
  projectId: string
  targetDirectoryPath: string
}

export type SynapseKnowledgeBaseExportRawEntriesPayload = {
  projectId: string
  relativePaths: string[]
  targetDirectoryPath: string
}

export type SynapseKnowledgeBaseRawSkipReason =
  | "not-file"
  | "not-directory"
  | "read-error"
  | "invalid-path"
  | "invalid-name"
  | "collision"
  | "trash-error"
  | "symlink"
  | "system-noise"
  | "export-error"
  | "too-many-files"
  | "too-large"
  | "too-deep"
  | "file-too-large"

export type SynapseKnowledgeBaseRawMutationResult = {
  projectId: string
  entries: SynapseKnowledgeBaseRawEntry[]
  skipped: Array<{
    path: string
    reason: SynapseKnowledgeBaseRawSkipReason
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

export type SynapseKnowledgeBaseStorageStatus = {
  mode: "default" | "custom"
  rootPath: string
  knowledgeBasesPath: string
  available: boolean
  unavailableReason?: string
  oldAbsoluteReferenceCount?: number
}

export type SynapseKnowledgeBaseStorageMigrationPayload = {
  target: { mode: "default" } | { mode: "custom"; rootPath: string }
}

export type SynapseKnowledgeBaseStorageMigrationProgress = {
  active: boolean
  phase:
    | "idle"
    | "preparing"
    | "copying"
    | "verifying"
    | "switching"
    | "cleaning"
    | "completed"
    | "completed-with-warning"
    | "failed"
    | "cancelled"
    | "recovering"
  cancellable: boolean
  copiedBytes: number
  totalBytes: number | null
  message: string
  warningCode?: "free-space-unknown" | "old-copy-not-trashed"
  errorMessage?: string
}

export type SynapseKnowledgeBaseStorageMigrationResult =
  | { status: "completed" }
  | { status: "completed-with-warning"; warningCode: "old-copy-not-trashed" }
  | { status: "cancelled" }
