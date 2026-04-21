import type { SynapseContentType } from "./content"

export const SYNAPSE_EDITOR_IDS = ["cursor", "codex", "claude-code"] as const

export type SynapseEditorId = (typeof SYNAPSE_EDITOR_IDS)[number]

export type SynapseEditorInstallScope = "global" | "project"

export type SynapseEditorInstallTargetKind = "file" | "directory"

export type SynapseEditorResolvedTargetStatus = "ready" | "unsupported" | "unavailable" | "conflict"

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
  /**
   * Rule's explicit ASCII identifier. Used as the filename for Claude Code
   * project-scope rules (`.claude/rules/{ruleName}.md`).
   */
  ruleName?: string
}

export type CursorRuleFrontmatter = {
  description: string
  globs: string
  alwaysApply: boolean
}

export type ClaudeCodeRuleFrontmatter = {
  paths: string
}

export type SynapseInstallToEditorPayload = SynapseResolveEditorTargetPayload & {
  cursorFrontmatter?: CursorRuleFrontmatter
  claudeCodeFrontmatter?: ClaudeCodeRuleFrontmatter
  /**
   * When true, indicates user has confirmed replacing an existing Skill.
   * The existing Skill directory will be backed up before installation.
   */
  replaceConfirmed?: boolean
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
}

export type SynapsePeekClaudeCodeFrontmatterPayload = {
  targetPath: string
}

export type SynapsePeekClaudeCodeFrontmatterResult = {
  frontmatter: ClaudeCodeRuleFrontmatter | null
}
