import type { SynapseEditorId } from "@/types/editor"
import type { SynapseEditorCopySource } from "@/types/editor-copy"
import type {
  EditorScanItemSource,
  EditorScanScope,
  EditorScanTrashInfo,
  ScanItemForDetail,
} from "@/types/editor-scan"

export type EditorScanSkillCopyItem = {
  key: string
  name: string
  path: string
  source: EditorScanItemSource
  preview: string
  fileCount: number
  synapseContentId: string | null
  editorId: SynapseEditorId
  editorLabel: string
  scope: EditorScanScope
  projectName?: string
  projectPath?: string
  trash: EditorScanTrashInfo
}

type CopySourceInput = ScanItemForDetail | EditorScanSkillCopyItem

function isDetailRuleItem(item: CopySourceInput): item is ScanItemForDetail & { type: "rule" } {
  return "type" in item && item.type === "rule"
}

function resolveCopyItemType(item: CopySourceInput): "skill" | "rule" {
  return "type" in item ? item.type : "skill"
}

function createCopySource(
  item: CopySourceInput,
  content: string | null = null,
): SynapseEditorCopySource {
  const itemType = resolveCopyItemType(item)

  return {
    content: itemType === "rule"
      ? content ?? (isDetailRuleItem(item) ? item.content : undefined)
      : undefined,
    editorId: item.editorId,
    itemName: item.name,
    itemPath: item.path,
    itemType,
    metadata: "metadata" in item ? item.metadata : undefined,
    scope: item.scope,
    synapseContentId: item.synapseContentId ?? null,
  }
}

export { createCopySource }
