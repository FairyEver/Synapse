import { useEffect, useState } from "react"
import { Square } from "lucide-react"

import { ActionResultView } from "@/action-runtime/action-result-view"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ScheduledTask, ScheduledTaskRun } from "@/types/task-scheduler"
import { formatRunStatus, formatTaskDate } from "../utils"
import { listRuns } from "../hooks/use-task-scheduler"

type TaskRunsDialogProps = {
  open: boolean
  task: ScheduledTask | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onStopRun: (runId: string) => Promise<void>
}

function TaskRunsDialog({
  open,
  task,
  busy,
  onOpenChange,
  onStopRun,
}: TaskRunsDialogProps) {
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !task) {
      return
    }

    let cancelled = false
    setLoading(true)
    listRuns(task.id)
      .then((nextRuns) => {
        if (!cancelled) {
          setRuns(nextRuns)
          setError(null)
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "读取历史失败")
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, task])

  async function handleStop(runId: string) {
    await onStopRun(runId)
    if (task) {
      setRuns(await listRuns(task.id))
    }
  }

  return (
    <Dialog data-track="task-scheduler-runs-dialog" open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{task?.name ?? "运行历史"}</DialogTitle>
          <DialogDescription>最近 100 次运行。</DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0">
          <div className="flex max-h-[calc(100vh-14rem)] flex-col gap-3 pr-3">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {loading ? <p className="text-sm text-muted-foreground">加载中</p> : null}
            {!loading && runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无运行记录</p>
            ) : null}

            {runs.map((run) => (
              <div key={run.id} className="grid gap-3 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={run.status === "failed" || run.status === "timeout" ? "destructive" : "secondary"}>
                        {formatRunStatus(run)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {run.triggeredBy === "manual" ? "手动" : run.triggeredBy === "missed_run" ? "补跑" : "计划"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {formatTaskDate(run.startedAt, "未开始")}
                      {run.finishedAt ? ` - ${formatTaskDate(run.finishedAt, "")}` : ""}
                    </p>
                  </div>
                  {run.status === "running" ? (
                    <Button
                      disabled={busy}
                      size="icon-sm"
                      variant="outline"
                      onClick={() => {
                        void handleStop(run.id)
                      }}
                    >
                      <Square />
                      <span className="sr-only">停止</span>
                    </Button>
                  ) : null}
                </div>

                {run.result ? (
                  <RunResult task={task} result={run.result} />
                ) : null}
                {run.error && !run.result?.error ? <OutputBlock label="错误" value={run.error} /> : null}
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

function RunResult({
  task,
  result,
}: {
  readonly task: ScheduledTask | null
  readonly result: ScheduledTaskRun["result"]
}) {
  if (!result) return null
  if (task) {
    try {
      const ResultView = rendererActionRegistry.get(task.action.type).ResultView
      if (ResultView) return <ResultView result={result} />
    } catch {
      return <ActionResultView result={result} />
    }
  }
  return <ActionResultView result={result} />
}

function OutputBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{label}</p>
      <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{value}</pre>
    </div>
  )
}

export { TaskRunsDialog }
