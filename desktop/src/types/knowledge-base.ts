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
