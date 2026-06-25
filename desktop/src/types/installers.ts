import type { SynapseContentType } from "./content"
import type {
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
}

export type SynapseSkillInstallerSource = SynapseInstallerSourceBase & {
  kind: "skill"
  localSourceId?: string
  mainContent?: string
  preparedSourceId?: string
  repositoryContentId?: string
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
