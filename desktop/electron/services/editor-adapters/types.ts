import type { SynapseContentType } from "../../../src/types/content"
import type {
  SynapseEditorAdapterSummary,
  SynapseEditorResolvedTarget,
} from "../../../src/types/editor"

export type EditorAdapterResolveContext = {
  contentId: string
  contentType: SynapseContentType
  skillName?: string
  skillTitle?: string
  ruleName?: string
}

export type EditorGlobalDirectoryPaths = {
  rulesPath: string | null
  skillsPath: string | null
}

export type EditorScanPathConfig = {
  globalSkillsPath: string | null
  globalRulesPath: string | null
  rulesSupported: boolean
  detectionDir: string
  projectPaths: (projectPath: string) => {
    skillsPath: string
    rulesPath: string
  }
}

export interface EditorAdapter extends SynapseEditorAdapterSummary {
  resolveGlobalDirectoryPaths(): EditorGlobalDirectoryPaths
  resolveGlobalTarget(context: EditorAdapterResolveContext): Promise<SynapseEditorResolvedTarget>
  resolveProjectTarget(
    projectPath: string,
    context: EditorAdapterResolveContext,
  ): Promise<SynapseEditorResolvedTarget>
  getScanPathConfig(): EditorScanPathConfig
}
