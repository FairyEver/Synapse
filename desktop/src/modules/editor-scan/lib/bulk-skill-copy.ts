import type {
  SynapseEditorId,
  SynapseEditorInstallFormValues,
  SynapseEditorInstallScope,
  SynapseEditorResolvedTarget,
} from "@/types/editor"
import type { SynapseCopyToEditorPayload, SynapseEditorCopySource } from "@/types/editor-copy"
import type { EditorScanSkillCopyItem } from "./editor-copy-source"

export type BulkSkillCopyPreflightItem =
  | {
      status: "ready"
      item: EditorScanSkillCopyItem
      source: SynapseEditorCopySource
      targetPath: string
      overwrite: false
    }
  | {
      status: "overwrite"
      item: EditorScanSkillCopyItem
      source: SynapseEditorCopySource
      targetPath: string
      overwrite: true
    }
  | {
      status: "unavailable"
      item: EditorScanSkillCopyItem
      source: SynapseEditorCopySource
      message: string
    }

export type BulkSkillCopyExecutableItem =
  Extract<BulkSkillCopyPreflightItem, { status: "ready" | "overwrite" }>

export type BulkSkillCopyResultItem =
  | { status: "copied"; item: EditorScanSkillCopyItem; targetPath: string; overwritten: boolean }
  | { status: "failed"; item: EditorScanSkillCopyItem; message: string }
  | { status: "skipped"; item: EditorScanSkillCopyItem; message: string }

export type BulkSkillCopySummary = {
  copied: number
  failed: number
  skipped: number
  total: number
}

function classifyBulkSkillCopyPreflight(
  item: EditorScanSkillCopyItem,
  source: SynapseEditorCopySource,
  target: SynapseEditorResolvedTarget,
): BulkSkillCopyPreflightItem {
  if (target.status === "ready") {
    return target.targetExists
      ? { item, overwrite: true, source, status: "overwrite", targetPath: target.targetPath }
      : { item, overwrite: false, source, status: "ready", targetPath: target.targetPath }
  }

  return {
    item,
    message: target.message ?? "当前环境暂时不能复制到这个位置。",
    source,
    status: "unavailable",
  }
}

function createUnavailablePreflightItem(
  item: EditorScanSkillCopyItem,
  source: SynapseEditorCopySource,
  error: unknown,
): BulkSkillCopyPreflightItem {
  return {
    item,
    message: error instanceof Error ? error.message : "解析复制位置失败。",
    source,
    status: "unavailable",
  }
}

function createBulkSkillCopyPayload(
  preflight: BulkSkillCopyExecutableItem,
  targetEditorId: SynapseEditorId,
  targetScope: SynapseEditorInstallScope,
  targetProjectPath?: string,
  installFormValues?: SynapseEditorInstallFormValues,
): SynapseCopyToEditorPayload {
  return {
    installFormValues,
    overwriteConfirmed: preflight.status === "overwrite" ? true : undefined,
    source: preflight.source,
    targetEditorId,
    targetProjectPath: targetScope === "project" ? targetProjectPath : undefined,
    targetScope,
  }
}

function buildBulkSkillCopySummary(results: BulkSkillCopyResultItem[]): BulkSkillCopySummary {
  return results.reduce<BulkSkillCopySummary>(
    (summary, result) => {
      summary.total += 1
      if (result.status === "copied") summary.copied += 1
      if (result.status === "failed") summary.failed += 1
      if (result.status === "skipped") summary.skipped += 1
      return summary
    },
    { copied: 0, failed: 0, skipped: 0, total: 0 },
  )
}

function isExecutablePreflightItem(
  item: BulkSkillCopyPreflightItem,
): item is BulkSkillCopyExecutableItem {
  return item.status === "ready" || item.status === "overwrite"
}

export {
  buildBulkSkillCopySummary,
  classifyBulkSkillCopyPreflight,
  createBulkSkillCopyPayload,
  createUnavailablePreflightItem,
  isExecutablePreflightItem,
}
