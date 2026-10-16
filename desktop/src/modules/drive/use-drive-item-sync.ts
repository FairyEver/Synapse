import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DriveItemDto } from "@synapse/shared"
import type { DriveSyncController } from "./sync"
import { findContainedDriveBindings, getDriveItemSyncRelation, type ContainedDriveBindings, type DriveItemSyncRelation, type DriveSyncPathEntry } from "./drive-item-sync"

export function useDriveItemSync(items: readonly DriveItemDto[], path: readonly DriveSyncPathEntry[], controller: DriveSyncController) {
  const { snapshot, getRemote } = controller
  const [revision, setRevision] = useState(0)
  // 更新时间会改变绑定的显示顺序，但不会改变祖先链。
  const query = JSON.stringify({ items: items.map(({ id, name, parentId, type }) => ({ id, name, parentId, type })), path, bindings: snapshot?.bindings.filter((binding) => binding.status !== "removed").map(({ id, driveItemId, drivePathHint }) => ({ id, driveItemId, drivePathHint })).sort((left, right) => left.id.localeCompare(right.id)), revision })
  const lookupInput = useRef({ items, path, snapshot })
  lookupInput.current = { items, path, snapshot }
  const [contained, setContained] = useState<{ readonly query: string; readonly result: ContainedDriveBindings } | null>(null)
  useEffect(() => {
    const { items, path, snapshot } = lookupInput.current
    if (!snapshot) return
    const abort = new AbortController()
    void findContainedDriveBindings(items, snapshot.bindings, path, getRemote, abort.signal).then((result) => {
      if (!abort.signal.aborted) setContained({ query, result })
    })
    return () => abort.abort()
    // query 包含祖先查询所需的全部字段，operations / health 不触发目录查询。
  }, [query, getRemote])
  const retry = useCallback(async () => {
    await controller.refresh()
    setRevision((current) => current + 1)
  }, [controller.refresh])
  const relations = useMemo(() => {
    const result = new Map<string, DriveItemSyncRelation>()
    for (const item of items) {
      if (!snapshot || controller.error) {
        result.set(item.id, { kind: "unknown", loading: controller.loading && !controller.error })
        continue
      }
      const direct = getDriveItemSyncRelation(item, path, snapshot.bindings)
      if (direct) { result.set(item.id, direct); continue }
      if (item.type !== "folder" || snapshot.bindings.length === 0) continue
      if (contained?.query !== query) { result.set(item.id, { kind: "unknown", loading: true }); continue }
      const ids = contained.result.bindings.get(item.id) ?? []
      if (ids.length) result.set(item.id, { kind: "contains", bindings: snapshot.bindings.filter((binding) => ids.includes(binding.id)), incomplete: contained.result.failed })
      else if (contained.result.failed) result.set(item.id, { kind: "unknown", loading: false })
    }
    return result
  }, [items, path, snapshot, controller.error, controller.loading, contained, query])
  return { relations, retry }
}
