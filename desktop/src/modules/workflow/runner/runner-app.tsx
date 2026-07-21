import { useCallback, useEffect, useRef, useState } from "react"
import type { WorkflowDefinition, NodeRunResult, WorkflowRunDefinitionMigration, WorkflowRunStatus } from "@/types/workflow"
import type { SynapseAgentConversationTarget } from "@/types/agent-navigation"
import { createRendererLogger } from "@/app-shell/logging"
import "../../../../workflow-nodes/register.renderer"
import { useWorkflowEvents } from "../hooks/use-workflow-events"
import { errorDiagnostic, truncateWithEllipsis } from "../lib/error-utils"
import { RunnerToolbar } from "./runner-toolbar"
import { DagView } from "./dag-view"
import { TimelineView } from "./timeline-view"
import { TokenUsageView } from "./token-usage-view"
import { NodeResultPanel } from "./node-result-panel"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertCircle, Loader2, RefreshCw } from "lucide-react"
import { ProviderLookupProvider } from "../../../../workflow-nodes/provider-lookup-context"
import { sanitizeError } from "@/lib/error-sanitize"
import { ErrorBoundary } from "@/components/error-boundary"
import { toast } from "sonner"
import { formatNodeRunReport, formatWorkflowRunReport } from "./run-report"
import { openAgentConversationTarget } from "@/lib/agent-conversation-target"

const logger = createRendererLogger("workflow.runner")

type ViewMode = "dag" | "timeline" | "token"

function syncRunnerUrl(workflowId: string, runId: string): void {
  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.set("workflowId", workflowId)
  nextUrl.searchParams.set("runId", runId)
  window.history.replaceState(window.history.state, "", nextUrl)
}

export function WorkflowRunnerApp() {
  const searchParams = new URLSearchParams(window.location.search)
  const workflowId = searchParams.get("workflowId") ?? ""
  const initialRunId = searchParams.get("runId") ?? ""

  const [runId, setRunId] = useState(initialRunId)
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [runState, setRunState] = useState<WorkflowRunStatus["status"]>("running")
  const [nodeResults, setNodeResults] = useState<Record<string, NodeRunResult>>({})
  const [runParams, setRunParams] = useState<Record<string, unknown>>({})
  const [runError, setRunError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("dag")
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [definitionMigration, setDefinitionMigration] = useState<WorkflowRunDefinitionMigration | null>(null)
  const [retrySignal, setRetrySignal] = useState(0)
  const [confirmRerunActiveRunId, setConfirmRerunActiveRunId] = useState<string | null>(null)
  const [hydratedRunId, setHydratedRunId] = useState<string | null>(null)

  const runIdRef = useRef(runId)
  runIdRef.current = runId

  // Hydrate metadata (definition, params) from run status.
  // Node results and run state are exclusively managed by useWorkflowEvents
  // to avoid a race where this IPC response overwrites more-recent live events.
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    setLoadError(null)
    void (async () => {
      try {
        const status = await window.synapse?.workflow.run.get(runId, workflowId)
        if (cancelled) return
        if (!status) {
          logger.warn("runner hydration failed: runStatus returned null, triggering fallback", { runId, workflowId })
          setLoadError("无法加载运行记录（可能已被淘汰），显示最新工作流结构")
          return
        }
        setLoadError(null)
        setDefinitionMigration(status.definitionMigration ?? null)
        logger.info("hydrated run metadata", {
          runId,
          hasDefinition: !!status.definition,
          hasParams: !!status.params,
          definitionMigration: status.definitionMigration?.kind,
        })
        setHydratedRunId(runId)
        if (status.definitionMigration) setDefinition(null)
        else if (status.definition) setDefinition(status.definition)
        if (status.params) setRunParams(status.params)
      } catch (err) {
        if (cancelled) return
        logger.warn("runner hydration failed: runStatus rejected, triggering fallback", {
          workflowId,
          runId,
          boundary: "renderer.workflow.runner.hydration",
          ...errorDiagnostic(err),
        })
        setLoadError("无法加载运行记录（可能已被淘汰），显示最新工作流结构")
      }
    })()
    return () => { cancelled = true }
  }, [runId, retrySignal])

  useEffect(() => {
    // When there is no active run (Runner opened without a runId), or when
    // hydration failed and set loadError (runStatus returned null), fall back
    // to fetching the latest definition from the workflow store. This ensures
    // the Runner shows at least the DAG structure even if the run snapshot
    // has been pruned from disk, rather than staying on "加载中…" forever.
    if (definition || definitionMigration) return
    if (!workflowId) return
    // Skip fallback while runStatus is still hydrating. Once hydration has
    // returned for this runId without a definition, fetch the latest workflow
    // definition so old snapshots can still show the DAG structure.
    if (runId && !loadError && hydratedRunId !== runId) return
    let cancelled = false
    void (async () => {
      try {
        const def = await window.synapse?.workflow.definition.get(workflowId)
        if (cancelled) return
        if (def) {
          setDefinition(def)
        }
      } catch (err) {
        if (cancelled) return
        logger.warn("runner fallback definition failed", {
          workflowId,
          runId,
          boundary: "renderer.workflow.runner.fallback-definition",
          ...errorDiagnostic(err),
        })
        setLoadError("无法加载工作流结构，请重试")
      }
    })()
    return () => { cancelled = true }
  }, [workflowId, definition, definitionMigration, runId, loadError, hydratedRunId, retrySignal])

  useEffect(() => {
    if (!workflowId) return
    const unsubEvent = window.synapse?.workflow.operation.onEvent((event) => {
      if (event.type === "workflow:started" && event.workflowId === workflowId) {
        if (!runIdRef.current) {
          logger.info("workflow:started in runner — switching to new run", { newRunId: event.runId })
          syncRunnerUrl(workflowId, event.runId)
          setRunId(event.runId)
          setRunState("running")
          setNodeResults({})
          setRunError(null)
          setSelectedNodeId(null)
          // Clear definition and params so the runner shows loading state until
          // the hydration effect fetches the new run's metadata. Without this,
          // a stale definition (from a previous workflow version) would render
          // an incorrect DAG topology until the async fetch completes.
          setDefinition(null)
          setDefinitionMigration(null)
          setRunParams({})
        }
      }
    })
    const unsubSwitch = window.synapse?.workflow.operation.onRunnerSwitchRun((payload) => {
      if (payload?.runId && payload.runId !== runIdRef.current) {
        logger.info("runner-switch-run received", { newRunId: payload.runId })
        syncRunnerUrl(workflowId, payload.runId)
        setRunId(payload.runId)
        setRunState("running")
        setNodeResults({})
        setRunError(null)
        setSelectedNodeId(null)
        // Same rationale: clear stale definition/params from previous run
        setDefinition(null)
        setDefinitionMigration(null)
        setRunParams({})
      }
    })
    return () => { unsubEvent?.(); unsubSwitch?.() }
  }, [workflowId, retrySignal])

  useWorkflowEvents(runId, {
    onNodeStarted: (nodeId, partial) => setNodeResults((r) => ({
      ...r,
      [nodeId]: { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), ...partial, status: "running" as const },
    })),
    onNodeProgress: (nodeId, _phase, label) => setNodeResults((r) => {
      const existing = r[nodeId]
      if (!existing || existing.status !== "running") return r
      return { ...r, [nodeId]: { ...existing, progressLabel: label } }
    }),
    onNodeCompleted: (nodeId, output, result) => setNodeResults((r) => ({
      ...r,
      [nodeId]: result ?? { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "success" as const, output: String(output) },
    })),
    onNodeFailed: (nodeId, error, result) => setNodeResults((r) => ({
      ...r,
      [nodeId]: result ?? { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "failed" as const, error },
    })),
    onNodeSkipped: (nodeId, result) => setNodeResults((r) => ({
      ...r,
      [nodeId]: result ?? { nodeId, input: { variables: {} }, status: "skipped" as const },
    })),
    onNodeAgentConversation: (nodeId, target) => {
      if (!target) return
      setNodeResults((r) => {
        const existing = r[nodeId] ?? { nodeId, input: { variables: {} }, status: "running" as const }
        return {
          ...r,
          [nodeId]: {
            ...existing,
            outputs: {
              ...(existing.outputs ?? {}),
              agentConversation: target,
            },
          },
        }
      })
    },
    onCompleted: (results) => { setRunState("completed"); setRunError(null); setNodeResults(results) },
    onFailed: (error, results) => {
      setRunState("failed"); setRunError(error)
      if (results) setNodeResults(results)
    },
    onCancelled: (results) => {
      setRunState("cancelled"); setRunError(null)
      if (results) setNodeResults(results)
    },
    onSnapshotSaveFailed: () => {
      setLoadError("运行已结束，但历史保存失败")
    },
  }, workflowId)

  const handleCancel = useCallback(async () => {
    if (!runId) return
    setCancelling(true)
    try {
      await window.synapse?.workflow.run.disable(runId)
    } catch (err) {
      logger.warn("cancel IPC call failed", {
        runId,
        ...errorDiagnostic(err),
      })
      setRunError("取消失败：无法连接到主进程，请重试")
    } finally {
      setCancelling(false)
    }
  }, [runId])

  const handleRerun = useCallback(async () => {
    if (!runId) return
    setRerunning(true)
    logger.info("rerun requested", { runId, paramKeys: Object.keys(runParams) })
    try {
      const result = await window.synapse?.workflow.operation.rerun(runId, runParams, undefined, workflowId)
      if (!result) {
        logger.warn("rerun returned empty result — IPC bridge unavailable", { runId })
        setRunError("重新运行失败：IPC 通道不可用")
        return
      }
      if ("conflict" in result) {
        logger.info("rerun conflict — active run found", { runId, activeRunId: result.activeRunId })
        setConfirmRerunActiveRunId(result.activeRunId)
        return
      }
      if ("errors" in result) {
        const errors = Array.isArray(result.errors) ? result.errors : []
        logger.warn("rerun failed", {
          runId,
          ...validationErrorsDiagnostic(errors),
        })
        setRunError("重新运行失败：校验未通过")
        return
      }
      // Clear definition and params so the runner shows loading state until
      // hydration fetches the new run's metadata (same pattern as workflow:started).
      setDefinition(null)
      setDefinitionMigration(null)
      setRunParams({})
      syncRunnerUrl(workflowId, result.runId)
      setRunId(result.runId)
      setRunState("running")
      setNodeResults({})
      setRunError(null)
      setLoadError(null)
      setSelectedNodeId(null)
    } catch (err) {
      logger.warn("rerun IPC call failed", {
        runId,
        ...errorDiagnostic(err),
      })
      setRunError("重新运行失败：无法连接到主进程，请重试")
    } finally {
      setRerunning(false)
    }
  }, [runId, runParams, workflowId])

  const handleConfirmRerun = useCallback(async () => {
    if (!runId || !confirmRerunActiveRunId) return
    setConfirmRerunActiveRunId(null)
    setRerunning(true)
    logger.info("confirmed rerun with force", { runId, activeRunId: confirmRerunActiveRunId })
    try {
      const result = await window.synapse?.workflow.operation.rerun(runId, runParams, true, workflowId)
      if (!result || "conflict" in result || "errors" in result) {
        setRunError("重新运行失败，请重试")
        return
      }
      setDefinition(null)
      setDefinitionMigration(null)
      setRunParams({})
      syncRunnerUrl(workflowId, result.runId)
      setRunId(result.runId)
      setRunState("running")
      setNodeResults({})
      setRunError(null)
      setLoadError(null)
      setSelectedNodeId(null)
    } catch (err) {
      logger.warn("forced rerun IPC call failed", {
        runId,
        ...errorDiagnostic(err),
      })
      setRunError("重新运行失败：无法连接到主进程，请重试")
    } finally {
      setRerunning(false)
    }
  }, [runId, runParams, confirmRerunActiveRunId, workflowId])

  const handleOpenEditor = useCallback(() => {
    void window.synapse?.workflow.operation.openEditor(workflowId).catch((err) => {
      logger.warn("Workflow editor open failed.", {
        boundary: "renderer.workflow.runner.openEditor",
        workflowId,
        ...errorDiagnostic(err),
      })
      setRunError("打开工作流失败，请重试")
    })
  }, [workflowId])

  const handleOpenAgentConversation = useCallback(async (target: SynapseAgentConversationTarget) => {
    try {
      const result = await openAgentConversationTarget(target)
      if (!result.opened) {
        toast.error("对话不存在或已删除")
      }
    } catch (err) {
      logger.warn("workflow runner Agent conversation open failed", {
        runId,
        workflowId,
        conversationId: target.conversationId,
        platform: target.platform,
        boundary: "renderer.workflow.runner.open-agent-conversation",
        ...errorDiagnostic(err),
      })
      toast.error("打开失败")
    }
  }, [runId, workflowId])

  const handleRetry = useCallback(() => {
    logger.info("retry loading run", { runId, workflowId })
    setLoadError(null)
    setDefinition(null)
    setDefinitionMigration(null)
    setRetrySignal((s) => s + 1)
  }, [runId, workflowId])

  const selectedResult = selectedNodeId
    ? nodeResults[selectedNodeId] ?? { nodeId: selectedNodeId, status: "pending" as const, input: { variables: {} } }
    : null

  const handleCopyRunReport = useCallback(async () => {
    if (!definition) return
    try {
      await navigator.clipboard.writeText(formatWorkflowRunReport({
        definition,
        runId,
        runState,
        runParams,
        nodeResults,
        runError,
      }))
      toast("运行报告已复制。")
    } catch (err) {
      logger.warn("copy workflow run report failed", {
        runId,
        workflowId,
        boundary: "renderer.workflow.runner.copy-run-report",
        ...clipboardErrorDiagnostic(err),
      })
      toast("复制失败。")
    }
  }, [definition, nodeResults, runError, runId, runParams, runState, workflowId])

  const handleCopyNodeReport = useCallback(async () => {
    if (!definition || !selectedNodeId || !selectedResult) return
    const node = definition.nodes.find((candidate) => candidate.id === selectedNodeId)
    if (!node) return
    try {
      await navigator.clipboard.writeText(formatNodeRunReport({
        definition,
        node,
        result: selectedResult,
        orderIndex: definition.nodes.findIndex((candidate) => candidate.id === selectedNodeId) + 1,
      }))
      toast("节点报告已复制。")
    } catch (err) {
      logger.warn("copy workflow node report failed", {
        runId,
        workflowId,
        nodeId: selectedNodeId,
        boundary: "renderer.workflow.runner.copy-node-report",
        ...clipboardErrorDiagnostic(err),
      })
      toast("复制失败。")
    }
  }, [definition, runId, selectedNodeId, selectedResult, workflowId])

  if (!workflowId && !runId) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-sm">
          <AlertCircle data-icon="inline-start" />
          <AlertTitle>缺少运行参数</AlertTitle>
          <AlertDescription>请从工作流列表重新打开运行结果。</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!definition) {
    if (definitionMigration) {
      const description = definitionMigration.kind === "unsupported_future"
        ? "此记录由较新版本创建，请升级 Synapse 后再查看。"
        : "历史工作流结构读取失败，请重试。"
      return (
        <div className="flex h-screen items-center justify-center p-4">
          <div className="flex max-w-sm flex-col gap-3">
            <Alert variant="destructive">
              <AlertCircle data-icon="inline-start" />
              <AlertTitle>无法显示历史工作流结构</AlertTitle>
              <AlertDescription>{description}</AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleRetry}>
                <RefreshCw data-icon="inline-start" />
                重试
              </Button>
              <Button size="sm" variant="outline" onClick={handleOpenEditor}>
                打开当前工作流
              </Button>
            </div>
          </div>
        </div>
      )
    }
    if (loadError) {
      return (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center space-y-3 max-w-sm">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="text-xs font-medium">无法加载运行结果</AlertTitle>
              <AlertDescription className="text-xs">{loadError}</AlertDescription>
            </Alert>
            <Button size="sm" variant="outline" onClick={handleRetry}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />重试
            </Button>
          </div>
        </div>
      )
    }
    return <div className="flex items-center justify-center h-screen text-sm text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" />加载中…</div>
  }

  return (
    <ProviderLookupProvider>
    <ErrorBoundary fallbackTitle="运行结果出现问题">
    <div className="flex flex-col h-screen">
      <RunnerToolbar
        definition={definition}
        runState={runState}
        runError={runError}
        viewMode={viewMode}
        rerunning={rerunning}
        cancelling={cancelling}
        onViewModeChange={setViewMode}
        onCancel={handleCancel}
        onRerun={handleRerun}
        onOpenEditor={handleOpenEditor}
        onCopyRunReport={handleCopyRunReport}
      />
      {loadError && (
        <div className="border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          {loadError}
        </div>
      )}
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        <ResizablePanel className="min-w-0 overflow-hidden">
          {viewMode === "dag" ? (
            <DagView
              definition={definition}
              nodeResults={nodeResults}
              runState={runState}
              selectedNodeId={selectedNodeId}
              onNodeSelect={setSelectedNodeId}
              onOpenAgentConversation={handleOpenAgentConversation}
            />
          ) : viewMode === "timeline" ? (
            <TimelineView
              definition={definition}
              nodeResults={nodeResults}
              selectedNodeId={selectedNodeId}
              onNodeSelect={setSelectedNodeId}
              onOpenAgentConversation={handleOpenAgentConversation}
            />
          ) : (
            <TokenUsageView
              definition={definition}
              nodeResults={nodeResults}
            />
          )}
        </ResizablePanel>
        {selectedResult && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              className="min-w-0 overflow-hidden"
              defaultSize={460}
              minSize={320}
              maxSize={900}
              groupResizeBehavior="preserve-pixel-size"
            >
              <NodeResultPanel
                result={selectedResult}
                nodeName={definition.nodes.find((n) => n.id === selectedNodeId)?.name ?? selectedNodeId ?? ""}
                definition={definition}
                onClose={() => setSelectedNodeId(null)}
                onCopyNodeReport={handleCopyNodeReport}
                onOpenAgentConversation={handleOpenAgentConversation}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
    </ErrorBoundary>
    <AlertDialog open={confirmRerunActiveRunId !== null} onOpenChange={(open) => { if (!open) setConfirmRerunActiveRunId(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认重新运行</AlertDialogTitle>
          <AlertDialogDescription>
            当前工作流仍有运行中的任务，重新运行将取消当前运行。是否继续？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <Button variant="destructive" onClick={() => void handleConfirmRerun()}>继续重新运行</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </ProviderLookupProvider>
  )
}

function validationErrorsDiagnostic(errors: readonly unknown[]): {
  readonly errorCount: number
  readonly firstErrorType?: string
  readonly firstErrorMessage?: string
} {
  const first = validationErrorRecord(errors[0])
  const firstErrorType = typeof first?.type === "string" ? first.type : undefined
  const rawMessage = typeof first?.message === "string" ? first.message : undefined
  const firstErrorMessage = rawMessage
    ? truncateWithEllipsis(sanitizeError(rawMessage), 200)
    : undefined
  return {
    errorCount: errors.length,
    firstErrorType,
    firstErrorMessage,
  }
}

function validationErrorRecord(value: unknown): {
  readonly type?: unknown
  readonly message?: unknown
} | undefined {
  return typeof value === "object" && value !== null
    ? value as { readonly type?: unknown; readonly message?: unknown }
    : undefined
}

function clipboardErrorDiagnostic(err: unknown): { readonly errorName?: string; readonly errorLength: number } {
  if (err instanceof Error) return { errorName: err.name, errorLength: err.message.length }
  const message = String(err)
  return { errorLength: message.length }
}
