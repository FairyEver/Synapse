import path from "node:path"
import type { DriveChangeDto, DriveItemType } from "@synapse/shared" with { "resolution-mode": "import" }
import type {
  DriveSyncBaselineEntryV1,
  DriveSyncBindingEntryV1,
  DriveSyncConflictEntryV1,
  DriveSyncOperationEntryV1,
} from "../runtime/data-repo"
import { isDriveSyncExcluded } from "./drive-sync-excludes"

export interface DriveSyncLocalChange {
  readonly bindingId: string
  readonly relativePath: string
  readonly kind: "created" | "modified" | "deleted"
  readonly localPath: string
  readonly localKind: "missing" | "file" | "folder" | "other"
}

export interface DriveSyncPlannedOperation {
  readonly bindingId: string
  readonly kind: DriveSyncOperationEntryV1["kind"]
  readonly driveItemId: string | null
  readonly relativePath: string
  readonly localPath: string | null
  readonly remotePathHint: string | null
  readonly remoteItemKind: DriveItemType | null
}

export interface DriveSyncPlannedConflict {
  readonly bindingId: string
  readonly driveItemId: string | null
  readonly relativePath: string
  readonly localPath: string | null
  readonly remotePathHint: string | null
  readonly type: DriveSyncConflictEntryV1["type"]
  readonly localSnapshot: Record<string, unknown> | null
  readonly remoteSnapshot: Record<string, unknown> | null
}

export interface DriveSyncPlanResult {
  readonly operations: readonly DriveSyncPlannedOperation[]
  readonly conflicts: readonly DriveSyncPlannedConflict[]
}

export function planDriveSyncLocalChanges(input: {
  readonly binding: DriveSyncBindingEntryV1
  readonly baseline: readonly DriveSyncBaselineEntryV1[]
  readonly changes: readonly DriveSyncLocalChange[]
  readonly remoteChangedPaths?: ReadonlySet<string>
}): DriveSyncPlanResult {
  const baselineByPath = activeBaselineByPath(input.baseline)
  const operations: DriveSyncPlannedOperation[] = []
  const conflicts: DriveSyncPlannedConflict[] = []
  const remoteChangedPaths = input.remoteChangedPaths ?? new Set<string>()

  for (const change of input.changes) {
    if (isDriveSyncExcluded(change.relativePath, input.binding.excludeRules)) continue
    const baseline = baselineByPath.get(change.relativePath)
    if (remoteChangedPaths.has(change.relativePath)) {
      conflicts.push(plannedConflict({
        binding: input.binding,
        baseline,
        change,
        type: change.kind === "deleted" ? "delete_vs_modify" : "both_modified",
      }))
      continue
    }
    if (baseline && change.localKind !== "missing" && baseline.kind !== change.localKind) {
      conflicts.push(plannedConflict({ binding: input.binding, baseline, change, type: "type_mismatch" }))
      continue
    }

    if (change.kind === "deleted") {
      if (!baseline) continue
      operations.push(plannedOperation({
        binding: input.binding,
        kind: "delete_remote",
        relativePath: change.relativePath,
        localPath: change.localPath,
        driveItemId: baseline.remoteItemId,
        remotePathHint: null,
      }))
    } else {
      operations.push(plannedOperation({
        binding: input.binding,
        kind: "upload",
        relativePath: change.relativePath,
        localPath: change.localPath,
        driveItemId: baseline?.remoteItemId ?? null,
        remotePathHint: null,
      }))
    }
  }

  return sortPlan({ operations, conflicts })
}

export function planDriveSyncRemoteChanges(input: {
  readonly binding: DriveSyncBindingEntryV1
  readonly baseline: readonly DriveSyncBaselineEntryV1[]
  readonly changes: readonly DriveChangeDto[]
  readonly localChangedPaths?: ReadonlySet<string>
}): DriveSyncPlanResult {
  const baselineByRemoteId = new Map(
    input.baseline
      .filter((entry) => entry.deletedAt === null)
      .map((entry) => [entry.remoteItemId, entry] as const),
  )
  const localChangedPaths = input.localChangedPaths ?? new Set<string>()
  const operations: DriveSyncPlannedOperation[] = []
  const conflicts: DriveSyncPlannedConflict[] = []

  for (const change of input.changes) {
    const baseline = baselineByRemoteId.get(change.itemId)
    if (input.binding.kind === "file" && !baseline && change.itemId !== input.binding.driveItemId) continue
    const relativePath = baseline?.relativePath ?? remoteRelativePath(input.binding, change)
    if (relativePath === null) continue
    if (isDriveSyncExcluded(relativePath, input.binding.excludeRules)) continue
    const localPath = path.join(input.binding.localPath, relativePath)

    if (localChangedPaths.has(relativePath)) {
      conflicts.push({
        bindingId: input.binding.id,
        driveItemId: change.itemId,
        relativePath,
        localPath,
        remotePathHint: change.pathHint ?? null,
        type: change.type === "trashed" || change.type === "deleted" ? "delete_vs_modify" : "both_modified",
        localSnapshot: null,
        remoteSnapshot: { change },
      })
      continue
    }

    if (change.type === "trashed" || change.type === "deleted") {
      operations.push(plannedOperation({
        binding: input.binding,
        kind: "delete_local",
        relativePath,
        localPath,
        driveItemId: change.itemId,
        remotePathHint: change.pathHint ?? null,
        remoteItemKind: change.itemKind ?? null,
      }))
      continue
    }
    if (change.type === "renamed" || change.type === "moved") {
      operations.push(plannedOperation({
        binding: input.binding,
        kind: "move_local",
        relativePath,
        localPath,
        driveItemId: change.itemId,
        remotePathHint: change.pathHint ?? null,
        remoteItemKind: change.itemKind ?? null,
      }))
      continue
    }

    operations.push(plannedOperation({
      binding: input.binding,
      kind: "download",
      relativePath,
      localPath,
      driveItemId: change.itemId,
      remotePathHint: change.pathHint ?? null,
      remoteItemKind: change.itemKind ?? null,
    }))
  }

  return sortPlan({ operations, conflicts })
}

function activeBaselineByPath(entries: readonly DriveSyncBaselineEntryV1[]): Map<string, DriveSyncBaselineEntryV1> {
  return new Map(
    entries
      .filter((entry) => entry.deletedAt === null)
      .map((entry) => [entry.relativePath, entry] as const),
  )
}

function plannedOperation(input: {
  readonly binding: DriveSyncBindingEntryV1
  readonly kind: DriveSyncOperationEntryV1["kind"]
  readonly driveItemId: string | null
  readonly relativePath: string
  readonly localPath: string | null
  readonly remotePathHint: string | null
  readonly remoteItemKind?: DriveItemType | null
}): DriveSyncPlannedOperation {
  return {
    bindingId: input.binding.id,
    kind: input.kind,
    driveItemId: input.driveItemId,
    relativePath: input.relativePath,
    localPath: input.localPath,
    remotePathHint: input.remotePathHint,
    remoteItemKind: input.remoteItemKind ?? null,
  }
}

function plannedConflict(input: {
  readonly binding: DriveSyncBindingEntryV1
  readonly baseline: DriveSyncBaselineEntryV1 | undefined
  readonly change: DriveSyncLocalChange
  readonly type: DriveSyncConflictEntryV1["type"]
}): DriveSyncPlannedConflict {
  return {
    bindingId: input.binding.id,
    driveItemId: input.baseline?.remoteItemId ?? null,
    relativePath: input.change.relativePath,
    localPath: input.change.localPath,
    remotePathHint: null,
    type: input.type,
    localSnapshot: { change: input.change },
    remoteSnapshot: input.baseline ? { baseline: input.baseline } : null,
  }
}

function remoteRelativePath(binding: DriveSyncBindingEntryV1, change: DriveChangeDto): string | null {
  if (change.itemId === binding.driveItemId) return ""
  if (binding.kind === "file") return null
  if (!change.pathHint || !binding.drivePathHint) return null
  const bindingPath = normalizeDrivePath(binding.drivePathHint)
  const changePath = normalizeDrivePath(change.pathHint)
  if (changePath === bindingPath) return ""
  const prefix = `${bindingPath}/`
  if (!changePath.startsWith(prefix)) return null
  return changePath.slice(prefix.length)
}

function normalizeDrivePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+/gu, "/")
  return normalized.startsWith("/") ? normalized : `/${normalized}`
}

function sortPlan(result: {
  readonly operations: DriveSyncPlannedOperation[]
  readonly conflicts: DriveSyncPlannedConflict[]
}): DriveSyncPlanResult {
  return {
    operations: [...result.operations].sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    conflicts: [...result.conflicts].sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  }
}
