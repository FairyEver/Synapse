import type { SynapseContentType } from "./content"

export type SynapseEditorId = string & { readonly __brand?: "SynapseEditorId" }

export type SynapseEditorInstallScope = "global" | "project"

export type SynapseEditorInstallTargetKind = "file" | "directory"

export type SynapseEditorResolvedTargetStatus = "ready" | "unsupported" | "unavailable" | "conflict"

export type SynapseEditorInstallFormValues = Record<string, unknown>

export type SynapseEditorAdapterSummary = {
  id: SynapseEditorId
  label: string
  order: number
  supportsGlobal: boolean
  supportsProject: boolean
  supportedContentTypes: SynapseContentType[]
}

export type SynapseResolveEditorTargetPayload = {
  editorId: SynapseEditorId
  scope: SynapseEditorInstallScope
  contentType: SynapseContentType
  contentId: string
  /**
   * Opaque main-process handle for a validated install package.
   * Renderer never receives the underlying temporary path or package bytes.
   */
  preparedSourceId?: string
  projectPath?: string
  /**
   * Skill's explicit ASCII identifier (the new `name` field). When present, it
   * is used verbatim as the skill directory name. Rules ignore it.
   */
  skillName?: string
  /**
   * Skill title hint — fallback used only for legacy Skills that have no
   * `name` yet. Slugified to produce a directory name.
   */
  skillTitle?: string
  /**
   * Rule's explicit ASCII identifier. Used as the filename for Claude Code
   * project-scope rules (`.claude/rules/{ruleName}.md`).
   */
  ruleName?: string
}

export type SynapseInstallToEditorPayload = SynapseResolveEditorTargetPayload & {
  installFormValues?: SynapseEditorInstallFormValues
  /**
   * When true, indicates user has confirmed replacing an existing Skill.
   * The existing Skill directory will be backed up before installation.
   */
  replaceConfirmed?: boolean
  /**
   * When true, indicates user has confirmed overwriting an existing target directory.
   */
  overwriteConfirmed?: boolean
  /**
   * Content id of the Skill being replaced during a confirmed conflict install.
   * Used to clear stale install-status badges after the target directory changes owner.
   */
  replacedContentId?: string
  skillEnvReplacementValues?: Record<string, string>
  skillEnvValues?: Record<string, string>
  variableSubstitutions?: Record<string, string>
}

export type SynapseReadEditorInstallFormValuesPayload = {
  editorId: SynapseEditorId
  targetPath: string
}

export type SynapseReadEditorInstallFormValuesResult = {
  values: SynapseEditorInstallFormValues | null
}

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
      targetExists: boolean
      ownedTargetExists?: boolean
    })
  | (SynapseEditorResolvedTargetBase & {
      status: "unsupported" | "unavailable"
      targetKind: null
      targetPath: null
    })
  | (SynapseEditorResolvedTargetBase & {
      status: "conflict"
      targetKind: SynapseEditorInstallTargetKind
      targetPath: string
      conflictContentId: string
    })

export type SynapseContentInstallResult = {
  editorId: SynapseEditorId
  label: string
  scope: SynapseEditorInstallScope
  contentType: SynapseContentType
  contentId: string
  targetKind: SynapseEditorInstallTargetKind
  targetPath: string
  warning?: string
}

export type SynapseEditorGlobalDirectory = {
  editorId: SynapseEditorId
  label: string
  rulesPath: string | null
  rulesPathKind: "directory" | "file"
  rulesExists: boolean
  skillsPath: string | null
  skillsPathKind: "directory" | "file"
  skillsExists: boolean
}
