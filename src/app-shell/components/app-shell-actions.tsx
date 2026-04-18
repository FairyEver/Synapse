import { LoaderCircle, RefreshCw, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"

type AppShellActionsProps = {
  isPushBusy?: boolean
  pendingPushCount?: number
  pushDisabled?: boolean
  refreshBusy?: boolean
  refreshDisabled?: boolean
  onPush?: () => void
  onRefresh?: () => void
  pushTitle?: string
  refreshTitle?: string
}

function AppShellActions({
  isPushBusy = false,
  pendingPushCount = 0,
  pushDisabled = false,
  refreshBusy = false,
  refreshDisabled = false,
  onPush,
  onRefresh,
  pushTitle = "同步待推送内容",
  refreshTitle = "同步仓库",
}: AppShellActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {pendingPushCount > 0 ? (
        <Button
          variant="secondary"
          size="icon"
          disabled={pushDisabled || isPushBusy}
          onClick={onPush}
          title={pushTitle}
          className="relative"
        >
          {isPushBusy ? <LoaderCircle className="animate-spin" /> : <Upload />}
          {pendingPushCount > 0 ? (
            <span className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full border border-background bg-foreground px-1 text-[10px] leading-4 text-background">
              {pendingPushCount > 9 ? "9+" : pendingPushCount}
            </span>
          ) : null}
          <span className="sr-only">{pushTitle}</span>
        </Button>
      ) : null}

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
    </div>
  )
}

export { AppShellActions }
