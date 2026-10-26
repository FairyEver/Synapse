import { differenceInCalendarDays, format, formatDistanceStrict, formatDistanceToNowStrict } from "date-fns"
import { zhCN } from "date-fns/locale"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type RelativeTimeProps = {
  readonly value?: string | number | Date | null
  readonly fallback?: string
  readonly className?: string
  readonly mode?: "relative" | "absolute" | "calendar"
  readonly now?: Date
  readonly showTooltip?: boolean
}

function parseTimeValue(value: RelativeTimeProps["value"]): Date | null {
  if (value === null || value === undefined || value === "") return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatExactDateTime(date: Date): string {
  return format(date, "yyyy-MM-dd HH:mm:ss")
}

function formatRelativeDateTime(date: Date): string {
  const diffMs = date.getTime() - Date.now()
  if (Math.abs(diffMs) < 60_000) return diffMs >= 0 ? "即将" : "刚刚"
  return formatDistanceToNowStrict(date, {
    addSuffix: true,
    locale: zhCN,
  })
}

function formatCalendarDateTime(date: Date, now: Date): string {
  const days = differenceInCalendarDays(now, date)
  const elapsed = now.getTime() - date.getTime()
  if (days === 0 && elapsed >= 0) {
    if (elapsed < 60_000) return "刚刚"
    return formatDistanceStrict(date, now, {
      addSuffix: true,
      locale: zhCN,
      roundingMethod: "floor",
    })
  }
  if (days === 1) return "昨天"
  if (days === 2) return "前天"
  return format(date, "MM.dd")
}

function RelativeTime({
  value,
  fallback = "-",
  className,
  mode = "relative",
  now = new Date(),
  showTooltip = true,
}: RelativeTimeProps) {
  const date = parseTimeValue(value)
  if (!date) return <span className={className}>{fallback}</span>

  const exact = formatExactDateTime(date)
  const label = mode === "absolute" ? exact : mode === "calendar" ? formatCalendarDateTime(date, now) : formatRelativeDateTime(date)
  const time = (
    <time
      dateTime={date.toISOString()}
      aria-label={exact}
      className={cn("whitespace-nowrap", className)}
    >
      {label}
    </time>
  )

  if (!showTooltip) return time

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {time}
        </TooltipTrigger>
        <TooltipContent>{exact}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { RelativeTime, formatExactDateTime, formatRelativeDateTime }
export type { RelativeTimeProps }
