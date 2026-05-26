import type { ReactNode } from "react"
import { BadgeDollarSign, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RangePicker } from "./range-picker"
import type { UsageRangePreset, UsageViewId } from "../types"

interface UsageAnalysisShellProps {
  title: string
  view: UsageViewId
  range: UsageRangePreset
  refreshing: boolean
  onViewChange: (view: UsageViewId) => void
  onRangeChange: (range: UsageRangePreset) => void
  onPricingRulesClick?: () => void
  onRefresh: () => void
  children: ReactNode
}

const VIEWS: { readonly id: UsageViewId; readonly label: string }[] = [
  { id: "today", label: "今日" },
  { id: "overview", label: "概览" },
  { id: "time", label: "时间" },
  { id: "models", label: "模型" },
  { id: "projects", label: "项目" },
  { id: "tools", label: "工具" },
]

export function UsageAnalysisShell(props: UsageAnalysisShellProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-surface">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-2 px-2 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 text-sm font-medium">{props.title}</h2>
          <Tabs value={props.view} onValueChange={(next) => props.onViewChange(next as UsageViewId)}>
            <TabsList>
              {VIEWS.map((view) => (
                <TabsTrigger key={view.id} value={view.id}>{view.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center gap-2">
          {props.view === "today" ? null : (
            <RangePicker value={props.range} onChange={props.onRangeChange} />
          )}
          {props.onPricingRulesClick ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={props.onPricingRulesClick}
            >
              <BadgeDollarSign data-icon="inline-start" />
              价格规则
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={props.refreshing}
            aria-busy={props.refreshing}
            onClick={props.onRefresh}
          >
            <RefreshCw data-icon="inline-start" className={props.refreshing ? "animate-spin" : undefined} />
            {props.refreshing ? "刷新中" : "刷新"}
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 min-w-0 max-w-full flex-1" viewportClassName="min-w-0 max-w-full">
        <div className="min-h-full min-w-full w-0 max-w-full overflow-x-hidden px-2 pb-2 pt-0">
          {props.children}
        </div>
      </ScrollArea>
    </div>
  )
}
