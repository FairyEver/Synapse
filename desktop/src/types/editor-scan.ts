import type { SynapseEditorId } from "./editor"

export type EditorScanItemSource = "synapse" | "external"
export type EditorScanScope = "global" | "project"

export type EditorScanSkillItem = {
  name: string
  path: string
  source: EditorScanItemSource
  synapseContentId: string | null
  preview: string
  fileCount: number
}

export type EditorScanRuleItem = {
  name: string
  path: string
  source: EditorScanItemSource
  synapseContentId: string | null
  preview: string
  metadata: Record<string, string>
  content?: string
}

export type EditorScanEditorStatus = "detected" | "not-detected"

export type EditorScanGlobalResult = {
  editorId: SynapseEditorId
  editorLabel: string
  status: EditorScanEditorStatus
  skills: EditorScanSkillItem[]
  duplicateSkillNames: string[]
  rules: EditorScanRuleItem[]
  rulesSupported: boolean
}

export type EditorScanProjectEntry = {
  editorId: SynapseEditorId
  editorLabel: string
  skills: EditorScanSkillItem[]
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
  fileCount?: number
  metadata?: Record<string, string>
  synapseContentId?: string | null
  editorId: SynapseEditorId
  editorLabel: string
  scope: EditorScanScope
  projectName?: string
  content?: string
}

export type EditorScanQuickPublishRequest = {
  itemType: "skill" | "rule"
  itemPath: string
  itemName: string
  ruleContent?: string
  metadata?: Record<string, string>
}

export type EditorScanQuickPublishSkillFile = {
  originalName: string
  size: number
  bytes: Uint8Array
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
    }
