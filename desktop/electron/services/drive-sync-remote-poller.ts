import path from "node:path"
import type { DriveChangeListInput, DriveChangeListPageDto } from "@synapse/shared" with { "resolution-mode": "import" }
import type { DriveSyncBaselineEntryV1, DriveSyncBindingEntryV1 } from "../runtime/data-repo"
import { planDriveSyncRemoteChanges, type DriveSyncPlannedConflict, type DriveSyncPlannedOperation } from "./drive-sync-planner"

export interface DriveSyncRemotePollerAccountService {
  readonly listDriveChanges: (input: DriveChangeListInput) => Promise<DriveChangeListPageDto>
}

export async function pollDriveSyncRemoteChanges(input: {
  readonly binding: DriveSyncBindingEntryV1
  readonly baseline: readonly DriveSyncBaselineEntryV1[]
  readonly accountService: DriveSyncRemotePollerAccountService
  readonly onOperations: (operations: readonly DriveSyncPlannedOperation[]) => Promise<void>
  readonly onConflicts: (conflicts: readonly DriveSyncPlannedConflict[]) => Promise<void>
  readonly updateBindingCursor: (bindingId: string, cursor: string | null) => Promise<void> | void
  readonly localChangedPaths?: ReadonlySet<string>
  readonly shouldIgnoreChange?: Parameters<typeof planDriveSyncRemoteChanges>[0]["shouldIgnoreChange"]
  readonly limit?: number
}): Promise<void> {
  const limit = input.limit ?? 100
  let binding = input.binding
  let baseline = input.baseline
  let cursor = input.binding.remoteCursor
  const seenChangeIds = new Set<string>()
  const recursiveFolderDownloads = new Set<string>()

  while (true) {
    const page = await input.accountService.listDriveChanges({
      cursor,
      limit,
      rootItemId: binding.driveItemId,
      rootPathHint: binding.drivePathHint,
    })
    if (page.resyncRequired) {
      await input.onOperations([{
        bindingId: binding.id,
        kind: "resync",
        driveItemId: binding.driveItemId,
        relativePath: "",
        localPath: binding.localPath,
        remotePathHint: binding.drivePathHint,
        remoteItemKind: binding.kind,
      }])
      return
    }

    const changes = page.items.filter((change) => {
      if (seenChangeIds.has(change.id)) return false
      seenChangeIds.add(change.id)
      return true
    })
    const plan = planDriveSyncRemoteChanges({
      binding,
      baseline,
      changes,
      localChangedPaths: input.localChangedPaths,
      shouldIgnoreChange: (change, relativePath, entry) => {
        if (isDescendantOfAnyRoot(relativePath, recursiveFolderDownloads)) return true
        return input.shouldIgnoreChange?.(change, relativePath, entry) ?? false
      },
    })
    if (plan.operations.length > 0) await input.onOperations(plan.operations)
    if (plan.conflicts.length > 0) await input.onConflicts(plan.conflicts)
    rememberRecursiveFolderDownloads(recursiveFolderDownloads, changes, plan.operations)
    baseline = baselineAfterOperations(baseline, plan.operations)
    binding = bindingAfterRootMove(binding, plan.operations)

    cursor = page.nextCursor
    await input.updateBindingCursor(binding.id, cursor)
    if (!page.hasMore) return
  }
}

function bindingAfterRootMove(
  binding: DriveSyncBindingEntryV1,
  operations: readonly DriveSyncPlannedOperation[],
): DriveSyncBindingEntryV1 {
  const rootMove = operations.find((operation) =>
    operation.kind === "move_local"
    && operation.driveItemId === binding.driveItemId
    && operation.remotePathHint !== null
    && operation.remotePathHint !== binding.drivePathHint,
  )
  if (!rootMove?.remotePathHint) return binding
  return {
    ...binding,
    driveItemName: driveItemNameFromPathHint(rootMove.remotePathHint, binding.driveItemName),
    drivePathHint: rootMove.remotePathHint,
  }
}

function baselineAfterOperations(
  baseline: readonly DriveSyncBaselineEntryV1[],
  operations: readonly DriveSyncPlannedOperation[],
): readonly DriveSyncBaselineEntryV1[] {
  let nextBaseline = baseline
  for (const operation of operations) {
    if (operation.kind === "move_local") {
      nextBaseline = baselineAfterMoveOperation(nextBaseline, operation)
    }
  }
  return nextBaseline
}

function rememberRecursiveFolderDownloads(
  roots: Set<string>,
  changes: DriveChangeListPageDto["items"],
  operations: readonly DriveSyncPlannedOperation[],
): void {
  const recursiveFolderIds = new Set(
    changes
      .filter((change) => (change.type === "created" || change.type === "restored") && change.itemKind === "folder")
      .map((change) => change.itemId),
  )
  for (const operation of operations) {
    if (operation.kind !== "download" || operation.remoteItemKind !== "folder" || !operation.driveItemId) continue
    if (!recursiveFolderIds.has(operation.driveItemId)) continue
    roots.add(operation.relativePath)
  }
}

function baselineAfterMoveOperation(
  baseline: readonly DriveSyncBaselineEntryV1[],
  operation: DriveSyncPlannedOperation,
): readonly DriveSyncBaselineEntryV1[] {
  if (!operation.driveItemId) return baseline
  const moved = baseline.find((entry) => entry.remoteItemId === operation.driveItemId && entry.deletedAt === null)
  if (!moved || moved.relativePath === operation.relativePath) return baseline
  return baseline.map((entry) => {
    if (entry.deletedAt !== null || !isPathInSubtree(entry.relativePath, moved.relativePath)) return entry
    const suffix = subtreeSuffix(entry.relativePath, moved.relativePath)
    return {
      ...entry,
      relativePath: suffix ? path.posix.join(operation.relativePath, suffix) : operation.relativePath,
    }
  })
}

function isPathInSubtree(relativePath: string, root: string): boolean {
  return relativePath === root || relativePath.startsWith(`${root}/`)
}

function subtreeSuffix(relativePath: string, root: string): string {
  return relativePath === root ? "" : relativePath.slice(root.length + 1)
}

function isDescendantOfAnyRoot(relativePath: string, roots: ReadonlySet<string>): boolean {
  for (const root of roots) {
    if (relativePath !== root && (root === "" || isPathInSubtree(relativePath, root))) return true
  }
  return false
}

function driveItemNameFromPathHint(pathHint: string, fallback: string): string {
  return pathHint.split(/[\\/]+/u).filter(Boolean).at(-1) ?? fallback
}
