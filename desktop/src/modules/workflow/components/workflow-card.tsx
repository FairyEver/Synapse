import { useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import type { WorkflowMeta, WorkflowRunStatus } from "@/types/workflow"
import { Download, GitBranch, Play, Trash2, History, Loader2 } from "lucide-react"
import { RUN_STATE_BADGE } from "../lib/status-display"

export type WorkflowCardRunState = WorkflowRunStatus["status"]

interface WorkflowCardProps { meta: WorkflowMeta; running?: boolean; runState?: WorkflowCardRunState; onOpen: () => void; onRun: () => void; onHistory: () => void; onExport: () => void; onDelete: () => void }

export function WorkflowCard({ meta, running, runState, onOpen, onRun, onHistory, onExport, onDelete }: WorkflowCardProps) {
  const badge = runState ? RUN_STATE_BADGE[runState] : null
  const suppressClickRef = useRef(false)

  return (
    <Card className="cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      tabIndex={0}
      role="button"
      onClick={() => { if (!suppressClickRef.current) onOpen() }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !suppressClickRef.current) { if (e.target !== e.currentTarget) return; e.preventDefault(); onOpen() } }}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          {meta.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{meta.nodeCount} 个节点</span>
          {badge ? <Badge variant={badge.variant} className="text-xs">{badge.label}</Badge> : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={running}
            aria-label="运行工作流"
            data-track="workflow-card-run"
            onClick={(e) => { e.stopPropagation(); onRun() }}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="查看运行历史"
            data-track="workflow-card-history"
            onClick={(e) => { e.stopPropagation(); onHistory() }}
          >
            <History className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="导出工作流"
            data-track="workflow-card-export"
            onClick={(e) => { e.stopPropagation(); onExport() }}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog onOpenChange={(open) => { suppressClickRef.current = open }}>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="删除工作流"
                data-track="workflow-card-delete-open"
                onClick={(e) => e.stopPropagation()}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除工作流</AlertDialogTitle>
                <AlertDialogDescription>确定删除「{meta.name}」？此操作不可恢复。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>删除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}
