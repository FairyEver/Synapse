import { useMemo } from "react"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { useAppConfig } from "@/app-shell/config"
import { useRepositoryManager } from "@/app-shell/repository"
import type { SynapseRepositoryOperationKind } from "@/types/repository"

type RepositoryOperations = ReturnType<typeof useRepositoryManager>["operations"]

type RunningRepositoryOperation = {
  repositoryUuid: string
  operation: RepositoryOperations[string]
}

type AppShellToolbarState = {
  activityLabel: string | null
  isPushBusy: boolean
  pendingPushCount: number
  pushDisabled: boolean
  refreshBusy: boolean
  refreshDisabled: boolean
  refreshTitle: string
  repositorySwitchDisabled: boolean
  repositorySwitchTitle: string
  showRefresh: boolean
  showRepositorySwitch: boolean
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

function findRunningRepositoryOperation(
  operations: RepositoryOperations,
  activeRepositoryUuid: string | null,
): RunningRepositoryOperation | null {
  if (activeRepositoryUuid) {
    const activeRepositoryOperation = operations[activeRepositoryUuid]

    if (activeRepositoryOperation?.isRunning) {
      return {
        repositoryUuid: activeRepositoryUuid,
        operation: activeRepositoryOperation,
      }
    }
  }

  const runningEntry = Object.entries(operations).find(([, operation]) => operation.isRunning)

  if (!runningEntry) {
    return null
  }

  return {
    repositoryUuid: runningEntry[0],
    operation: runningEntry[1],
  }
}

function useAppShellToolbarState({
  hasBlockingModalOpen,
}: {
  hasBlockingModalOpen: boolean
}): AppShellToolbarState {
  const { activeRepository, config, isReady } = useAppConfig()
  const { isSwitchingRepository } = useActiveRepositorySwitch()
  const { operations, pendingPushes, states } = useRepositoryManager()

  return useMemo(() => {
    const activeRepositoryOperation = activeRepository ? operations[activeRepository.uuid] ?? null : null
    const activeRepositoryState = activeRepository ? states[activeRepository.uuid] ?? null : null
    const activePendingPushState = activeRepository ? pendingPushes[activeRepository.uuid] ?? null : null
    const runningRepositoryOperation = findRunningRepositoryOperation(
      operations,
      activeRepository?.uuid ?? null,
    )
    const hasRunningRepositoryOperation = runningRepositoryOperation !== null
    const isPushOperationRunning =
      activeRepositoryOperation?.operation === "push" && Boolean(activeRepositoryOperation.isRunning)
    const isSyncOperationRunning =
      activeRepositoryOperation?.operation === "sync" && Boolean(activeRepositoryOperation.isRunning)
    const canSyncActiveRepository =
      activeRepositoryState?.status === "ready" && activeRepositoryState.isGitRepository
    const hasToolbarLock =
      hasBlockingModalOpen || hasRunningRepositoryOperation || isSwitchingRepository
    const runningStatusText = runningRepositoryOperation?.operation.statusText ?? null
    const activityLabel = isSwitchingRepository
      ? getToolbarActivityLabel("switch")
      : runningRepositoryOperation
        ? getToolbarActivityLabel(runningRepositoryOperation.operation.operation ?? "sync")
        : null

    let refreshTitle = "同步仓库"

    if (isSwitchingRepository) {
      refreshTitle = "正在切换仓库..."
    } else if (runningRepositoryOperation?.repositoryUuid === activeRepository?.uuid) {
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
    } else if (config.repositories.length < 2) {
      repositorySwitchTitle = "至少需要两个仓库"
    }

    return {
      activityLabel,
      isPushBusy: isPushOperationRunning,
      pendingPushCount: activePendingPushState?.count ?? 0,
      pushDisabled: !isReady || !canSyncActiveRepository || hasToolbarLock,
      refreshBusy: isSyncOperationRunning,
      refreshDisabled: !isReady || !canSyncActiveRepository || hasToolbarLock,
      refreshTitle,
      repositorySwitchDisabled: !isReady || config.repositories.length < 2 || hasToolbarLock,
      repositorySwitchTitle,
      showRefresh: Boolean(canSyncActiveRepository) && !isPushOperationRunning,
      showRepositorySwitch: config.repositories.length > 1,
    }
  }, [
    activeRepository,
    config.repositories.length,
    hasBlockingModalOpen,
    isReady,
    isSwitchingRepository,
    operations,
    pendingPushes,
    states,
  ])
}

export type { AppShellToolbarState }
export { useAppShellToolbarState }
