import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { WorkflowRunSnapshot } from "@/types/workflow"

const STATUS_LABEL: Record<string, string> = { completed: "已完成", failed: "失败", cancelled: "已取消" }
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "secondary", failed: "destructive", cancelled: "outline",
}

interface RunHistoryDialogProps {
  open: boolean
  workflowId: string
  onClose: () => void
}

export function RunHistoryDialog({ open, workflowId, onClose }: RunHistoryDialogProps) {
  const [snapshots, setSnapshots] = useState<WorkflowRunSnapshot[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !workflowId) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const data = await window.synapse?.workflow.runHistory(workflowId)
      if (cancelled) return
      setSnapshots(data ?? [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [open, workflowId])

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
  }

  const handleOpenRunner = (runId: string) => {
    void window.synapse?.workflow.openRunner(workflowId, runId)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>运行历史</DialogTitle></DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground py-4">加载中…</p>
        ) : snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">暂无运行记录。</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-auto">
            {snapshots.map((s) => (
              <div
                key={s.runId}
                className="flex items-center gap-3 p-2 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => handleOpenRunner(s.runId)}
              >
                <Badge variant={STATUS_VARIANT[s.status] ?? "outline"} className="text-xs shrink-0">
                  {STATUS_LABEL[s.status] ?? s.status}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground truncate">{formatTime(s.startedAt)}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {Object.keys(s.nodeResults).length} 个节点
                </span>
                <Button size="sm" variant="ghost" className="shrink-0" onClick={(e) => { e.stopPropagation(); handleOpenRunner(s.runId) }}>
                  查看
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
