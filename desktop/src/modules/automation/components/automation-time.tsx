import { RelativeTime } from "@/components/relative-time"
import type { AutomationItem } from "@/types/automation"
import {
  formatAutomationNextRun,
  formatAutomationStatus,
} from "../utils"

function AutomationNextRunTime({
  item,
  className,
}: {
  readonly item: Pick<AutomationItem, "activeRun" | "conditions" | "enabled" | "nextRunAt" | "schemaVersion" | "trigger">
  readonly className?: string
}) {
  const label = formatAutomationNextRun(item)
  if (!item.nextRunAt || label === "停用中" || label === "未知" || label === "本次完成后计算") return <span className={className}>{label}</span>
  return <RelativeTime value={item.nextRunAt} fallback={label} className={className} />
}

function AutomationLastRunTime({
  item,
  className,
}: {
  readonly item: Pick<AutomationItem, "lastRunAt" | "lastStatus">
  readonly className?: string
}) {
  return (
    <span className={className}>
      <RelativeTime value={item.lastRunAt} fallback="—" />
      {item.lastStatus ? ` · ${formatAutomationStatus(item.lastStatus)}` : null}
    </span>
  )
}

export { AutomationLastRunTime, AutomationNextRunTime }
