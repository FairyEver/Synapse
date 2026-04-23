import type { SynapseEditorId } from "./editor"

export type EditorScanItemSource = "synapse" | "external"

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
}

export type EditorScanEditorStatus = "detected" | "not-detected"

export type EditorScanGlobalResult = {
  editorId: SynapseEditorId
  editorLabel: string
  status: EditorScanEditorStatus
  skills: EditorScanSkillItem[]
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
