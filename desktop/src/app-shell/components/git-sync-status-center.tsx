import { AlertCircle, Clock, RefreshCw, Settings } from "lucide-react"
import { SyncStatusChip, type SyncStatus } from "@/app-shell/components/sync-status-chip"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import type { SynapseRepositoryConfig } from "@/types/config"
import type { SynapsePendingPushEntry, SynapseRepositorySyncSnapshot } from "@/types/repository"

type GitSyncStatusCenterProps = {
  repository: SynapseRepositoryConfig | null
  snapshot: SynapseRepositorySyncSnapshot | undefined
  status: SyncStatus
  pendingCount: number
  onRetry: () => void
  onOpenSettings: () => void
}

const pendingActionLabels: Record<string, string> = {
  create: "新增",
  update: "修改",
  delete: "删除",
  restore: "恢复",
  initialize: "初始化",
  profile: "身份",
  compaction: "整理",
  gc: "清理",
}
const PENDING_ITEMS_RENDER_LIMIT = 100

function formatPendingAction(entry: SynapsePendingPushEntry): string {
  return pendingActionLabels[entry.action] ?? entry.action
}

function formatRetryTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function getStatusMessage(
  snapshot: SynapseRepositorySyncSnapshot | undefined,
  status: SyncStatus,
  pendingCount: number,
): string {
  if (snapshot?.message) {
    return snapshot.message
  }

  if (status === "pending" && pendingCount > 0) {
    return `${pendingCount} 条变更等待同步`
  }

  if (status === "syncing") {
    return "同步中"
  }

  if (status === "offline") {
    return "离线"
  }

  if (status === "attention") {
    return "需要处理"
  }

  return "已同步"
}

function GitSyncStatusCenter({
  repository,
  snapshot,
  status,
  pendingCount,
  onRetry,
  onOpenSettings,
}: GitSyncStatusCenterProps) {
  const message = getStatusMessage(snapshot, status, pendingCount)
  const canRetry = snapshot?.canRetryNow === true || status === "pending" || status === "offline"
  const pendingItems = snapshot?.pendingItems ?? []
  const visiblePendingItems = pendingItems.slice(0, PENDING_ITEMS_RENDER_LIMIT)
  const hiddenPendingCount = Math.max(0, pendingCount - visiblePendingItems.length)

  return (
    <Popover data-track="git-sync-status-center">
      <PopoverTrigger asChild>
        <SyncStatusChip asButton status={status} pendingCount={pendingCount} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{repository?.name ?? "仓库"}</p>
              <p className="text-sm text-muted-foreground">{message}</p>
            </div>
            {status === "syncing" ? (
              <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : null}
            {status === "attention" ? (
              <AlertCircle className="size-4 shrink-0 text-muted-foreground" />
            ) : null}
          </div>

          {snapshot?.nextRetryAt ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-3.5 shrink-0" />
              下次重试：{formatRetryTime(snapshot.nextRetryAt)}
            </p>
          ) : null}

          {visiblePendingItems.length > 0 ? (
            <>
              <Separator />
              <ScrollArea className="max-h-44">
                <div className="flex flex-col gap-2 pr-2">
                  {visiblePendingItems.map((item) => (
                    <div key={item.id} className="flex flex-col gap-0.5 text-sm">
                      <span className="truncate">{item.title ?? item.targetId}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatPendingAction(item)}
                      </span>
                    </div>
                  ))}
                  {hiddenPendingCount > 0 ? (
                    <div className="text-xs text-muted-foreground">还有 {hiddenPendingCount} 项</div>
                  ) : null}
                </div>
              </ScrollArea>
            </>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onOpenSettings}>
              <Settings data-icon="inline-start" />
              仓库设置
            </Button>
            {canRetry ? (
              <Button size="sm" onClick={onRetry}>
                立即同步
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { GitSyncStatusCenter }
