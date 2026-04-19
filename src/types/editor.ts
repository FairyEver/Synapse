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
  supportedContentTypes: SynapseContentType[]
}

export type SynapseResolveEditorTargetPayload = {
  editorId: SynapseEditorId
  scope: SynapseEditorInstallScope
  contentType: SynapseContentType
  contentId: string
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
}

export type CursorRuleFrontmatter = {
  description: string
  globs: string
  alwaysApply: boolean
}

export type SynapseInstallToEditorPayload = SynapseResolveEditorTargetPayload & {
  cursorFrontmatter?: CursorRuleFrontmatter
}

export type SynapsePeekCursorFrontmatterPayload = {
  targetPath: string
}

export type SynapsePeekCursorFrontmatterResult = {
  frontmatter: CursorRuleFrontmatter | null
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
