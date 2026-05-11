import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import type { WorkflowMeta } from "@/types/workflow"
import { GitBranch, Play, Trash2 } from "lucide-react"

export type WorkflowCardRunState = "running" | "completed" | "failed" | "cancelled"

const RUN_STATE_BADGE: Record<WorkflowCardRunState, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  running: { label: "执行中", variant: "default" },
  completed: { label: "已完成", variant: "secondary" },
  failed: { label: "失败", variant: "destructive" },
  cancelled: { label: "已取消", variant: "outline" },
}

interface WorkflowCardProps { meta: WorkflowMeta; runState?: WorkflowCardRunState; onOpen: () => void; onRun: () => void; onDelete: () => void }

export function WorkflowCard({ meta, runState, onOpen, onRun, onDelete }: WorkflowCardProps) {
  const badge = runState ? RUN_STATE_BADGE[runState] : null

  return (
    <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onDoubleClick={onOpen}>
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
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onRun() }}>
            <Play className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" onClick={(e) => e.stopPropagation()}>
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
