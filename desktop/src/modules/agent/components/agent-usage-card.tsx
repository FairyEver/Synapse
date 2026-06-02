import { Check, Clipboard, Info } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
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
  readonly turnCostCny?: number
  readonly totalCostCny?: number
  readonly estimatedCost?: boolean
  readonly timestamp?: string
  readonly className?: string
}

const rowColorClass: Record<AgentUsageRowKey, string> = {
  input: "bg-chart-1",
  output: "bg-chart-3",
  cacheRead: "bg-chart-5",
  cacheWrite: "bg-chart-4",
  reasoning: "bg-chart-2",
}

const recentBarHeights = [38, 45, 54, 61, 69] as const

function AgentUsageCard({
  totalUsage,
  turnUsage,
  turnCostCny,
  totalCostCny,
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
    estimatedCost,
    timestamp,
  }), [estimatedCost, timestamp, totalCostCny, totalUsage, turnCostCny, turnUsage])

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
    <section
      aria-label="用量统计"
      className={cn(
        "mt-2 w-[76ch] min-w-[760px] overflow-hidden rounded-lg border border-border bg-card text-card-foreground whitespace-nowrap",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="font-semibold">用量统计</span>
          {data.turnCostLabel ? (
            <span className="text-muted-foreground">
              本轮 <strong className="font-semibold text-foreground">{data.turnCostLabel}</strong>
            </span>
          ) : null}
          {data.totalCostLabel ? (
            <span className="text-muted-foreground">
              累计 <strong className="font-semibold text-foreground">{data.totalCostLabel}</strong>
            </span>
          ) : null}
          {data.estimatedCost ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    估算 <Info className="size-3.5" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>价格按当前模型估算</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {timestamp ? <time>{formatTime(timestamp)}</time> : null}
          <Button type="button" variant="ghost" size="icon-xs" aria-label="复制用量统计" onClick={handleCopy}>
            {copied ? <Check /> : <Clipboard />}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_8.25rem]">
        <div className="border-r border-border px-2.5 py-2">
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            {data.rows.map((row) => (
              <span
                key={row.key}
                className={cn("min-w-0", rowColorClass[row.key])}
                style={{ flexBasis: `${Math.max(1, Math.round((row.total / Math.max(1, totalTokenValue)) * 100))}%` }}
              />
            ))}
          </div>
          <div className="mt-2 grid grid-cols-[5.75rem_5.4rem_7.25rem_5.5rem_4.875rem]">
            {data.rows.map((row, index) => (
              <div
                key={row.key}
                className={cn(
                  "min-w-0 px-2",
                  index === 0 ? "pl-0" : "border-l border-border",
                  index === data.rows.length - 1 ? "pr-0" : undefined,
                )}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span className={cn("size-1.5 rounded-full", rowColorClass[row.key])} />
                  <span>{row.label}</span>
                </div>
                <div className="mt-1 truncate text-lg font-semibold leading-none">{formatTokenUsageValue(row.total)}</div>
                <div className="mt-1 flex justify-between gap-1 text-xs text-muted-foreground">
                  <span>{row.delta === undefined ? "--" : `+${formatTokenUsageValue(row.delta)}`}</span>
                  <span>{row.percent === undefined ? "--" : `${row.percent}%`}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col justify-center px-2.5 py-2">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">最近 5 轮</div>
          <div className="grid h-20 grid-cols-5 items-end gap-1.5 border-b border-border px-0.5">
            {recentBarHeights.map((height, index) => (
              <div
                key={index}
                className="flex min-w-2 flex-col-reverse overflow-hidden rounded-t-sm bg-muted"
                style={{ height }}
              >
                <span className="h-[30%] bg-chart-1" />
                <span className="h-[15%] bg-chart-3" />
                <span className="h-[42%] bg-chart-5" />
                <span className="h-[8%] bg-chart-4" />
                <span className="h-[5%] bg-chart-2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function formatTime(timestamp: string): string | undefined {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`
}

export { AgentUsageCard }
export type { AgentUsageCardProps }
