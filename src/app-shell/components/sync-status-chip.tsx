import { ArrowUp, Check, LoaderCircle, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SyncStatus = "synced" | "pending" | "syncing" | "offline"

type SyncStatusChipProps = {
  status: SyncStatus
  pendingCount?: number
  onClick?: () => void
}

const statusConfig: Record<SyncStatus, {
  icon: typeof Check
  label: (count: number) => string
}> = {
  synced: {
    icon: Check,
    label: () => "已同步",
  },
  pending: {
    icon: ArrowUp,
    label: (count) => `${count > 9 ? "9+" : count} 条待同步`,
  },
  syncing: {
    icon: LoaderCircle,
    label: () => "同步中",
  },
  offline: {
    icon: WifiOff,
    label: () => "离线",
  },
}

function SyncStatusChip({ status, pendingCount = 0, onClick }: SyncStatusChipProps) {
  const config = statusConfig[status]
  const Icon = config.icon
  const label = config.label(pendingCount)
  const isClickable = status === "pending"

  if (isClickable) {
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={onClick}
      >
        <Icon data-icon="inline-start" />
        {label}
      </Button>
    )
  }

  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground select-none",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
      )}
    >
      <Icon className={status === "syncing" ? "animate-spin" : undefined} />
      {label}
    </span>
  )
}

export type { SyncStatus }
export { SyncStatusChip }
