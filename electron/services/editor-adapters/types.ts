import type { SynapseContentType } from "../../../src/types/content"
import type {
  SynapseEditorAdapterSummary,
  SynapseEditorResolvedTarget,
} from "../../../src/types/editor"

export type EditorAdapterResolveContext = {
  contentId: string
  contentType: SynapseContentType
}

export interface EditorAdapter extends SynapseEditorAdapterSummary {
  resolveGlobalTarget(context: EditorAdapterResolveContext): Promise<SynapseEditorResolvedTarget>
  resolveProjectTarget(
    projectPath: string,
    context: EditorAdapterResolveContext,
  ): Promise<SynapseEditorResolvedTarget>
}
