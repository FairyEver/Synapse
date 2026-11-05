import { useEffect, useState } from "react"
import { ChevronDown, Clock, LoaderCircle, Play, RefreshCw, RotateCcw, Square } from "lucide-react"

import { ActionResultView } from "@/action-runtime/action-result-view"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { createRendererLogger } from "@/app-shell/logging"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { runTrackedOperation } from "@/lib/ui-tracking"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { AutomationItem, AutomationRun } from "@/types/automation"
import { useAutomationRuns } from "../hooks/use-automation-runs"
import { formatAutomationDate, formatAutomationFailureReason, formatAutomationRunStatus, formatAutomationSkipReason } from "../utils"

const logger = createRendererLogger("automation.runs")

type AutomationRunsPanelProps = {
  item: AutomationItem | null
  busy: boolean
  onStopRun: (runId: string) => Promise<void>
}

function AutomationRunsPanel({
  item,
  busy,
  onStopRun,
}: AutomationRunsPanelProps) {
  const history = useAutomationRuns(item, onStopRun)
  const { runs, loading, error } = history

  return (
    <section aria-label="运行记录" className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-6 py-3 text-xs text-muted-foreground"><span>最近 100 条运行记录</span>{loading && runs.length > 0 ? <span role="status">刷新中</span> : null}</div>
      {error ? (
        <div className="flex flex-wrap items-center gap-3 px-6 py-5 text-sm">
          <p role="alert" className="text-destructive">{error}</p>
          <Button variant="outline" onClick={() => { void runTrackedOperation({ component: "automation", eventKey: "automation.history.retry" }, history.refresh) }}><RefreshCw />重试</Button>
        </div>
      ) : null}
      {loading && runs.length === 0 ? <p role="status" className="px-6 py-8 text-sm text-muted-foreground">加载中</p> : null}
      {!loading && !error && runs.length === 0 ? <p className="px-6 py-8 text-sm text-muted-foreground">暂无运行记录</p> : null}
      {runs.length > 0 ? <ol className="min-w-0">
        {runs.map(run => <RunItem key={run.id} run={run} item={item} busy={busy || history.stopping.has(run.id)} stopping={history.stopping.has(run.id)} stopError={history.stopErrors[run.id]} onStop={targetRun => { void history.stop(targetRun) }} />)}
      </ol> : null}
    </section>
  )
}

function RunItem({
  run,
  item,
  busy,
  onStop,
  stopping,
  stopError,
}: {
  readonly run: AutomationRun
  readonly item: AutomationItem | null
  readonly busy: boolean
  readonly stopping: boolean
  readonly stopError?: string
  readonly onStop: (run: AutomationRun) => void
}) {
  const [expanded, setExpanded] = useState(run.status === "failed" || run.status === "timeout")
  useEffect(() => { if (run.status === "failed" || run.status === "timeout") setExpanded(true) }, [run.status])
  const hasOutput = run.result || run.error
  const statusVariant = run.status === "failed" || run.status === "timeout" ? "destructive" : "secondary"
  const triggerIcon = run.triggeredBy === "manual"
    ? <Play className="size-3" />
    : run.triggeredBy === "missed_run"
      ? <RotateCcw className="size-3" />
      : <Clock className="size-3" />
  const triggerLabel = run.triggeredBy === "manual" ? "手动" : run.triggeredBy === "missed_run" ? "补跑" : "触发"

  return (
    <li className="min-w-0 border-b px-6 py-5 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm font-medium tabular-nums">{formatAutomationDate(run.startedAt, "未开始")}</p>
          <Badge variant={statusVariant}>{formatAutomationRunStatus(run)}</Badge>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">{triggerIcon}{triggerLabel}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {stopping ? <span role="status" className="text-xs text-muted-foreground">正在停止</span> : null}
          {run.result?.metrics?.durationMs !== undefined ? <span className="text-sm tabular-nums text-muted-foreground">{formatDuration(run.result.metrics.durationMs)}</span> : null}
          {run.status === "running" ? <Button disabled={busy} size="icon-sm" variant="outline" onClick={() => onStop(run)}>{stopping ? <LoaderCircle className="animate-spin" /> : <Square />}<span className="sr-only">{stopping ? "正在停止" : "停止"}</span></Button> : null}
        </div>
      </div>
      {run.finishedAt ? <p className="mt-2 text-xs tabular-nums text-muted-foreground">结束于 {formatAutomationDate(run.finishedAt, "")}</p> : null}
      {stopError ? <div className="mt-3 flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-destructive">{stopError}</p><Button variant="outline" disabled={busy} onClick={() => onStop(run)}>重试停止</Button></div> : null}
      {hasOutput ? <Collapsible open={expanded} onOpenChange={setExpanded} className="mt-3 min-w-0">
        <CollapsibleTrigger asChild><Button variant="ghost"><ChevronDown data-icon="inline-start" className={expanded ? "rotate-180" : undefined} />{expanded ? "收起结果" : "查看结果"}</Button></CollapsibleTrigger>
        <CollapsibleContent className="mt-3 grid min-w-0 gap-3 overflow-hidden">
        {run.result ? <RunResult run={run} item={item} /> : null}
        {run.error && !run.result?.error ? <div className="grid min-w-0 gap-1"><p className="text-xs font-medium">{run.status === "skipped" ? "跳过原因" : "错误"}</p><OutputBlock value={run.status === "skipped" ? formatAutomationSkipReason(run.error) : formatAutomationFailureReason(run.error)} /></div> : null}
      </CollapsibleContent></Collapsible> : null}
    </li>
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
  if (run.executorType) {
    try {
      const ResultView = rendererActionRegistry.get(run.executorType).ResultView
      if (ResultView) return <ResultView result={run.result} showDuration={false} />
    } catch (renderError) {
      logger.warn("Automation run result renderer fallback.", {
        automationId: item?.id ?? run.automationId,
        runId: run.id,
        executorType: run.executorType,
        boundary: "renderer.automation.runs.result-fallback",
        ...errorDiagnostic(renderError),
      })
    }
  }
  return <ActionResultView result={run.result} showDuration={false} />
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
  const totalSeconds = Math.round(ms / 1000)
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  return secs > 0 ? `${mins}m${secs}s` : `${mins}m`
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

export { AutomationRunsPanel }
export type { AutomationRunsPanelProps }
