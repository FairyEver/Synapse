export type SynapseKnowledgeBaseInitMode = "create" | "repair"

export type SynapseKnowledgeBaseInitializePayload = {
  projectPath: string
  mode: SynapseKnowledgeBaseInitMode
}

export type SynapseKnowledgeBaseInitializeResult = {
  projectPath: string
  templateVersion: string
  createdFiles: string[]
  existingFiles: string[]
}

export type SynapseKnowledgeBaseInspection = {
  projectPath: string
  isKnowledgeBase: boolean
  hasMetadata: boolean
  hasRequiredShape: boolean
  missingRequiredPaths: string[]
  templateVersion?: string
}

export type SynapseKnowledgeBaseOpenRawResult = {
  rawPath: string
}

export type SynapseKnowledgeBaseOpenSourceManagerPayload = {
  projectId: string
  projectPath: string
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
  projectPath: string
  sources: SynapseKnowledgeBaseSourceEntry[]
}

export type SynapseKnowledgeBaseUploadSourcesPayload = {
  projectPath: string
  filePaths: string[]
}

export type SynapseKnowledgeBaseUploadedSource = {
  originalPath: string
  relativePath: string
  name: string
  size: number
  originalRelativePath?: string
  conversionWarnings?: Array<{
    code: string
    message: string
  }>
}

export type SynapseKnowledgeBaseUploadSourcesResult = {
  projectPath: string
  uploaded: SynapseKnowledgeBaseUploadedSource[]
  skipped: Array<{
    path: string
    reason: "not-file" | "read-error" | "conversion-error"
  }>
}
