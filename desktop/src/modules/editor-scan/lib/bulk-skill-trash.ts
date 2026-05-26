import type { EditorScanTrashRequest } from "@/types/editor-scan"
import type { EditorScanSkillCopyItem } from "./editor-copy-source"

export type BulkSkillTrashResultItem =
  | { status: "trashed"; item: EditorScanSkillCopyItem; path: string }
  | { status: "failed"; item: EditorScanSkillCopyItem; message: string }

export type BulkSkillTrashSummary = {
  failed: number
  total: number
  trashed: number
}

function createBulkSkillTrashRequest(item: EditorScanSkillCopyItem): EditorScanTrashRequest {
  return {
    editorId: item.editorId,
    itemName: item.name,
    itemPath: item.path,
    itemType: "skill",
    scope: item.scope,
    source: item.source,
    synapseContentId: item.synapseContentId ?? null,
    trash: item.trash,
  }
}

function buildBulkSkillTrashSummary(results: BulkSkillTrashResultItem[]): BulkSkillTrashSummary {
  return results.reduce<BulkSkillTrashSummary>(
    (summary, result) => {
      summary.total += 1
      if (result.status === "trashed") summary.trashed += 1
      if (result.status === "failed") summary.failed += 1
      return summary
    },
    { failed: 0, total: 0, trashed: 0 },
  )
}

export {
  buildBulkSkillTrashSummary,
  createBulkSkillTrashRequest,
}
