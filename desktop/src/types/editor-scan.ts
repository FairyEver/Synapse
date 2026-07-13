import type { SynapseEditorId } from "./editor"

export type EditorScanItemSource = "synapse" | "external"
export type EditorScanScope = "global" | "project"

export type EditorScanTrashInfo =
  | { mode: "path" }
  | { mode: "rule-section"; ruleId: string }
  | { mode: "unsupported"; disabledReason: string }

export type EditorScanTrashMode = EditorScanTrashInfo["mode"]

export type EditorScanSkillItem = {
  name: string
  path: string
  source: EditorScanItemSource
  synapseContentId: string | null
  repositoryVersion: string | null
  sourceFingerprint?: string | null
  preview: string
  mainFileName?: string | null
  fileCount: number
  trash: EditorScanTrashInfo
}

export type EditorScanRuleItem = {
  name: string
  path: string
  source: EditorScanItemSource
  synapseContentId: string | null
  preview: string
  metadata: Record<string, string>
  content?: string
  trash: EditorScanTrashInfo
}

export type EditorScanEditorStatus = "detected" | "not-detected"

export type EditorScanGlobalResult = {
  editorId: SynapseEditorId
  editorLabel: string
  status: EditorScanEditorStatus
  skills: EditorScanSkillItem[]
  skillScanError?: string
  duplicateSkillNames: string[]
  rules: EditorScanRuleItem[]
  rulesSupported: boolean
}

export type EditorScanProjectEntry = {
  editorId: SynapseEditorId
  editorLabel: string
  skills: EditorScanSkillItem[]
  skillScanError?: string
  rules: EditorScanRuleItem[]
}

export type EditorScanProjectResult = {
  projectPath: string
  projectName: string
  pathExists: boolean
  editors: EditorScanProjectEntry[]
}

export type EditorScanResult = {
  global: EditorScanGlobalResult[]
  projects: EditorScanProjectResult[]
}

export type EditorScanSkillFileEntry = {
  name: string
  size: number
}

export type ScanItemForDetail = {
  type: "skill" | "rule"
  name: string
  path: string
  source: EditorScanItemSource
  preview: string
  mainFileName?: string | null
  fileCount?: number
  metadata?: Record<string, string>
  synapseContentId?: string | null
  editorId: SynapseEditorId
  editorLabel: string
  scope: EditorScanScope
  projectName?: string
  projectPath?: string
  content?: string
  trash: EditorScanTrashInfo
}

export type EditorScanQuickPublishRequest = {
  itemType: "skill" | "rule"
  itemPath: string
  itemName: string
  ruleContent?: string
  metadata?: Record<string, string>
  purpose?: "copy" | "publish"
  synapseContentId?: string
}

export type EditorScanQuickPublishSkillFile = {
  originalName: string
  size: number
  bytes: Uint8Array
}

export type EditorScanSourceImportSummary = {
  controlFilesExcluded: string[]
  fileCount: number
  hiddenEntryCount: number
  runtimeEnvExcluded: boolean
  symlinkCount: number
  totalBytes: number
}

export type EditorScanQuickPublishDraft =
  | {
      itemType: "rule"
      itemPath: string
      itemName: string
      content: string
      metadata: Record<string, string>
    }
  | {
      itemType: "skill"
      itemPath: string
      itemName: string
      content: string
      files: EditorScanQuickPublishSkillFile[]
      metadata: Record<string, string>
      publishFingerprint: string
      publishSessionId?: string
      sourceFingerprint: string
      sourceImportSummary: EditorScanSourceImportSummary
    }

export type EditorScanFinalizeQuickPublishRequest = {
  contentId: string
  mode: "new" | "overwrite"
  repositoryVersion: string
  sessionId: string
}

export type EditorScanFinalizeQuickPublishResult = {
  message: string
  status:
    | "content-mismatch"
    | "identity-conflict"
    | "identity-written"
    | "session-expired"
    | "source-changed"
    | "write-failed"
}

export type EditorScanTrashRequest = {
  itemType: "rule"
  itemName: string
  itemPath: string
  editorId: SynapseEditorId
  scope: EditorScanScope
  source: EditorScanItemSource
  trash: EditorScanTrashInfo
  synapseContentId?: string | null
}

export type EditorScanTrashResult = {
  trashed: true
  mode: EditorScanTrashMode
  path: string
}

export type EditorScanSkillRepositoryUploadRequest = {
  itemType: "skill"
  itemPath: string
  itemName: string
  editorId: SynapseEditorId
  scope: EditorScanScope
  projectPath?: string | null
  mainFileName?: string | null
  expectedSourceFingerprint?: string
}

export type EditorScanSkillRepositoryUploadResult = {
  repositoryId: string
  name: string
  owner: string | null
  managementUrl: string
  identityWritten: boolean
  identityWriteError?: string
  identityMigrated: boolean
  identityMigrationWarning?: string
  sourceImportSummary: EditorScanSourceImportSummary
}
