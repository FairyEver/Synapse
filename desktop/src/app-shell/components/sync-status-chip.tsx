import type { ComponentProps } from "react"
import { ArrowUp, Check, CircleAlert, LoaderCircle, WifiOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SyncStatus = "synced" | "pending" | "syncing" | "offline" | "attention"

type SyncStatusChipProps = Omit<
  ComponentProps<typeof Button>,
  "children" | "onClick" | "size" | "variant"
> & {
  asButton?: boolean
  status: SyncStatus
  pendingCount?: number
  onClick?: ComponentProps<typeof Button>["onClick"]
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
  attention: {
    icon: CircleAlert,
    label: () => "需要处理",
  },
}

function SyncStatusChip({
  asButton = false,
  status,
  pendingCount = 0,
  onClick,
  type = "button",
  ...buttonProps
}: SyncStatusChipProps) {
  const config = statusConfig[status]
  const Icon = config.icon
  const label = config.label(pendingCount)
  const renderAsButton = asButton || status === "pending" || onClick !== undefined

  if (renderAsButton) {
    return (
      <Button
        {...buttonProps}
        variant="ghost"
        size="xs"
        type={type}
        onClick={onClick}
      >
        <Icon
          className={status === "syncing" ? "animate-spin" : undefined}
          data-icon="inline-start"
        />
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
