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
  let cursor = input.binding.remoteCursor
  const seenChangeIds = new Set<string>()

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
      baseline: input.baseline,
      changes,
      localChangedPaths: input.localChangedPaths,
      shouldIgnoreChange: input.shouldIgnoreChange,
    })
    if (plan.operations.length > 0) await input.onOperations(plan.operations)
    if (plan.conflicts.length > 0) await input.onConflicts(plan.conflicts)
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

function driveItemNameFromPathHint(pathHint: string, fallback: string): string {
  return pathHint.split(/[\\/]+/u).filter(Boolean).at(-1) ?? fallback
}
