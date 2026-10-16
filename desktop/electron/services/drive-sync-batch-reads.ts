import type { DriveChangeBatchRequest, DriveChangeBatchResponse, DriveChangeBatchResult, DriveChangeListInput, DriveChangeListPageDto, DriveItemBatchResponse, DriveItemBatchResult } from "@synapse/shared" with { "resolution-mode": "import" }
import type { DriveSyncBindingEntryV1 } from "../runtime/data-repo"
import { DRIVE_CHANGE_BATCH_PAGE_LIMIT } from "@synapse/shared/drive-sync-constants"
import { driveBatchReadError, throwDriveBatchError } from "./drive-batch-client"

export interface DriveSyncBatchAccount {
  getDriveItemsBatch(ids: readonly string[]): Promise<DriveItemBatchResponse>
  listDriveChangesBatch(requests: readonly DriveChangeBatchRequest[]): Promise<DriveChangeBatchResponse>
}
export interface DriveSyncBatchReads {
  readonly signature: string
  readonly root: DriveItemBatchResult
  readonly changes: DriveChangeBatchResult
  readonly nextPage: (input: DriveChangeListInput) => Promise<DriveChangeListPageDto>
}
export function driveSyncReadSignature(binding: DriveSyncBindingEntryV1): string {
  return JSON.stringify([binding.ownerUserId, binding.driveItemId, binding.remoteCursor, binding.drivePathHint])
}

export async function prepareDriveSyncBatchReads(bindings: readonly DriveSyncBindingEntryV1[], account: DriveSyncBatchAccount): Promise<Map<string, DriveSyncBatchReads>> {
  const requests = bindings.map((binding) => ({ requestId: binding.id, rootItemId: binding.driveItemId, cursor: binding.remoteCursor, rootPathHint: binding.drivePathHint, limit: DRIVE_CHANGE_BATCH_PAGE_LIMIT }))
  const [items, changes] = await Promise.all([
    account.getDriveItemsBatch([...new Set(bindings.map((binding) => binding.driveItemId))])
      .catch((error: unknown) => ({ results: bindings.map((binding) => ({ itemId: binding.driveItemId, data: null, error: driveBatchReadError(error) })) })),
    account.listDriveChangesBatch(requests)
      .catch((error: unknown) => ({ results: requests.map((request) => ({ requestId: request.requestId, data: null, error: driveBatchReadError(error) })) })),
  ])
  const byItem = new Map(items.results.map((result) => [result.itemId, result]))
  const byRequest = new Map(changes.results.map((result) => [result.requestId, result]))
  const nextPage = createChangePageLoader(account)
  const missing = { status: 502, code: "INCOMPLETE_BATCH", message: "云盘批量响应不完整。" }
  return new Map(bindings.map((binding) => [binding.id, {
    signature: driveSyncReadSignature(binding), nextPage,
    root: byItem.get(binding.driveItemId) ?? { itemId: binding.driveItemId, data: null, error: missing },
    changes: byRequest.get(binding.id) ?? { requestId: binding.id, data: null, error: missing },
  }]))
}

function createChangePageLoader(account: DriveSyncBatchAccount) {
  let sequence = 0
  let queued: Array<{ request: DriveChangeBatchRequest; resolve: (page: DriveChangeListPageDto) => void; reject: (error: unknown) => void }> = []
  return (input: DriveChangeListInput): Promise<DriveChangeListPageDto> => new Promise((resolve, reject) => {
    const request = { ...input, rootItemId: input.rootItemId!, requestId: `page-${++sequence}` }
    queued.push({ request, resolve, reject })
    if (queued.length > 1) return
    setTimeout(() => {
      const batch = queued
      queued = []
      void account.listDriveChangesBatch(batch.map((entry) => entry.request)).then(({ results }) => {
        const byId = new Map(results.map((result) => [result.requestId, result]))
        for (const entry of batch) {
          const result = byId.get(entry.request.requestId)
          try {
            if (!result) throwDriveBatchError({ status: 502, code: "INCOMPLETE_BATCH", message: "云盘变更响应不完整。" })
            if (result.error) throwDriveBatchError(result.error)
            if (!result.data) throwDriveBatchError({ status: 502, code: "INCOMPLETE_BATCH", message: "云盘变更响应不完整。" })
            entry.resolve(result.data)
          } catch (error) { entry.reject(error) }
        }
      }, (error: unknown) => { for (const entry of batch) entry.reject(error) })
    }, 0)
  })
}
