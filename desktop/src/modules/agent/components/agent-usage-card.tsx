import { Check, Clipboard } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatTokenUsageValue } from "@/lib/token-usage"
import { cn } from "@/lib/utils"
import {
  buildAgentUsageCardData,
  formatAgentUsageCopyText,
  type AgentUsageRowKey,
} from "../utils/agent-usage-card"

interface AgentUsageCardProps {
  readonly totalUsage?: Record<string, unknown>
  readonly turnUsage?: Record<string, unknown>
  readonly timestamp?: string
  readonly className?: string
}

const rowColorClass: Record<AgentUsageRowKey, string> = {
  input: "bg-slate-900",
  output: "bg-red-600",
  cacheRead: "bg-emerald-600",
  cacheWrite: "bg-amber-500",
  reasoning: "bg-purple-600",
}

const tooltipDelayMs = 1000

function AgentUsageCard({
  totalUsage,
  turnUsage,
  timestamp,
  className,
}: AgentUsageCardProps) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const data = useMemo(() => buildAgentUsageCardData({
    totalUsage,
    turnUsage,
    timestamp,
  }), [timestamp, totalUsage, turnUsage])

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  if (!data) return null

  const barRows = data.rows.filter((row) => row.total > 0)
  const totalTokenValue = barRows.reduce((sum, row) => sum + row.total, 0)
  const copyText = formatAgentUsageCopyText(data)

  const handleCopy = () => {
    void navigator.clipboard.writeText(copyText).then(() => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      setCopied(true)
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = undefined
        setCopied(false)
      }, 1200)
    }).catch(() => {
      toast("复制失败")
    })
  }

  return (
    <TooltipProvider delayDuration={tooltipDelayMs}>
      <section
        aria-label="用量统计"
        className={cn(
          "@container/usage-card mt-2 w-full min-w-0 max-w-full overflow-hidden rounded-lg bg-muted/60 text-foreground",
          className,
        )}
      >
      <div className="flex items-center justify-between gap-2 px-2.5 pt-1.5 pb-1">
        <span className="min-w-0 truncate text-sm font-semibold whitespace-nowrap">用量统计</span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="复制用量统计" onClick={handleCopy}>
          {copied ? <Check /> : <Clipboard />}
        </Button>
      </div>
      <div className="min-w-0 px-2.5 py-2">
        <div className="flex h-2 overflow-hidden rounded-full bg-background" aria-label="Token 分类占比">
          {barRows.map((row, index) => (
            <span
              key={row.key}
              data-usage-segment
              className={cn("min-w-0", index === 0 ? undefined : "border-l-2 border-card", rowColorClass[row.key])}
              style={{ flexBasis: `${Math.max(1, Math.round((row.total / Math.max(1, totalTokenValue)) * 100))}%` }}
            />
          ))}
        </div>
        <div
          data-usage-stats-grid
          className={cn(
            "mt-2 grid min-w-0 @max-[499px]/usage-card:grid-cols-2 @max-[499px]/usage-card:gap-y-3",
            data.rows.length >= 5 ? "grid-cols-5" : "grid-cols-4",
          )}
        >
          {data.rows.map((row, index) => (
            <div
              key={row.key}
              data-usage-stat-item
              className={cn(
                "min-w-0 px-2 @max-[499px]/usage-card:odd:border-l-0 @max-[499px]/usage-card:odd:pl-0",
                index === 0 ? "pl-0" : "border-l border-border",
                index === data.rows.length - 1 ? "pr-0" : undefined,
              )}
            >
              <div className="flex items-center gap-1.5 overflow-hidden text-xs font-medium text-muted-foreground whitespace-nowrap">
                <span className={cn("size-1.5 rounded-full", rowColorClass[row.key])} />
                <span className="truncate">{row.label}</span>
              </div>
              <div className="mt-1 flex min-w-0 items-baseline leading-none">
                <UsageValueTooltip label={row.totalTooltip} className="truncate text-base font-semibold tabular-nums">
                  {formatTokenUsageValue(row.total)}
                </UsageValueTooltip>
              </div>
              <div className="mt-1 flex justify-between gap-1 text-xs text-muted-foreground">
                <UsageValueTooltip label={row.deltaTooltip} className="min-w-0 truncate tabular-nums">
                  {row.delta === undefined ? "--" : `+${formatTokenUsageValue(row.delta)}`}
                </UsageValueTooltip>
                <span className="shrink-0 tabular-nums">{row.percent === undefined ? "--" : `${row.percent}%`}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      </section>
    </TooltipProvider>
  )
}

interface UsageValueTooltipProps {
  readonly label: string
  readonly className?: string
  readonly children: ReactNode
}

function UsageValueTooltip({ label, className, children }: UsageValueTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-label={label} className={className}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export { AgentUsageCard }
export type { AgentUsageCardProps }
