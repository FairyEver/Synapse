import { useCallback, useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AlertCircle, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFrame, DialogFrameBody, DialogFrameHeader } from "@/components/ui/dialog"
import { createRendererLogger } from "@/app-shell/logging"
import { track } from "@/lib/ui-tracking"
import { errorDiagnostic } from "../lib/error-utils"
import type { WorkflowEvent, WorkflowRunListItem } from "@/types/workflow"

const logger = createRendererLogger("workflow.run-history")
const STATUS_LABEL: Record<string, string> = { running: "执行中", completed: "已完成", failed: "失败", cancelled: "已取消" }
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default", completed: "secondary", failed: "destructive", cancelled: "outline",
}

function getFirstError(snapshot: WorkflowRunListItem): string | null {
  if (snapshot.status !== "failed") return null
  const nodeError = Object.values(snapshot.nodeResults)
    .filter((r) => r.error)
    .sort((a, b) => (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER))[0]?.error ?? null
  return nodeError ?? snapshot.error ?? null
}

function isWorkflowTerminalEvent(event: WorkflowEvent, workflowId: string): boolean {
  return (
    (event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled") &&
    event.workflowId === workflowId
  )
}

interface RunHistoryDialogProps {
  open: boolean
  workflowId: string
  onClose: () => void
}

export function RunHistoryDialog({ open, workflowId, onClose }: RunHistoryDialogProps) {
  const [snapshots, setSnapshots] = useState<WorkflowRunListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadGenRef = useRef(0)
  const load = useCallback(() => {
    if (!workflowId) return
    const gen = ++loadGenRef.current
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const data = await window.synapse?.workflow.runHistory(workflowId)
        if (gen !== loadGenRef.current) return
        if (!data) {
          // IPC bridge unavailable — treat as error, not empty
          setError("无法连接到主进程，请稍后重试")
          return
        }
        setSnapshots(data)
      } catch (err) {
        if (gen !== loadGenRef.current) return
        logger.warn("Workflow run history load failed.", {
          boundary: "renderer.workflow.run-history.load",
          workflowId,
          ...errorDiagnostic(err),
        })
        setError("加载失败，请重试")
      } finally {
        if (gen === loadGenRef.current) setLoading(false)
      }
    })()
  }, [workflowId])

  useEffect(() => {
    if (!open || !workflowId) return
    load()
    return () => { loadGenRef.current++ }
  }, [open, workflowId, load])

  useEffect(() => {
    if (!open || !workflowId) return
    const unsubscribe = window.synapse?.workflow.onEvent?.((event) => {
      if (isWorkflowTerminalEvent(event, workflowId)) load()
    })
    return () => { unsubscribe?.() }
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

  const handleOpenRunner = async (runId: string) => {
    track({
      component: "workflow",
      name: "workflow-run-history-open-runner",
      action: "click",
      metadata: {
        boundary: "renderer.workflow.run-history.open-runner",
        workflowId,
        runId,
      },
    })
    try {
      await window.synapse?.workflow.openRunner(workflowId, runId)
      onClose()
    } catch (err) {
      logger.warn("Workflow runner open failed from run history.", {
        boundary: "renderer.workflow.run-history.open-runner",
        workflowId,
        runId,
        ...errorDiagnostic(err),
      })
      toast.error("打开运行窗口失败，请重试")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent, runId: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      void handleOpenRunner(runId)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
        <DialogFrame className="max-h-[calc(100vh-4rem)]">
          <DialogFrameHeader title="运行历史">
            <DialogDescription className="sr-only">查看该工作流的历史运行记录。</DialogDescription>
          </DialogFrameHeader>
          <DialogFrameBody className="px-5 py-4">
            {loading ? (
              <p className="text-sm text-muted-foreground py-4 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />加载中…</p>
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
              <ScrollArea className="min-h-0 max-h-[60vh]">
                <div className="flex flex-col gap-2 pr-3">
                  {snapshots.map((s) => {
                    const firstError = getFirstError(s)
                    const duration = formatDuration(s.startedAt, s.endedAt)
                    return (
                      <div
                        key={s.runId}
                        className="flex min-w-0 items-center gap-2 p-2 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        tabIndex={0}
                        role="button"
                        onClick={() => handleOpenRunner(s.runId)}
                        onKeyDown={(e) => handleKeyDown(e, s.runId)}
                      >
                        <Badge variant={STATUS_VARIANT[s.status] ?? "outline"} className="text-xs shrink-0">
                          {STATUS_LABEL[s.status] ?? s.status}
                        </Badge>
                        {s.definitionMigration && (
                          <Badge variant="outline" className="text-xs shrink-0">结构不可读</Badge>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground truncate">{formatTime(s.startedAt)}</p>
                          {firstError && (
                            <p className="text-xs text-destructive truncate mt-0.5" title={firstError}>{firstError}</p>
                          )}
                        </div>
                        {duration && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {duration}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground shrink-0">
                          {Object.keys(s.nodeResults).length} 个节点
                        </span>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </DialogFrameBody>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}
