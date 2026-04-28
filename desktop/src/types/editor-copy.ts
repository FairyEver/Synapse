import type { SynapseContentType } from "./content"
import type {
  SynapseEditorId,
  SynapseEditorInstallFormValues,
  SynapseEditorInstallScope,
  SynapseEditorInstallTargetKind,
} from "./editor"
import type { EditorScanScope } from "./editor-scan"

export type SynapseEditorCopySource = {
  editorId: SynapseEditorId
  itemName: string
  itemPath: string
  itemType: Extract<SynapseContentType, "rule" | "skill">
  scope: EditorScanScope
  content?: string
  metadata?: Record<string, string>
  synapseContentId?: string | null
}

export type SynapseResolveEditorCopyTargetPayload = {
  source: SynapseEditorCopySource
  targetEditorId: SynapseEditorId
  targetScope: SynapseEditorInstallScope
  targetProjectPath?: string
}

export type SynapseCopyToEditorPayload = SynapseResolveEditorCopyTargetPayload & {
  installFormValues?: SynapseEditorInstallFormValues
  overwriteConfirmed?: boolean
}

export type SynapseEditorCopyResult = {
  editorId: SynapseEditorId
  label: string
  scope: SynapseEditorInstallScope
  contentType: Extract<SynapseContentType, "rule" | "skill">
  targetKind: SynapseEditorInstallTargetKind
  targetPath: string
  overwritten: boolean
}
