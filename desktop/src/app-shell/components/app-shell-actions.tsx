import { ArrowLeftRight, LoaderCircle, RefreshCw } from "lucide-react"
import { GitSyncStatusCenter } from "@/app-shell/components/git-sync-status-center"
import type { SyncStatus } from "@/app-shell/components/sync-status-chip"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { SynapseRepositoryConfig } from "@/types/config"
import type { SynapseRepositorySyncSnapshot } from "@/types/repository"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type AppShellActionsProps = {
  activeRepository?: SynapseRepositoryConfig | null
  activityLabel?: string | null
  pendingPushCount?: number
  refreshBusy?: boolean
  refreshDisabled?: boolean
  repositorySwitchDisabled?: boolean
  repositorySwitchTitle?: string
  showRefresh?: boolean
  showRepositorySwitch?: boolean
  syncSnapshot?: SynapseRepositorySyncSnapshot
  syncStatus?: SyncStatus
  onOpenRepositorySettings?: () => void
  onRefresh?: () => void
  onRepositorySwitch?: () => void
  onSyncChipClick?: () => void
  refreshTitle?: string
}

function AppShellActions({
  activeRepository = null,
  activityLabel = null,
  pendingPushCount = 0,
  refreshBusy = false,
  refreshDisabled = false,
  repositorySwitchDisabled = false,
  repositorySwitchTitle = "切换仓库",
  showRefresh = true,
  showRepositorySwitch = false,
  syncSnapshot,
  syncStatus = "synced",
  onOpenRepositorySettings,
  onRefresh,
  onRepositorySwitch,
  onSyncChipClick,
  refreshTitle = "同步仓库",
}: AppShellActionsProps) {
  const hasActions = showRefresh || showRepositorySwitch

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1.5">
        {activityLabel ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground select-none [&_svg]:size-3.5 [&_svg]:shrink-0">
            <LoaderCircle className="animate-spin" />
            {activityLabel}
          </span>
        ) : (
          <GitSyncStatusCenter
            repository={activeRepository}
            snapshot={syncSnapshot}
            status={syncStatus}
            pendingCount={pendingPushCount}
            onRetry={onSyncChipClick ?? (() => {})}
            onOpenSettings={onOpenRepositorySettings ?? (() => {})}
          />
        )}
      </div>

      {hasActions ? (
        <>
          <Separator orientation="vertical" className="mx-1 h-4 data-[orientation=vertical]:self-center" />
          <TooltipProvider>
            <div className="flex items-center gap-0.5">
              {showRefresh ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={refreshDisabled}
                        onClick={onRefresh}
                      >
                        <RefreshCw className={refreshBusy ? "animate-spin" : undefined} />
                        <span className="sr-only">{refreshTitle}</span>
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{refreshTitle}</TooltipContent>
                </Tooltip>
              ) : null}

              {showRepositorySwitch ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={repositorySwitchDisabled}
                        onClick={onRepositorySwitch}
                      >
                        <ArrowLeftRight data-icon="inline-start" />
                        切换仓库
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {repositorySwitchDisabled ? (
                    <TooltipContent>{repositorySwitchTitle}</TooltipContent>
                  ) : null}
                </Tooltip>
              ) : null}
            </div>
          </TooltipProvider>
        </>
      ) : null}
    </div>
  )
}

export { AppShellActions }
