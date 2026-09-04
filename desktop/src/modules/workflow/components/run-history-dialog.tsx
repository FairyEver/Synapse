import { useCallback, useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AlertCircle, ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFrame, DialogFrameBody, DialogFrameHeader } from "@/components/ui/dialog"
import { createRendererLogger } from "@/app-shell/logging"
import { track } from "@/lib/ui-tracking"
import { errorDiagnostic } from "../lib/error-utils"
import { formatDurationMs } from "../lib/duration"
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

function getErrorSummary(error: string): string {
  try {
    const parsed = JSON.parse(error) as unknown
    const messages: string[] = []
    collectErrorMessages(parsed, messages, 0)
    return [...new Set(messages)].slice(0, 3).join("；") || error
  } catch {
    return error
  }
}

function collectErrorMessages(value: unknown, messages: string[], depth: number): void {
  if (depth > 3 || messages.length >= 3 || value == null) return
  if (Array.isArray(value)) {
    for (const item of value) collectErrorMessages(item, messages, depth + 1)
    return
  }
  if (typeof value !== "object") return

  const record = value as Record<string, unknown>
  if (typeof record.message === "string" && record.message.trim()) {
    messages.push(record.message.trim())
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== "message") collectErrorMessages(child, messages, depth + 1)
  }
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
        const data = await window.synapse?.workflow.run.list(workflowId)
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
    const unsubscribe = window.synapse?.workflow.operation.onEvent?.((event) => {
      if (isWorkflowTerminalEvent(event, workflowId)) load()
    })
    return () => { unsubscribe?.() }
  }, [open, workflowId, load])

  const handleOpenRunner = async (runId: string) => {
    track({
      component: "workflow",
      name: "workflow-run-history-open-runner",
      action: "click",
      eventKey: "workflow.run-history.open-runner",
      metadata: {
        boundary: "renderer.workflow.run-history.open-runner",
        workflowId,
        runId,
      },
    })
    try {
      await window.synapse?.workflow.operation.openRunner(workflowId, runId)
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="h-[70vh] max-h-[calc(100vh-4rem)] overflow-hidden p-0 sm:max-w-3xl" showCloseButton={false}>
        <DialogFrame>
          <DialogFrameHeader title="运行历史" bordered>
            <DialogDescription className="sr-only">查看该工作流的历史运行记录。</DialogDescription>
          </DialogFrameHeader>
          <DialogFrameBody className="min-h-0 overflow-hidden">
            {loading ? (
              <p className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载中…</p>
            ) : error ? (
              <div className="space-y-3 px-5 py-4">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{error}</AlertDescription>
                </Alert>
                <Button size="sm" variant="outline" onClick={load}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />重试
                </Button>
              </div>
            ) : snapshots.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted-foreground">暂无运行记录。</p>
            ) : (
              <ScrollArea className="h-full min-h-0" data-track="workflow-run-history-list">
                <div className="flex flex-col gap-2 px-5 py-4">
                  {snapshots.map((snapshot) => (
                    <RunHistoryItem
                      key={snapshot.runId}
                      snapshot={snapshot}
                      onOpen={() => { void handleOpenRunner(snapshot.runId) }}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </DialogFrameBody>
        </DialogFrame>
      </DialogContent>
    </Dialog>
  )
}

function RunHistoryItem({
  snapshot,
  onOpen,
}: {
  readonly snapshot: WorkflowRunListItem
  readonly onOpen: () => void
}) {
  const [errorExpanded, setErrorExpanded] = useState(false)
  const firstError = getFirstError(snapshot)
  const errorSummary = firstError ? getErrorSummary(firstError) : null
  const duration = snapshot.endedAt == null
    ? null
    : formatDurationMs(snapshot.endedAt - snapshot.startedAt)
  const nodeCount = Object.keys(snapshot.nodeResults).length

  return (
    <article data-slot="run-history-item" className="min-w-0 overflow-hidden rounded-lg border bg-background">
      <button
        type="button"
        data-slot="run-history-open"
        className="flex w-full min-w-0 cursor-pointer flex-col gap-2.5 p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
        onClick={onOpen}
      >
        <div className="flex w-full min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[snapshot.status] ?? "outline"}>
              {STATUS_LABEL[snapshot.status] ?? snapshot.status}
            </Badge>
            {snapshot.definitionMigration ? <Badge variant="outline">结构不可读</Badge> : null}
          </div>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </div>

        <div className="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <time dateTime={new Date(snapshot.startedAt).toISOString()}>{formatTime(snapshot.startedAt)}</time>
          {duration ? <span>{duration}</span> : null}
          <span>{nodeCount} 个节点</span>
        </div>
      </button>

      {firstError && errorSummary ? (
        <Collapsible open={errorExpanded} onOpenChange={setErrorExpanded} data-track="workflow-run-history-error">
          <div className="min-w-0 border-t bg-destructive/5 px-3 py-2.5">
            <div className="flex min-w-0 items-start gap-2">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-destructive">错误详情</p>
                {!errorExpanded ? (
                  <p data-slot="run-history-error-summary" className="mt-1 line-clamp-2 max-w-full whitespace-pre-wrap break-all text-xs leading-5 text-destructive">
                    {errorSummary}
                  </p>
                ) : null}
              </div>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="shrink-0 text-destructive"
                  aria-label={`${errorExpanded ? "收起" : "展开"}错误详情`}
                >
                  {errorExpanded ? "收起" : "展开"}
                  <ChevronDown className={errorExpanded ? "rotate-180" : undefined} />
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="min-w-0">
              <ScrollArea className="mt-2 max-h-48 max-w-full rounded-md bg-muted">
                <pre
                  className="whitespace-pre-wrap break-all p-2.5 font-mono text-xs leading-5 text-foreground"
                  data-allow-select="true"
                >
                  {firstError}
                </pre>
              </ScrollArea>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ) : null}
    </article>
  )
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp)
}
