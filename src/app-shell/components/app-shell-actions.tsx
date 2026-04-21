import { ArrowLeftRight, RefreshCw } from "lucide-react"
import { SyncStatusChip, type SyncStatus } from "@/app-shell/components/sync-status-chip"
import { Button } from "@/components/ui/button"

type AppShellActionsProps = {
  activityLabel?: string | null
  pendingPushCount?: number
  refreshBusy?: boolean
  refreshDisabled?: boolean
  repositorySwitchDisabled?: boolean
  repositorySwitchTitle?: string
  showRefresh?: boolean
  showRepositorySwitch?: boolean
  syncStatus?: SyncStatus
  onRefresh?: () => void
  onRepositorySwitch?: () => void
  onSyncChipClick?: () => void
  refreshTitle?: string
}

function AppShellActions({
  activityLabel = null,
  pendingPushCount = 0,
  refreshBusy = false,
  refreshDisabled = false,
  repositorySwitchDisabled = false,
  repositorySwitchTitle = "切换仓库",
  showRefresh = true,
  showRepositorySwitch = false,
  syncStatus = "synced",
  onRefresh,
  onRepositorySwitch,
  onSyncChipClick,
  refreshTitle = "同步仓库",
}: AppShellActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <SyncStatusChip
        status={syncStatus}
        pendingCount={pendingPushCount}
        onClick={onSyncChipClick}
      />

      {activityLabel ? (
        <span className="text-sm text-muted-foreground">{activityLabel}</span>
      ) : null}

      {showRefresh ? (
        <Button
          variant="secondary"
          size="icon"
          disabled={refreshDisabled}
          onClick={onRefresh}
          title={refreshTitle}
        >
          <RefreshCw className={refreshBusy ? "animate-spin" : undefined} />
          <span className="sr-only">{refreshTitle}</span>
        </Button>
      ) : null}

      {showRepositorySwitch ? (
        <Button
          variant="secondary"
          disabled={repositorySwitchDisabled}
          onClick={onRepositorySwitch}
          title={repositorySwitchTitle}
        >
          <ArrowLeftRight data-icon="inline-start" />
          切换仓库
        </Button>
      ) : null}
    </div>
  )
}

export { AppShellActions }
