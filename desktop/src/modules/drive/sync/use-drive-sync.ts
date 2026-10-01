import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type {
  DriveItemDto,
  DriveSyncBindingDto,
  DriveSyncBindingPreviewDto,
  DriveSyncConflictResolutionInput,
  DriveSyncCreateSafeBindingInput,
  DriveSyncInitialDirection,
  DriveSyncSnapshotDto,
  DriveSyncUpdateExcludeRulesInput,
} from "@synapse/shared"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { startTrackedOperation } from "@/lib/ui-tracking"

/**
 * 渲染层访问云盘同步的唯一入口。
 * 组件不直接调用 window.synapse.driveSync.*，快照与订阅也由这里统一持有。
 */

export interface DriveSyncPreviewInput {
  readonly authority?: "local" | "remote"
  readonly replaceBindingId?: string
  readonly targetParentId?: string | null
  readonly driveItemId: string
  readonly driveItemName: string
  readonly kind: "file" | "folder"
  readonly drivePathHint?: string | null
  readonly localPath: string
  readonly remoteExists: boolean
  readonly directionHint?: DriveSyncInitialDirection | null
  readonly excludeRules?: readonly string[]
  readonly useDefaultExcludes?: boolean
  readonly importGitignore?: boolean
}

export interface DriveSyncChooseLocalPathInput {
  readonly kind: "file" | "folder"
  readonly mode?: DriveSyncInitialDirection
  readonly defaultName?: string
}

export interface DriveSyncController {
  readonly listRemote: (parentId: string | null, offset?: number) => Promise<{ items: readonly DriveItemDto[]; nextOffset: number | null }>
  readonly getRemote: (itemId: string) => Promise<DriveItemDto>
  readonly snapshot: DriveSyncSnapshotDto | null
  readonly error: string | null
  readonly loading: boolean
  /** 离线或未登录，界面只读。 */
  readonly readOnly: boolean
  readonly offline: boolean
  readonly refresh: () => Promise<DriveSyncSnapshotDto>
  readonly preview: (input: DriveSyncPreviewInput) => Promise<DriveSyncBindingPreviewDto>
  readonly chooseLocalPath: (input: DriveSyncChooseLocalPathInput) => Promise<string | null>
  readonly createBinding: (input: DriveSyncCreateSafeBindingInput) => Promise<DriveSyncBindingDto>
  readonly pause: (bindingId: string) => Promise<void>
  readonly resume: (bindingId: string) => Promise<void>
  readonly remove: (bindingId: string) => Promise<void>
  readonly rescan: (bindingId: string) => Promise<void>
  readonly updateExcludes: (input: DriveSyncUpdateExcludeRulesInput) => Promise<void>
  readonly pollRemoteChanges: (bindingId?: string) => Promise<void>
  readonly resolveConflict: (input: DriveSyncConflictResolutionInput) => Promise<void>
  readonly isPending: (bindingId: string) => boolean
  /** 在系统文件管理器里定位到本地路径。只读可用。 */
  readonly revealLocalPath: (localPath: string) => Promise<void>
  /**
   * 执行一条需要防重入、需要失败提示、需要结束后刷新快照的同步动作。
   * 返回是否成功，调用方据此决定要不要收起相关界面。
   */
  readonly runBindingAction: (
    eventKey: string,
    bindingId: string,
    run: () => Promise<unknown>,
    success: string,
    /** 动作成功但绑定落到需要处理的状态时，是否用绑定自己的原因提示用户。 */
    checkBindingState?: boolean,
  ) => Promise<boolean>
}

export function useDriveSync(): DriveSyncController {
  const [snapshot, setSnapshot] = useState<DriveSyncSnapshotDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const pendingIdsRef = useRef<Set<string>>(new Set())

  const refresh = useCallback(async (): Promise<DriveSyncSnapshotDto> => {
    const next = await requireSynapseBridge().driveSync.getSnapshot()
    setSnapshot(next)
    setError(null)
    setLoading(false)
    return next
  }, [])

  useEffect(() => {
    let disposed = false
    void requireSynapseBridge().driveSync.getSnapshot()
      .then((next) => {
        if (disposed) return
        setSnapshot(next)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : "同步状态加载失败")
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    const unsubscribe = requireSynapseBridge().driveSync.onChanged((next) => {
      if (disposed) return
      setSnapshot(next)
      setError(null)
      setLoading(false)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const setPending = useCallback((bindingId: string, pending: boolean) => {
    const next = new Set(pendingIdsRef.current)
    if (pending) next.add(bindingId)
    else next.delete(bindingId)
    pendingIdsRef.current = next
    setPendingIds(next)
  }, [])

  const isPending = useCallback((bindingId: string) => pendingIds.has(bindingId), [pendingIds])

  // 快照还没加载时不能下只读结论，否则会先摆出一句「未登录」并把新建入口锁掉。
  const readOnly = snapshot?.health.readOnly ?? false
  const offline = snapshot?.health.connectivity === "offline"

  const runBindingAction = useCallback<DriveSyncController["runBindingAction"]>(
    async (eventKey, bindingId, run, success, checkBindingState = true) => {
      const finishTracking = startTrackedOperation({ component: "drive", eventKey })
      if (readOnly) {
        toast(offline ? "联网后可管理同步。" : "登录后可管理同步。")
        finishTracking("cancelled")
        return false
      }
      if (pendingIdsRef.current.has(bindingId)) {
        toast("同步操作正在执行，请稍后再试。")
        finishTracking("cancelled")
        return false
      }
      setPending(bindingId, true)
      try {
        await run()
        const next = await refresh()
        // 处理冲突或暂停这类动作不该因为「还有别的冲突没处理」被判成失败。
        const actionError = checkBindingState ? bindingActionError(next, bindingId) : null
        if (actionError) {
          toast(actionError)
          finishTracking("failure")
          return false
        }
        toast(success)
        finishTracking("success")
        return true
      } catch (cause) {
        await refresh().catch(() => undefined)
        toast(cause instanceof Error ? cause.message : "操作失败")
        finishTracking("failure")
        return false
      } finally {
        setPending(bindingId, false)
      }
    },
    [offline, readOnly, refresh, setPending],
  )

  const bridge = requireSynapseBridge().driveSync

  return {
    listRemote: async (parentId, offset = 0) => {
      const result = await requireSynapseBridge().drive.item.list({ parentId, offset, limit: 100 })
      return Array.isArray(result) ? { items: result, nextOffset: null } : { items: result.items, nextOffset: result.page.nextOffset }
    },
    getRemote: (itemId) => requireSynapseBridge().drive.item.get({ itemId }),
    snapshot,
    error,
    loading,
    readOnly,
    offline,
    refresh,
    preview: (input) => {
      const finishTracking = startTrackedOperation({ component: "drive", eventKey: "drive.sync.binding.preview" })
      return bridge.previewBinding(input)
        .then((result) => { finishTracking("success"); return result })
        .catch((cause: unknown) => { finishTracking("failure"); throw cause })
    },
    chooseLocalPath: (input) => {
      const finishTracking = startTrackedOperation({ component: "drive", eventKey: "drive.sync.local-path.choose" })
      return bridge.chooseLocalPath(input)
        .then((result) => { finishTracking(result ? "success" : "cancelled"); return result })
        .catch((cause: unknown) => { finishTracking("failure"); throw cause })
    },
    createBinding: (input) => bridge.createSafeBinding(input),
    pause: (bindingId) => bridge.pauseBinding({ id: bindingId }).then(() => undefined),
    resume: (bindingId) => bridge.resumeBinding({ id: bindingId }).then(() => undefined),
    remove: (bindingId) => bridge.removeBinding({ id: bindingId }),
    rescan: (bindingId) => bridge.rescanBinding({ id: bindingId }),
    updateExcludes: (input) => bridge.updateExcludeRules(input).then(() => undefined),
    pollRemoteChanges: (bindingId) => bridge.pollRemoteChanges(bindingId ? { id: bindingId } : {}),
    resolveConflict: (input) => bridge.resolveConflict(input),
    isPending,
    revealLocalPath: async (localPath) => {
      await Promise.resolve(requireSynapseBridge().shell.showItemInFolder(localPath))
    },
    runBindingAction,
  }
}

/** 动作本身成功了，但绑定落到了需要用户处理的状态时，把这个原因交给用户。 */
function bindingActionError(snapshot: DriveSyncSnapshotDto, bindingId: string): string | null {
  const binding = snapshot.bindings.find((candidate) => candidate.id === bindingId)
  if (binding?.status === "error") return binding.lastError?.trim() || "同步失败，请查看同步记录"
  if (binding?.status === "conflict" || snapshot.conflicts.some((conflict) => conflict.bindingId === bindingId)) {
    return "同步产生冲突，请处理冲突"
  }
  return null
}

export function driveSyncRemotePath(binding: DriveSyncBindingDto): string {
  return binding.drivePathHint?.trim() || binding.driveItemName
}
