import type {
  SkillUninstallBatchResult,
  SkillUninstallTarget,
} from "../../../../app-capabilities/skill-uninstaller/shared/schema"
import type { EditorScanSkillCopyItem } from "./editor-copy-source"

export type BulkSkillTrashResultItem =
  | { status: "trashed"; item: EditorScanSkillCopyItem; path: string; warning?: string }
  | { status: "failed"; item: EditorScanSkillCopyItem; message: string }

export type BulkSkillTrashSummary = {
  failed: number
  total: number
  trashed: number
}

function createBulkSkillUninstallTargets(
  items: readonly EditorScanSkillCopyItem[],
): SkillUninstallTarget[] {
  return items.map((item) => ({
    path: item.path,
    query: {
      name: item.name,
      ...(item.scope === "project"
        ? { searchRootPath: item.projectPath ?? item.path }
        : {}),
    },
  }))
}

function mapBulkSkillUninstallResults(
  items: readonly EditorScanSkillCopyItem[],
  result: SkillUninstallBatchResult,
): BulkSkillTrashResultItem[] {
  const resultByPath = new Map(result.results.map((item) => [item.path, item]))

  return items.map((item) => {
    const uninstallResult = resultByPath.get(item.path)
    if (!uninstallResult) {
      return {
        item,
        message: result.cancelled ? "已停止，未处理。" : "未返回卸载结果。",
        status: "failed",
      }
    }
    if (uninstallResult.status === "trashed") {
      return {
        item,
        path: uninstallResult.path,
        status: "trashed",
        ...(uninstallResult.warning ? { warning: uninstallResult.warning } : {}),
      }
    }
    return {
      item,
      message: uninstallResult.error ?? "未能移到废纸篓。",
      status: "failed",
    }
  })
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
  createBulkSkillUninstallTargets,
  mapBulkSkillUninstallResults,
}
