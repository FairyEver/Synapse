import { Check, Clipboard, Info } from "lucide-react"
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
  type AgentUsageCostBreakdownCny,
  type AgentUsageRowKey,
} from "../utils/agent-usage-card"

interface AgentUsageCardProps {
  readonly totalUsage?: Record<string, unknown>
  readonly turnUsage?: Record<string, unknown>
  readonly turnCostCny?: number
  readonly totalCostCny?: number
  readonly turnCostBreakdownCny?: AgentUsageCostBreakdownCny
  readonly totalCostBreakdownCny?: AgentUsageCostBreakdownCny
  readonly estimatedCost?: boolean
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
  turnCostCny,
  totalCostCny,
  turnCostBreakdownCny,
  totalCostBreakdownCny,
  estimatedCost,
  timestamp,
  className,
}: AgentUsageCardProps) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const data = useMemo(() => buildAgentUsageCardData({
    totalUsage,
    turnUsage,
    turnCostCny,
    totalCostCny,
    turnCostBreakdownCny,
    totalCostBreakdownCny,
    estimatedCost,
    timestamp,
  }), [estimatedCost, timestamp, totalCostBreakdownCny, totalCostCny, totalUsage, turnCostBreakdownCny, turnCostCny, turnUsage])

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  if (!data) return null

  const totalTokenValue = data.rows.reduce((sum, row) => sum + row.total, 0)
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
          "mt-2 w-full min-w-0 max-w-full overflow-hidden rounded-lg bg-muted/60 text-foreground",
          className,
        )}
      >
      <div className="flex items-center justify-between gap-2 px-2.5 pt-1.5 pb-1">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden text-sm whitespace-nowrap">
          <span className="shrink-0 font-semibold">用量统计</span>
          {data.turnCostLabel ? (
            <span className="shrink-0 text-muted-foreground">
              本轮 <strong className="font-semibold text-foreground">{data.turnCostLabel}</strong>
            </span>
          ) : null}
          {data.totalCostLabel ? (
            <span className="min-w-0 truncate text-muted-foreground">
              累计 <strong className="font-semibold text-foreground">{data.totalCostLabel}</strong>
            </span>
          ) : null}
          {data.estimatedCost ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  估算 <Info className="size-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent>价格按当前模型估算</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
          {timestamp ? <time>{formatTime(timestamp)}</time> : null}
          <Button type="button" variant="ghost" size="icon-xs" aria-label="复制用量统计" onClick={handleCopy}>
            {copied ? <Check /> : <Clipboard />}
          </Button>
        </div>
      </div>
      <div className="min-w-0 px-2.5 py-2">
        <div className="flex h-2 overflow-hidden rounded-full bg-background" aria-label="Token 分类占比">
          {data.rows.map((row, index) => (
            <span
              key={row.key}
              data-usage-segment
              className={cn("min-w-0", index === 0 ? undefined : "border-l-2 border-card", rowColorClass[row.key])}
              style={{ flexBasis: `${Math.max(1, Math.round((row.total / Math.max(1, totalTokenValue)) * 100))}%` }}
            />
          ))}
        </div>
        <div className={cn("mt-2 grid min-w-0", data.rows.length >= 5 ? "grid-cols-5" : "grid-cols-4")}>
          {data.rows.map((row, index) => (
            <div
              key={row.key}
              className={cn(
                "min-w-0 px-2",
                index === 0 ? "pl-0" : "border-l border-border",
                index === data.rows.length - 1 ? "pr-0" : undefined,
              )}
            >
              <div className="flex items-center gap-1.5 overflow-hidden text-xs font-medium text-muted-foreground whitespace-nowrap">
                <span className={cn("size-1.5 rounded-full", rowColorClass[row.key])} />
                <span className="truncate">{row.label}</span>
              </div>
              <div className="mt-1 flex min-w-0 items-baseline gap-1 truncate leading-none">
                <UsageValueTooltip label={row.totalTooltip} className="truncate text-base font-semibold tabular-nums">
                  {formatTokenUsageValue(row.total)}
                </UsageValueTooltip>
                {row.totalCostLabel ? (
                  <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                    {row.totalCostLabel}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex justify-between gap-1 text-xs text-muted-foreground">
                <span className="flex min-w-0 items-baseline truncate">
                  <UsageValueTooltip label={row.deltaTooltip} className="min-w-0 truncate">
                    {row.delta === undefined ? "--" : `+${formatTokenUsageValue(row.delta)}`}
                  </UsageValueTooltip>
                  {row.delta !== undefined && row.deltaCostLabel ? (
                    <span className="min-w-0 truncate">（{row.deltaCostLabel}）</span>
                  ) : null}
                </span>
                <span>{row.percent === undefined ? "--" : `${row.percent}%`}</span>
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

function formatTime(timestamp: string): string | undefined {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`
}

export { AgentUsageCard }
export type { AgentUsageCardProps }
