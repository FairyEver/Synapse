import { ArrowUp, Check, LoaderCircle, WifiOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
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
  variant: "secondary" | "outline" | "destructive"
}> = {
  synced: {
    icon: Check,
    label: () => "已同步",
    variant: "secondary",
  },
  pending: {
    icon: ArrowUp,
    label: (count) => `${count > 9 ? "9+" : count} 条待同步`,
    variant: "outline",
  },
  syncing: {
    icon: LoaderCircle,
    label: () => "同步中",
    variant: "secondary",
  },
  offline: {
    icon: WifiOff,
    label: () => "离线",
    variant: "destructive",
  },
}

function SyncStatusChip({ status, pendingCount = 0, onClick }: SyncStatusChipProps) {
  const config = statusConfig[status]
  const Icon = config.icon
  const isClickable = status === "pending"

  return (
    <Badge
      variant={config.variant}
      role={isClickable ? "button" : "status"}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? onClick : undefined}
      onKeyDown={isClickable ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick?.()
        }
      } : undefined}
      className={cn(
        "h-7 gap-1.5 px-2.5 text-xs select-none",
        isClickable && "cursor-pointer",
      )}
    >
      <Icon
        data-icon="inline-start"
        className={cn(
          status === "syncing" && "animate-spin",
        )}
      />
      {config.label(pendingCount)}
    </Badge>
  )
}

export type { SyncStatus }
export { SyncStatusChip }
