import type { SynapseContentType } from "./content"
import type {
  SynapseContentInstallResult,
  SynapseEditorId,
  SynapseEditorInstallFormValues,
  SynapseEditorInstallScope,
} from "./editor"

export type SynapseInstallerOrigin =
  | "repository"
  | "prepared"
  | "local-directory"
  | "inline"

export type SynapseInstallerKind = Extract<SynapseContentType, "skill" | "rule">

export type SynapseInstallerSourceBase = {
  kind: SynapseInstallerKind
  origin: SynapseInstallerOrigin
  sourceIdentity: string
  name: string
  title?: string
  description?: string
  sourceFingerprint?: string
}

export type SynapseSkillInstallerSource = SynapseInstallerSourceBase & {
  kind: "skill"
  localSourceId?: string
  mainContent?: string
  preparedSourceId?: string
  repositoryContentId?: string
}

export type SynapseSkillEnvDeclaration = {
  name: string
  defaultValue: string
}

export type SynapseSkillEnvInspectionResult = {
  declarations: SynapseSkillEnvDeclaration[]
  legacyPlaceholders: string[]
}

export type SynapseRuleInstallerSource = SynapseInstallerSourceBase & {
  kind: "rule"
  body?: string
  inlineSourceId?: string
  preparedSourceId?: string
  repositoryContentId?: string
}

export type SynapseInstallerSource =
  | SynapseSkillInstallerSource
  | SynapseRuleInstallerSource

export type SynapsePrepareLocalSkillSourcePayload = {
  sourceDirectoryPath: string
}

export type SynapsePrepareInlineRuleSourcePayload = {
  body: string
  name: string
}

export type SynapseInstallSourceToEditorPayload = {
  editorId: SynapseEditorId
  installFormValues?: SynapseEditorInstallFormValues
  overwriteConfirmed?: boolean
  projectPath?: string
  replaceConfirmed?: boolean
  replacedSourceIdentity?: string
  scope: SynapseEditorInstallScope
  source: SynapseInstallerSource
  variableSubstitutions?: Record<string, string>
}

export type SynapseInstallSourceTarget = {
  editorId: SynapseEditorId
  scope: SynapseEditorInstallScope
  projectPath?: string
}

export type SynapseInstallSourceToEditorTargetsPayload = {
  source: SynapseInstallerSource
  targets: SynapseInstallSourceTarget[]
  mode: "install" | "reinstall" | "update"
  overwriteConfirmed?: boolean
  replaceConfirmed?: boolean
  variableSubstitutions?: Record<string, string>
}

export type SynapseInstallSourceTargetResult = {
  target: SynapseInstallSourceTarget
  status: "installed" | "failed"
  result?: SynapseContentInstallResult
  error?: string
}

export type SynapseInstallSourceToEditorTargetsResult = {
  results: SynapseInstallSourceTargetResult[]
}
