import type { DataNamespace, DriveSyncBaselineEntryV1 } from "../runtime/data-repo"

export type DriveSyncBaselineStore = ReturnType<typeof createDriveSyncBaselineStore>

export function createDriveSyncBaselineStore(deps: {
  readonly baseline: DataNamespace<DriveSyncBaselineEntryV1>
  readonly now?: () => Date
}) {
  const timestamp = () => (deps.now ?? (() => new Date()))().toISOString()

  async function listByBinding(bindingId: string): Promise<readonly DriveSyncBaselineEntryV1[]> {
    return (await deps.baseline.list({ bindingId }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  }

  async function upsert(
    input: Omit<DriveSyncBaselineEntryV1, "id" | "schemaVersion" | "lastSyncedAt"> & {
      readonly lastSyncedAt?: string
    },
  ): Promise<DriveSyncBaselineEntryV1> {
    const entry: DriveSyncBaselineEntryV1 = {
      id: baselineId(input.bindingId, input.relativePath),
      schemaVersion: 1,
      bindingId: input.bindingId,
      relativePath: input.relativePath,
      kind: input.kind,
      remoteItemId: input.remoteItemId,
      remoteVersionId: input.remoteVersionId,
      remoteEtag: input.remoteEtag,
      localSize: input.localSize,
      localMtimeMs: input.localMtimeMs,
      localHash: input.localHash,
      lastSyncedAt: input.lastSyncedAt ?? timestamp(),
      deletedAt: input.deletedAt,
    }
    await deps.baseline.upsert(entry)
    return entry
  }

  async function markDeleted(bindingId: string, relativePath: string): Promise<DriveSyncBaselineEntryV1> {
    const existing = await deps.baseline.get(baselineId(bindingId, relativePath))
    if (!existing) throw new Error("同步基线不存在。")
    const entry: DriveSyncBaselineEntryV1 = {
      ...existing,
      lastSyncedAt: timestamp(),
      deletedAt: timestamp(),
    }
    await deps.baseline.upsert(entry)
    return entry
  }

  async function removeBinding(bindingId: string): Promise<void> {
    const entries = await listByBinding(bindingId)
    await Promise.all(entries.map((entry) => deps.baseline.remove(entry.id)))
  }

  return {
    listByBinding,
    upsert,
    markDeleted,
    removeBinding,
  }
}

function baselineId(bindingId: string, relativePath: string): string {
  return `${bindingId}:${relativePath}`
}
