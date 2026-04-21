import { useMemo } from "react"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useAppConfig } from "@/app-shell/config"
import {
  useActiveRepository,
  useRepositoryList,
  usePendingPushes,
  useRepositoryOperation,
  useRepositoryState,
} from "@/app-shell/use-repository-manager"
import type { SyncStatus } from "@/app-shell/components/sync-status-chip"
import type { SynapseRepositoryOperationKind } from "@/types/repository"

type RunningRepositoryOperation = {
  repositoryUuid: string
  operation: ReturnType<typeof useRepositoryOperation>
}

type AppShellToolbarState = {
  activityLabel: string | null
  pendingPushCount: number
  refreshBusy: boolean
  refreshDisabled: boolean
  refreshTitle: string
  repositorySwitchDisabled: boolean
  repositorySwitchTitle: string
  showRefresh: boolean
  showRepositorySwitch: boolean
  syncStatus: SyncStatus
}

function getToolbarActivityLabel(operation: SynapseRepositoryOperationKind | "switch"): string {
  switch (operation) {
    case "initialize":
      return "正在初始化仓库"
    case "maintenance":
      return "正在整理仓库"
    case "push":
      return "正在同步变更"
    case "switch":
      return "正在切换仓库"
    default:
      return "正在同步仓库"
  }
}

function useAppShellToolbarState({
  hasBlockingModalOpen,
  isOffline,
}: {
  hasBlockingModalOpen: boolean
  isOffline: boolean
}): AppShellToolbarState {
  const { isReady } = useAppConfig()
  const activeRepository = useActiveRepository()
  const repositories = useRepositoryList()
  const { isSwitchingRepository } = useActiveRepositorySwitch()

  const activeRepositoryState = useRepositoryState(activeRepository?.uuid ?? "")
  const activeRepositoryOperation = useRepositoryOperation(activeRepository?.uuid ?? "")
  const activePendingPushState = usePendingPushes(activeRepository?.uuid ?? "")

  return useMemo(() => {
    const runningOperation = activeRepositoryOperation?.isRunning
      ? { repositoryUuid: activeRepository?.uuid ?? "", operation: activeRepositoryOperation }
      : null

    const hasRunningRepositoryOperation = runningOperation !== null
    const isPushOperationRunning =
      activeRepositoryOperation?.operation === "push" && Boolean(activeRepositoryOperation.isRunning)
    const isSyncOperationRunning =
      activeRepositoryOperation?.operation === "sync" && Boolean(activeRepositoryOperation.isRunning)
    const canSyncActiveRepository =
      activeRepositoryState?.status === "ready" && activeRepositoryState.isGitRepository
    const hasToolbarLock =
      hasBlockingModalOpen || hasRunningRepositoryOperation || isSwitchingRepository
    const runningStatusText = runningOperation?.operation?.statusText ?? null
    const activityLabel = isSwitchingRepository
      ? getToolbarActivityLabel("switch")
      : runningOperation
        ? getToolbarActivityLabel(runningOperation.operation?.operation ?? "sync")
        : null

    let refreshTitle = "同步仓库"

    if (isSwitchingRepository) {
      refreshTitle = "正在切换仓库..."
    } else if (
      runningOperation?.repositoryUuid === activeRepository?.uuid &&
      runningOperation?.operation
    ) {
      refreshTitle = runningStatusText ?? "正在同步..."
    } else if (hasRunningRepositoryOperation) {
      refreshTitle = runningStatusText ?? "当前有任务进行中"
    } else if (hasBlockingModalOpen) {
      refreshTitle = "请先关闭当前弹窗"
    } else if (!isReady) {
      refreshTitle = "正在加载设置..."
    } else if (activeRepository === null) {
      refreshTitle = "还没有选择本地目录"
    } else if (!activeRepositoryState) {
      refreshTitle = "正在检查目录状态..."
    } else if (activeRepositoryState.status !== "ready") {
      refreshTitle = "当前目录不存在，无法同步"
    }

    let repositorySwitchTitle = "切换仓库"

    if (isSwitchingRepository) {
      repositorySwitchTitle = "正在切换仓库..."
    } else if (hasRunningRepositoryOperation) {
      repositorySwitchTitle = runningStatusText ?? "当前有任务进行中"
    } else if (hasBlockingModalOpen) {
      repositorySwitchTitle = "请先关闭当前弹窗"
    } else if (!isReady) {
      repositorySwitchTitle = "正在加载设置..."
    } else if (repositories.length < 2) {
      repositorySwitchTitle = "至少需要两个仓库"
    }

    const syncStatus: SyncStatus =
      isPushOperationRunning || isSyncOperationRunning
        ? "syncing"
        : isOffline
          ? "offline"
          : (activePendingPushState?.count ?? 0) > 0
            ? "pending"
            : "synced"

    return {
      activityLabel,
      pendingPushCount: activePendingPushState?.count ?? 0,
      refreshBusy: isSyncOperationRunning,
      refreshDisabled: !isReady || !canSyncActiveRepository || hasToolbarLock,
      refreshTitle,
      repositorySwitchDisabled: !isReady || repositories.length < 2 || hasToolbarLock,
      repositorySwitchTitle,
      showRefresh: Boolean(canSyncActiveRepository) && !isPushOperationRunning,
      showRepositorySwitch: repositories.length > 1,
      syncStatus,
    }
  }, [
    activeRepository,
    activeRepositoryOperation,
    activeRepositoryState,
    activePendingPushState,
    hasBlockingModalOpen,
    isOffline,
    isReady,
    isSwitchingRepository,
    repositories.length,
  ])
}

export type { AppShellToolbarState }
export { useAppShellToolbarState }
