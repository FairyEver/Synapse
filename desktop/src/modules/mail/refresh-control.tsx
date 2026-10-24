import { useEffect, useRef, useState } from "react"
import { RefreshCw, Pause, CircleAlert, CircleSlash, Clock } from "lucide-react"
import { toast } from "sonner"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { mailError } from "./api"
import type { MailSyncStatus } from "./use-mail-sync"

export function MailRefreshControl({ disabled, loading, syncStatus, onRefresh }: {
  disabled: boolean; loading: boolean; syncStatus: MailSyncStatus | null; onRefresh(): Promise<void>
}) {
  const [refreshing, setRefreshing] = useState(false)
  const pending = useRef(false), active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const refresh = async () => {
    if (disabled || pending.current) return
    pending.current = true; setRefreshing(true)
    try { await onRefresh() }
    catch (cause) { if (active.current) toast.error(mailError(cause)) }
    finally { pending.current = false; if (active.current) setRefreshing(false) }
  }
  const syncing = syncStatus?.state === "running"
  const syncLabel = syncStatus ? [syncStatus.label, syncStatus.progress].filter(Boolean).join("，") : ""
  if (!disabled && (refreshing || loading || syncing)) {
    const label = syncing ? syncLabel : "刷新邮箱中"
    const percentage = syncing ? syncStatus.percentage : null
    return <TooltipProvider><Tooltip><TooltipTrigger asChild>
      <span tabIndex={0} aria-busy="true" className="flex h-8 shrink-0 items-center rounded-sm px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Progress className="w-16" value={percentage} aria-label={label} aria-valuenow={percentage ?? undefined} aria-valuetext={label} />
      </span>
    </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip></TooltipProvider>
  }
  const SyncIcon = syncStatus?.state === "paused" ? Pause : syncStatus?.state === "failed" ? CircleAlert : syncStatus?.state === "cancelled" ? CircleSlash : Clock
  return <TooltipProvider>
    {!disabled && syncStatus && syncStatus.state !== "completed" && <Popover>
      <Tooltip><TooltipTrigger asChild><PopoverTrigger asChild>
        <SystemAppTopBarActionButton aria-label={syncLabel}><SyncIcon /><span className="truncate">{syncStatus.label}</span>{syncStatus.count && <span className="tabular-nums">{syncStatus.count}</span>}</SystemAppTopBarActionButton>
      </PopoverTrigger></TooltipTrigger><TooltipContent>{syncLabel}</TooltipContent></Tooltip>
      <PopoverContent align="end" className="w-64 space-y-2 text-sm"><p>{syncStatus.label}</p>{syncStatus.progress && <p className="tabular-nums text-muted-foreground">{syncStatus.progress}</p>}{syncStatus.error && <p className="text-destructive">{syncStatus.error}</p>}</PopoverContent>
    </Popover>}
    <SystemAppTopBarActionButton iconOnly aria-label="刷新邮箱" disabled={disabled} onClick={() => void refresh()}><RefreshCw /></SystemAppTopBarActionButton>
  </TooltipProvider>
}
