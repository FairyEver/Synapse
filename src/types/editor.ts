import type { SynapseContentType } from "./content"

export const SYNAPSE_EDITOR_IDS = ["cursor", "codex", "claude-code"] as const

export type SynapseEditorId = (typeof SYNAPSE_EDITOR_IDS)[number]

export type SynapseEditorInstallScope = "global" | "project"

export type SynapseEditorInstallTargetKind = "file" | "directory"

export type SynapseEditorResolvedTargetStatus = "ready" | "unsupported" | "unavailable"

export type SynapseEditorAdapterSummary = {
  id: SynapseEditorId
  label: string
  supportsGlobal: boolean
  supportsProject: boolean
  supportsRule: boolean
  supportsSkill: boolean
}

export type SynapseResolveEditorTargetPayload = {
  editorId: SynapseEditorId
  scope: SynapseEditorInstallScope
  contentType: SynapseContentType
  contentId: string
  projectPath?: string
}

export type SynapseInstallToEditorPayload = SynapseResolveEditorTargetPayload

type SynapseEditorResolvedTargetBase = {
  editorId: SynapseEditorId
  label: string
  scope: SynapseEditorInstallScope
  contentType: SynapseContentType
  message: string | null
}

export type SynapseEditorResolvedTarget =
  | (SynapseEditorResolvedTargetBase & {
      status: "ready"
      targetKind: SynapseEditorInstallTargetKind
      targetPath: string
    })
  | (SynapseEditorResolvedTargetBase & {
      status: "unsupported" | "unavailable"
      targetKind: null
      targetPath: null
    })

export type SynapseContentInstallResult = {
  editorId: SynapseEditorId
  label: string
  scope: SynapseEditorInstallScope
  contentType: SynapseContentType
  contentId: string
  targetKind: SynapseEditorInstallTargetKind
  targetPath: string
}
