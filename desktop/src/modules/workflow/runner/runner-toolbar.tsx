import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Square, RotateCcw, PenLine, LayoutDashboard, List, Loader2 } from "lucide-react"
import type { WorkflowDefinition, WorkflowRunStatus } from "@/types/workflow"

type ViewMode = "dag" | "timeline"

const RUN_STATE_BADGE: Record<WorkflowRunStatus["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  running: { label: "执行中", variant: "default" },
  completed: { label: "已完成", variant: "secondary" },
  failed: { label: "失败", variant: "destructive" },
  cancelled: { label: "已取消", variant: "outline" },
}

interface RunnerToolbarProps {
  definition: WorkflowDefinition
  runState: WorkflowRunStatus["status"]
  runError?: string | null
  viewMode: ViewMode
  rerunning?: boolean
  cancelling?: boolean
  onViewModeChange: (mode: ViewMode) => void
  onCancel: () => Promise<void>
  onRerun: () => Promise<void>
  onOpenEditor: () => void
}

export function RunnerToolbar({ definition, runState, runError, viewMode, rerunning, cancelling, onViewModeChange, onCancel, onRerun, onOpenEditor }: RunnerToolbarProps) {
  const badge = RUN_STATE_BADGE[runState]
  const isRunning = runState === "running"
  const isTerminal = runState === "completed" || runState === "failed" || runState === "cancelled"

  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 bg-background">
      <span className="text-sm font-medium truncate max-w-48">{definition.name}</span>
      {badge && <Badge variant={badge.variant} className="text-xs">{badge.label}</Badge>}
      {isTerminal && runError && (
        <span className="text-xs text-destructive truncate max-w-64">{runError}</span>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <div className="flex items-center border rounded-md">
          <Button
            size="sm"
            variant={viewMode === "dag" ? "secondary" : "ghost"}
            className="rounded-r-none h-7"
            onClick={() => onViewModeChange("dag")}
          >
            <LayoutDashboard className="h-3.5 w-3.5 mr-1" />DAG
          </Button>
          <Button
            size="sm"
            variant={viewMode === "timeline" ? "secondary" : "ghost"}
            className="rounded-l-none h-7"
            onClick={() => onViewModeChange("timeline")}
          >
            <List className="h-3.5 w-3.5 mr-1" />时间线
          </Button>
        </div>
        {isRunning && (
          <Button size="sm" variant="destructive" disabled={cancelling} onClick={() => void onCancel()}>
            {cancelling ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Square className="h-3.5 w-3.5 mr-1" />}停止
          </Button>
        )}
        {isTerminal && (
          <Button size="sm" variant="outline" disabled={rerunning} onClick={() => void onRerun()}>
            {rerunning ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}重新运行
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onOpenEditor}>
          <PenLine className="h-3.5 w-3.5 mr-1" />编辑
        </Button>
      </div>
    </div>
  )
}
