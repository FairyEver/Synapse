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
  readonly limit?: number
}): Promise<void> {
  const limit = input.limit ?? 100
  let cursor = input.binding.remoteCursor
  const seenChangeIds = new Set<string>()

  while (true) {
    const page = await input.accountService.listDriveChanges({
      cursor,
      limit,
      rootItemId: input.binding.driveItemId,
      rootPathHint: input.binding.drivePathHint,
    })
    if (page.resyncRequired) {
      await input.onOperations([{
        bindingId: input.binding.id,
        kind: "resync",
        driveItemId: input.binding.driveItemId,
        relativePath: "",
        localPath: input.binding.localPath,
        remotePathHint: input.binding.drivePathHint,
        remoteItemKind: input.binding.kind,
      }])
      return
    }

    const changes = page.items.filter((change) => {
      if (seenChangeIds.has(change.id)) return false
      seenChangeIds.add(change.id)
      return true
    })
    const plan = planDriveSyncRemoteChanges({
      binding: input.binding,
      baseline: input.baseline,
      changes,
      localChangedPaths: input.localChangedPaths,
    })
    if (plan.operations.length > 0) await input.onOperations(plan.operations)
    if (plan.conflicts.length > 0) await input.onConflicts(plan.conflicts)

    cursor = page.nextCursor
    await input.updateBindingCursor(input.binding.id, cursor)
    if (!page.hasMore) return
  }
}
