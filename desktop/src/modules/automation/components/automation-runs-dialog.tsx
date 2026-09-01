import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { Clock, Play, RefreshCw, RotateCcw, Square } from "lucide-react"

import { ActionResultView } from "@/action-runtime/action-result-view"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { createRendererLogger } from "@/app-shell/logging"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { runTrackedOperation } from "@/lib/ui-tracking"
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import type { AutomationItem, AutomationRun } from "@/types/automation"
import { listAutomationRuns } from "../hooks/use-automation"
import { formatAutomationDate, formatAutomationRunStatus } from "../utils"

const logger = createRendererLogger("automation.runs")

type AutomationRunsDialogProps = {
  open: boolean
  item: AutomationItem | null
  busy: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  onStopRun: (runId: string) => Promise<void>
}

function AutomationRunsDialog({
  open,
  item,
  busy,
  returnFocusRef,
  onOpenChange,
  onStopRun,
}: AutomationRunsDialogProps) {
  const wasOpenRef = useRef(open)
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRuns = useCallback(async (options?: { readonly isCancelled?: () => boolean }) => {
    if (!item) return
    setLoading(true)
    setRuns([])
    setError(null)
    try {
      const nextRuns = await listAutomationRuns(item.id)
      if (!options?.isCancelled?.()) {
        setRuns(nextRuns)
        setError(null)
      }
    } catch (loadError) {
      if (!options?.isCancelled?.()) {
        logger.warn("Automation run history load failed.", {
          automationId: item.id,
          executorType: item.executor.type,
          boundary: "renderer.automation.runs.list",
          ...errorDiagnostic(loadError),
        })
        setError("读取历史失败")
      }
    } finally {
      if (!options?.isCancelled?.()) {
        setLoading(false)
      }
    }
  }, [item])

  useEffect(() => {
    if (!open || !item) return
    let cancelled = false
    void loadRuns({
      isCancelled: () => cancelled,
    })

    return () => {
      cancelled = true
    }
  }, [open, item, loadRuns])

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      returnFocusRef?.current?.focus()
    }
    wasOpenRef.current = open
  }, [open, returnFocusRef])

  function handleRetry() {
    void runTrackedOperation(
      { component: "automation", eventKey: "automation.history.retry" },
      () => loadRuns(),
    )
  }

  async function handleStop(run: AutomationRun) {
    if (!item) return
    try {
      await runTrackedOperation(
        { component: "automation", eventKey: "automation.history.stop" },
        () => onStopRun(run.id),
      )
      setError(null)
      setRuns(await listAutomationRuns(item.id))
    } catch (stopError) {
      logger.warn("Automation run stop failed.", {
        automationId: item.id,
        runId: run.id,
        executorType: item.executor.type,
        boundary: "renderer.automation.runs.stop",
        ...errorDiagnostic(stopError),
      })
      setError("停止失败")
    }
  }

  return (
    <Dialog data-track="automation-runs-dialog" open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-4rem)] overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={false}
      >
        <DialogFrame className="max-h-[calc(100vh-4rem)]">
          <DialogFrameHeader title={item?.name ?? "运行历史"} description="最近 100 次运行记录" />

          <DialogFrameBody>
            <ScrollArea className="h-full min-h-0">
              <div className="flex max-h-[calc(100vh-14rem)] flex-col gap-2 px-5 py-4">
                {error ? (
                  <div className="flex items-center gap-2 text-sm">
                    <p className="text-destructive">{error}</p>
                    <Button size="sm" variant="outline" onClick={handleRetry}>
                      <RefreshCw />
                      重试
                    </Button>
                  </div>
                ) : null}
                {loading ? <p className="text-sm text-muted-foreground">加载中</p> : null}
                {!loading && !error && runs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无运行记录</p>
                ) : null}
                {!loading && runs.map((run) => (
                  <RunItem
                    key={run.id}
                    run={run}
                    item={item}
                    busy={busy}
                    onStop={(targetRun) => { void handleStop(targetRun) }}
                  />
                ))}
              </div>
            </ScrollArea>
          </DialogFrameBody>

          <DialogFrameFooter showCloseButton />
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}

function RunItem({
  run,
  item,
  busy,
  onStop,
}: {
  readonly run: AutomationRun
  readonly item: AutomationItem | null
  readonly busy: boolean
  readonly onStop: (run: AutomationRun) => void
}) {
  const hasOutput = run.result || run.error
  const statusVariant = run.status === "failed" || run.status === "timeout" ? "destructive" : "secondary"
  const triggerIcon = run.triggeredBy === "manual"
    ? <Play className="size-3" />
    : run.triggeredBy === "missed_run"
      ? <RotateCcw className="size-3" />
      : <Clock className="size-3" />
  const triggerLabel = run.triggeredBy === "manual" ? "手动" : run.triggeredBy === "missed_run" ? "补跑" : "触发"

  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={statusVariant}>{formatAutomationRunStatus(run)}</Badge>
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
            <Button disabled={busy} size="icon-sm" variant="outline" onClick={() => onStop(run)}>
              <Square />
              <span className="sr-only">停止</span>
            </Button>
          ) : null}
        </div>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {formatAutomationDate(run.startedAt, "未开始")}
        {run.finishedAt ? ` -> ${formatAutomationDate(run.finishedAt, "")}` : ""}
      </p>

      {hasOutput ? (
        <>
          <Separator className="my-2" />
          <div className="min-w-0 overflow-hidden">
            {run.result ? <RunResult run={run} item={item} /> : null}
            {run.error && !run.result?.error ? <OutputBlock value={run.error} /> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

function RunResult({
  run,
  item,
}: {
  readonly run: AutomationRun
  readonly item: AutomationItem | null
}) {
  if (!run.result) return null
  if (item) {
    try {
      const ResultView = rendererActionRegistry.get(item.executor.type).ResultView
      if (ResultView) return <ResultView result={run.result} />
    } catch (renderError) {
      logger.warn("Automation run result renderer fallback.", {
        automationId: item.id,
        runId: run.id,
        executorType: item.executor.type,
        boundary: "renderer.automation.runs.result-fallback",
        ...errorDiagnostic(renderError),
      })
    }
  }
  return <ActionResultView result={run.result} />
}

function OutputBlock({ value }: { readonly value: string }) {
  return (
    <ScrollArea className="max-h-40 rounded-md bg-muted p-2.5" scrollbars="both">
      <pre className="text-xs break-all whitespace-pre-wrap">{value}</pre>
    </ScrollArea>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return secs > 0 ? `${mins}m${secs}s` : `${mins}m`
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

export { AutomationRunsDialog }
export type { AutomationRunsDialogProps }
