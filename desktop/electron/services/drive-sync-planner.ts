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
  readonly localSize?: number | null
  readonly localMtimeMs?: number | null
  readonly localHash?: string | null
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
  const plannedMoves = detectLocalMoveOperations({
    binding: input.binding,
    baseline: input.baseline,
    baselineByPath,
    changes: input.changes,
    remoteChangedPaths,
  })
  const consumedMovePaths = new Set<string>()
  for (const move of plannedMoves) {
    operations.push(move.operation)
    for (const relativePath of move.consumedPaths) consumedMovePaths.add(relativePath)
  }

  for (const change of input.changes) {
    if (consumedMovePaths.has(change.relativePath)) continue
    if (isDriveSyncExcluded(change.relativePath, input.binding.excludeRules)) continue
    if (input.binding.kind === "folder" && change.relativePath === "") continue
    const baseline = baselineByPath.get(change.relativePath)
    if (baseline && change.kind !== "deleted" && baseline.kind === "folder" && change.localKind === "folder") continue
    if (hasChangedPathOverlap(remoteChangedPaths, change.relativePath)) {
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

function detectLocalMoveOperations(input: {
  readonly binding: DriveSyncBindingEntryV1
  readonly baseline: readonly DriveSyncBaselineEntryV1[]
  readonly baselineByPath: ReadonlyMap<string, DriveSyncBaselineEntryV1>
  readonly changes: readonly DriveSyncLocalChange[]
  readonly remoteChangedPaths: ReadonlySet<string>
}): Array<{ readonly operation: DriveSyncPlannedOperation; readonly consumedPaths: readonly string[] }> {
  if (input.binding.kind !== "folder") return []
  const activeBaseline = input.baseline.filter((entry) => entry.deletedAt === null)
  const changesByPath = new Map(input.changes.map((change) => [change.relativePath, change] as const))
  const deletedChanges = input.changes.filter((change) =>
    change.kind === "deleted" && !isDriveSyncExcluded(change.relativePath, input.binding.excludeRules),
  )
  const createdChanges = input.changes.filter((change) =>
    change.kind === "created"
    && !input.baselineByPath.has(change.relativePath)
    && !isDriveSyncExcluded(change.relativePath, input.binding.excludeRules),
  )
  const usedDeleted = new Set<string>()
  const usedCreated = new Set<string>()
  const moves: Array<{ readonly operation: DriveSyncPlannedOperation; readonly consumedPaths: readonly string[] }> = []

  for (const created of createdChanges) {
    if (usedCreated.has(created.relativePath) || hasChangedPathOverlap(input.remoteChangedPaths, created.relativePath)) continue
    if (!hasExistingRemoteParent(created.relativePath, input.baselineByPath)) continue
    const deleted = deletedChanges.find((candidate) => {
      if (usedDeleted.has(candidate.relativePath) || hasChangedPathOverlap(input.remoteChangedPaths, candidate.relativePath)) return false
      const deletedBaseline = input.baselineByPath.get(candidate.relativePath)
      if (!deletedBaseline || deletedBaseline.kind !== created.localKind) return false
      if (created.localKind === "file") return sameFileSnapshot(created, deletedBaseline)
      if (created.localKind === "folder") return sameFolderSubtree({
        oldRoot: candidate.relativePath,
        newRoot: created.relativePath,
        activeBaseline,
        changesByPath,
        remoteChangedPaths: input.remoteChangedPaths,
      })
      return false
    })
    if (!deleted) continue
    const deletedBaseline = input.baselineByPath.get(deleted.relativePath)
    if (!deletedBaseline) continue
    const consumedPaths = consumedLocalMovePaths(deleted.relativePath, created.relativePath, activeBaseline)
    for (const relativePath of consumedPaths) {
      if (relativePath === deleted.relativePath || relativePath.startsWith(`${deleted.relativePath}/`)) usedDeleted.add(relativePath)
      if (relativePath === created.relativePath || relativePath.startsWith(`${created.relativePath}/`)) usedCreated.add(relativePath)
    }
    moves.push({
      operation: plannedOperation({
        binding: input.binding,
        kind: "move_remote",
        relativePath: created.relativePath,
        localPath: created.localPath,
        driveItemId: deletedBaseline.remoteItemId,
        remotePathHint: null,
        remoteItemKind: deletedBaseline.kind,
      }),
      consumedPaths,
    })
  }

  return moves
}

function sameFileSnapshot(change: DriveSyncLocalChange, baseline: DriveSyncBaselineEntryV1): boolean {
  return change.localKind === "file"
    && Boolean(change.localHash)
    && Boolean(baseline.localHash)
    && change.localHash === baseline.localHash
}

function sameFolderSubtree(input: {
  readonly oldRoot: string
  readonly newRoot: string
  readonly activeBaseline: readonly DriveSyncBaselineEntryV1[]
  readonly changesByPath: ReadonlyMap<string, DriveSyncLocalChange>
  readonly remoteChangedPaths: ReadonlySet<string>
}): boolean {
  const subtree = input.activeBaseline.filter((entry) => isPathInSubtree(entry.relativePath, input.oldRoot))
  if (subtree.length === 0) return false
  for (const baseline of subtree) {
    if (hasChangedPathOverlap(input.remoteChangedPaths, baseline.relativePath)) return false
    const suffix = subtreeSuffix(baseline.relativePath, input.oldRoot)
    const newPath = suffix ? path.posix.join(input.newRoot, suffix) : input.newRoot
    if (hasChangedPathOverlap(input.remoteChangedPaths, newPath)) return false
    const change = input.changesByPath.get(newPath)
    if (!change || change.kind !== "created" || change.localKind !== baseline.kind) return false
    if (baseline.kind === "file" && !sameFileSnapshot(change, baseline)) return false
  }
  return true
}

function consumedLocalMovePaths(
  oldRoot: string,
  newRoot: string,
  activeBaseline: readonly DriveSyncBaselineEntryV1[],
): readonly string[] {
  const paths = new Set<string>()
  for (const baseline of activeBaseline) {
    if (!isPathInSubtree(baseline.relativePath, oldRoot)) continue
    paths.add(baseline.relativePath)
    const suffix = subtreeSuffix(baseline.relativePath, oldRoot)
    paths.add(suffix ? path.posix.join(newRoot, suffix) : newRoot)
  }
  return [...paths]
}

function hasExistingRemoteParent(relativePath: string, baselineByPath: ReadonlyMap<string, DriveSyncBaselineEntryV1>): boolean {
  const parent = path.posix.dirname(relativePath)
  return parent === "." || baselineByPath.has(parent)
}

function isPathInSubtree(relativePath: string, root: string): boolean {
  return relativePath === root || relativePath.startsWith(`${root}/`)
}

function hasChangedPathOverlap(changedPaths: ReadonlySet<string>, relativePath: string): boolean {
  for (const changedPath of changedPaths) {
    if (relativePathsOverlap(changedPath, relativePath)) return true
  }
  return false
}

function overlappingChangedRelativePath(
  changedPaths: ReadonlySet<string>,
  relativePaths: ReadonlyArray<string | undefined>,
): string | null {
  for (const relativePath of relativePaths) {
    if (relativePath === undefined) continue
    if (hasChangedPathOverlap(changedPaths, relativePath)) return relativePath
  }
  return null
}

function relativePathsOverlap(left: string, right: string): boolean {
  return left === right
    || left === ""
    || right === ""
    || left.startsWith(`${right}/`)
    || right.startsWith(`${left}/`)
}

function subtreeSuffix(relativePath: string, root: string): string {
  return relativePath === root ? "" : relativePath.slice(root.length + 1)
}

export function planDriveSyncRemoteChanges(input: {
  readonly binding: DriveSyncBindingEntryV1
  readonly baseline: readonly DriveSyncBaselineEntryV1[]
  readonly changes: readonly DriveChangeDto[]
  readonly localChangedPaths?: ReadonlySet<string>
  readonly shouldIgnoreChange?: (
    change: DriveChangeDto,
    relativePath: string,
    baseline: DriveSyncBaselineEntryV1 | undefined,
  ) => boolean
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
    const relativePath = change.type === "renamed" || change.type === "moved"
      ? remoteRelativePath(input.binding, change)
      : baseline?.relativePath ?? remoteRelativePath(input.binding, change)
    if (relativePath === null) continue
    if (isDriveSyncExcluded(relativePath, input.binding.excludeRules)) continue
    if (input.shouldIgnoreChange?.(change, relativePath, baseline)) continue
    const localPath = path.join(input.binding.localPath, relativePath)
    const conflictRelativePath = overlappingChangedRelativePath(localChangedPaths, [
      relativePath,
      baseline?.relativePath,
    ])

    if (conflictRelativePath !== null) {
      conflicts.push({
        bindingId: input.binding.id,
        driveItemId: change.itemId,
        relativePath: conflictRelativePath,
        localPath: path.join(input.binding.localPath, conflictRelativePath),
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
