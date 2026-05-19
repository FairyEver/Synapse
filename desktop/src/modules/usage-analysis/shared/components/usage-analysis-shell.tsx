import type { ReactNode } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  onRefresh: () => void
  children: ReactNode
}

const VIEWS: { readonly id: UsageViewId; readonly label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "time", label: "时间" },
  { id: "models", label: "模型" },
  { id: "projects", label: "项目" },
  { id: "tools", label: "工具" },
]

export function UsageAnalysisShell(props: UsageAnalysisShellProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
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
            <RangePicker value={props.range} onChange={props.onRangeChange} />
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
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {props.children}
      </div>
    </div>
  )
}
