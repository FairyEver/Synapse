import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Square, RotateCcw, PenLine, LayoutDashboard, List, Loader2, Copy } from "lucide-react"
import type { WorkflowDefinition, WorkflowRunStatus } from "@/types/workflow"
import { RUN_STATE_BADGE } from "../lib/status-display"

type ViewMode = "dag" | "timeline"

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
  onCopyRunReport: () => Promise<void>
}

export function RunnerToolbar({ definition, runState, runError, viewMode, rerunning, cancelling, onViewModeChange, onCancel, onRerun, onOpenEditor, onCopyRunReport }: RunnerToolbarProps) {
  const badge = RUN_STATE_BADGE[runState]
  const isRunning = runState === "running"
  const isTerminal = runState === "completed" || runState === "failed" || runState === "cancelled"

  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 bg-background">
      <span className="text-sm font-medium truncate max-w-48" title={definition.name}>{definition.name}</span>
      {badge && <Badge variant={badge.variant} className="text-xs">{badge.label}</Badge>}
      {runError && (
        <span className="text-xs text-destructive truncate max-w-64" title={runError ?? undefined}>{runError}</span>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <div className="flex items-center border rounded-md">
          <Button
            size="sm"
            variant={viewMode === "dag" ? "secondary" : "ghost"}
            className="rounded-r-none h-7"
            data-track="workflow-runner-view-dag"
            onClick={() => onViewModeChange("dag")}
          >
            <LayoutDashboard className="h-3.5 w-3.5 mr-1" />DAG
          </Button>
          <Button
            size="sm"
            variant={viewMode === "timeline" ? "secondary" : "ghost"}
            className="rounded-l-none h-7"
            data-track="workflow-runner-view-timeline"
            onClick={() => onViewModeChange("timeline")}
          >
            <List className="h-3.5 w-3.5 mr-1" />时间线
          </Button>
        </div>
        <Button size="sm" variant="outline" data-track="workflow-runner-copy-run-report" onClick={() => void onCopyRunReport()}>
          <Copy className="h-3.5 w-3.5 mr-1" />复制
        </Button>
        {isRunning && (
          <Button size="sm" variant="destructive" disabled={cancelling} data-track="workflow-runner-stop" onClick={() => void onCancel()}>
            {cancelling ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Square className="h-3.5 w-3.5 mr-1" />}停止
          </Button>
        )}
        {isTerminal && (
          <Button size="sm" variant="outline" disabled={rerunning} data-track="workflow-runner-rerun" onClick={() => void onRerun()}>
            {rerunning ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}重新运行
          </Button>
        )}
        <Button size="sm" variant="ghost" data-track="workflow-runner-open-editor" onClick={onOpenEditor}>
          <PenLine className="h-3.5 w-3.5 mr-1" />编辑
        </Button>
      </div>
    </div>
  )
}
