import { useEffect, useState } from "react"
import { Clock, Play, RotateCcw, Square } from "lucide-react"

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
import { Separator } from "@/components/ui/separator"
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
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task?.name ?? "运行历史"}</DialogTitle>
          <DialogDescription>最近 100 次运行记录</DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0">
          <div className="flex max-h-[calc(100vh-14rem)] flex-col gap-2 pr-3">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {loading ? <p className="text-sm text-muted-foreground">加载中</p> : null}
            {!loading && runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无运行记录</p>
            ) : null}

            {runs.map((run) => (
              <RunItem key={run.id} run={run} task={task} busy={busy} onStop={handleStop} />
            ))}
          </div>
        </ScrollArea>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

function RunItem({
  run,
  task,
  busy,
  onStop,
}: {
  readonly run: ScheduledTaskRun
  readonly task: ScheduledTask | null
  readonly busy: boolean
  readonly onStop: (runId: string) => void
}) {
  const hasOutput = run.result || (run.error && !run.result?.error)
  const statusVariant = run.status === "failed" || run.status === "timeout" ? "destructive" : "secondary"
  const triggerIcon = run.triggeredBy === "manual"
    ? <Play className="size-3" />
    : run.triggeredBy === "missed_run"
      ? <RotateCcw className="size-3" />
      : <Clock className="size-3" />
  const triggerLabel = run.triggeredBy === "manual" ? "手动" : run.triggeredBy === "missed_run" ? "补跑" : "计划"

  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={statusVariant}>{formatRunStatus(run)}</Badge>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {triggerIcon}
            {triggerLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {run.result?.metrics?.durationMs !== undefined ? (
            <span className="text-xs text-muted-foreground">
              {formatDuration(run.result.metrics.durationMs)}
            </span>
          ) : null}
          {run.status === "running" ? (
            <Button
              disabled={busy}
              size="icon-sm"
              variant="outline"
              onClick={() => { onStop(run.id) }}
            >
              <Square />
              <span className="sr-only">停止</span>
            </Button>
          ) : null}
        </div>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {formatTaskDate(run.startedAt, "未开始")}
        {run.finishedAt ? ` → ${formatTaskDate(run.finishedAt, "")}` : ""}
      </p>

      {hasOutput ? (
        <>
          <Separator className="my-2" />
          <div className="min-w-0 overflow-hidden">
            {run.result ? (
              <RunResult task={task} result={run.result} />
            ) : null}
            {run.error && !run.result?.error ? <OutputBlock value={run.error} /> : null}
          </div>
        </>
      ) : null}
    </div>
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

function OutputBlock({ value }: { readonly value: string }) {
  return (
    <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2.5 text-xs break-all whitespace-pre-wrap">
      {value}
    </pre>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return secs > 0 ? `${mins}m${secs}s` : `${mins}m`
}

export { TaskRunsDialog }
