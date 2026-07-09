import type { SynapseContentType } from "./content"
import type { SynapseEditorId, SynapseEditorInstallScope } from "./editor"

export type SynapseEditorInstallStatusValue =
  | "not_installed"
  | "installed"
  | "needs_update"
  | "external_same_name"
  | "conflict"
  | "unsupported"
  | "unavailable"

export type SynapseEditorInstallStatusProject = {
  id: string
  name: string
  path: string
}

export type SynapseResolveEditorInstallStatusPayload = {
  contentType: Extract<SynapseContentType, "rule" | "skill">
  contentId: string
  contentName?: string
  title?: string
  content?: string
  repositoryVersion?: string
  sourceFingerprint?: string
  projects: SynapseEditorInstallStatusProject[]
}

export type SynapseEditorInstallStatusEntry = {
  editorId: SynapseEditorId
  editorLabel: string
  scope: SynapseEditorInstallScope
  projectId?: string
  projectName?: string
  status: SynapseEditorInstallStatusValue
  targetPath: string | null
  message: string | null
}

export type SynapseEditorInstallStatusResult = {
  entries: SynapseEditorInstallStatusEntry[]
}
