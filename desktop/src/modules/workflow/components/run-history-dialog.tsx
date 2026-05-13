import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { WorkflowRunSnapshot } from "@/types/workflow"

const STATUS_LABEL: Record<string, string> = { completed: "已完成", failed: "失败", cancelled: "已取消" }
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "secondary", failed: "destructive", cancelled: "outline",
}

function getFirstError(snapshot: WorkflowRunSnapshot): string | null {
  if (snapshot.status !== "failed") return null
  for (const r of Object.values(snapshot.nodeResults)) {
    if (r.error) return r.error
  }
  return null
}

interface RunHistoryDialogProps {
  open: boolean
  workflowId: string
  onClose: () => void
}

export function RunHistoryDialog({ open, workflowId, onClose }: RunHistoryDialogProps) {
  const [snapshots, setSnapshots] = useState<WorkflowRunSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!workflowId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const data = await window.synapse?.workflow.runHistory(workflowId)
        if (cancelled) return
        if (!data) {
          // IPC bridge unavailable — treat as error, not empty
          setError("无法连接到主进程，请稍后重试")
          return
        }
        setSnapshots(data)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "加载失败，请重试")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [workflowId])

  useEffect(() => {
    if (!open || !workflowId) return
    return load()
  }, [open, workflowId, load])

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
  }

  const formatDuration = (startedAt: number, endedAt?: number) => {
    if (!endedAt) return null
    const ms = endedAt - startedAt
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
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
        ) : error ? (
          <div className="py-4 space-y-3">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
            <Button size="sm" variant="outline" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />重试
            </Button>
          </div>
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
                  {getFirstError(s) && (
                    <p className="text-xs text-destructive truncate mt-0.5">{getFirstError(s)}</p>
                  )}
                </div>
                {formatDuration(s.startedAt, s.endedAt) && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDuration(s.startedAt, s.endedAt)}
                  </span>
                )}
                <span className="text-xs text-muted-foreground shrink-0">
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
