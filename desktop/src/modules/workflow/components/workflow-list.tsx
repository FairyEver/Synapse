import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { AlertCircle, FileJson, Info, Loader2, Plus, RefreshCw } from "lucide-react"
import { WorkflowCard, type WorkflowCardRunState } from "./workflow-card"
import { RunParamsDialog } from "./run-params-dialog"
import { RunHistoryDialog } from "./run-history-dialog"
import { useWorkflowList } from "../hooks/use-workflow-list"
import { createRendererLogger } from "@/app-shell/logging"
import { ModuleContentPanel } from "@/components/module-page"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { track } from "@/lib/ui-tracking"
import type { WorkflowDefinition, WorkflowMeta, WorkflowMigrationDiagnostic, WorkflowMigrationDiagnosticStatus } from "@/types/workflow"
import { CopyIdButton } from "./copy-id-button"
import { errorDiagnostic } from "../lib/error-utils"
import {
  createWorkflowLastRunValues,
  type WorkflowLastRunValues,
} from "../lib/run-param-last-values"

const logger = createRendererLogger("workflow.list")
type WorkflowBridge = NonNullable<Window["synapse"]>["workflow"]

const MIGRATION_DIAGNOSTIC_DISPLAY: Record<WorkflowMigrationDiagnosticStatus, {
  readonly label: string
  readonly message: string
  readonly recovery: string
}> = {
  failed: {
    label: "迁移失败",
    message: "旧仓库工作流数据迁移失败。",
    recovery: "原始文件仍保留在旧内容仓库，请修复数据后重试。",
  },
  unsupported_future: {
    label: "版本过高",
    message: "旧仓库工作流使用更高的数据版本。",
    recovery: "原始文件仍保留在旧内容仓库，请升级 Synapse 或使用兼容版本处理。",
  },
  legacy_conflict: {
    label: "ID 冲突",
    message: "当前数据中已有同 ID 工作流，旧仓库版本未自动恢复。",
    recovery: "当前工作流未被覆盖；如需恢复旧版本，请先在旧仓库中调整 ID。",
  },
}

function openRunner(workflowApi: WorkflowBridge, workflowId: string, runId: string): void {
  void workflowApi.openRunner(workflowId, runId).catch((err) => {
    logger.warn("Workflow runner open failed.", {
      boundary: "renderer.workflow.list.openRunner",
      workflowId,
      runId,
      ...errorDiagnostic(err),
    })
    toast.error("打开运行窗口失败，请重试")
  })
}

export function WorkflowList({ onCreate }: { onCreate: () => void }) {
  const { items, migrationDiagnostics, loading, error, refresh } = useWorkflowList()
  const [runTarget, setRunTarget] = useState<WorkflowDefinition | null>(null)
  const [historyWorkflowId, setHistoryWorkflowId] = useState<string | null>(null)
  const [protectedWorkflow, setProtectedWorkflow] = useState<WorkflowMeta | null>(null)
  const [migrationDiagnostic, setMigrationDiagnostic] = useState<WorkflowMigrationDiagnostic | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  // Track a conflict so we can offer "cancel old & start new" instead of just an error toast.
  const [conflictState, setConflictState] = useState<{
    def: WorkflowDefinition
    params: Record<string, unknown>
    lastValues?: WorkflowLastRunValues
  } | null>(null)
  // Remember last-used param values per workflow so the dialog can pre-fill them on re-run
  const [lastRunValues, setLastRunValues] = useState<Record<string, WorkflowLastRunValues>>({})

  // Track the latest run status per workflow so WorkflowCard can show a live badge.
  const [runStates, setRunStates] = useState<Record<string, WorkflowCardRunState>>({})
  const runIdToWfId = useRef<Record<string, string>>({})

  useEffect(() => {
    try {
      const unsub = requireBridgeDomain("workflow").onEvent((event) => {
        if (event.type === "workflow:started") {
          runIdToWfId.current[event.runId] = event.workflowId
          setRunStates((s) => ({ ...s, [event.workflowId]: { status: "running", runId: event.runId } }))
        } else if (event.type === "workflow:completed") {
          const wfId = event.workflowId ?? runIdToWfId.current[event.runId]
          if (wfId) setRunStates((s) => ({ ...s, [wfId]: { status: "completed" } }))
        } else if (event.type === "workflow:failed") {
          const wfId = event.workflowId ?? runIdToWfId.current[event.runId]
          if (wfId) setRunStates((s) => ({ ...s, [wfId]: { status: "failed" } }))
        } else if (event.type === "workflow:cancelled") {
          const wfId = event.workflowId ?? runIdToWfId.current[event.runId]
          if (wfId) setRunStates((s) => ({ ...s, [wfId]: { status: "cancelled" } }))
        }
      })
      return () => { unsub() }
    } catch (err) {
      logger.warn("Workflow event subscription failed.", {
        boundary: "renderer.workflow.list.events",
        ...errorDiagnostic(err),
      })
      return undefined
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const activeRuns = await requireBridgeDomain("workflow").activeRuns()
        if (cancelled) return
        setRunStates((state) => {
          const next = { ...state }
          for (const run of activeRuns) {
            next[run.workflowId] = { status: "running", runId: run.runId }
            runIdToWfId.current[run.runId] = run.workflowId
          }
          return next
        })
      } catch (err) {
        logger.warn("Workflow active runs load failed.", {
          boundary: "renderer.workflow.list.active-runs",
          ...errorDiagnostic(err),
        })
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleRun = async (id: string) => {
    if (runningId) return
    setRunningId(id)
    try {
      const workflowApi = requireBridgeDomain("workflow")
      const def = await workflowApi.get(id)
      if (!def) {
        toast.error("工作流不存在，请刷新列表")
        void refresh()
        return
      }
      if (def.params.length === 0) {
        trackWorkflowRunSubmit(def, {}, false)
        const result = await workflowApi.runDefinition(def, {})
        if ("errors" in result) {
          const errors = result.errors as { message?: string }[]
          toast.error(errors[0]?.message ?? "工作流校验失败")
          return
        }
        if ("conflict" in result) {
          setConflictState({ def, params: {} })
          return
        }
        openRunner(workflowApi, def.id, result.runId)
      } else {
        setRunTarget(def)
      }
    } catch (err) {
      showRunFailure({ id }, {}, false, err)
    } finally {
      setRunningId(null)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await requireBridgeDomain("workflow").delete(id)
    } catch (err) {
      logger.warn("Workflow delete failed.", {
        boundary: "renderer.workflow.list.delete",
        workflowId: id,
        ...errorDiagnostic(err),
      })
      toast.error("删除失败，请重试")
      return
    }
    toast.success("工作流已删除")
    void refresh()
  }

  const handleExport = async (id: string, name: string) => {
    try {
      const result = await requireBridgeDomain("workflow").exportPackage(id, name)
      if (!result) return
      toast.success(result.kind === "future-raw" ? "工作流原文已导出" : "工作流已导出")
    } catch (err) {
      logger.warn("Workflow export failed.", {
        boundary: "renderer.workflow.list.export",
        workflowId: id,
        ...errorDiagnostic(err),
      })
      toast.error("导出失败，请重试")
    }
  }

  const handleOpenActiveRun = (workflowId: string, runId: string) => {
    openRunner(requireBridgeDomain("workflow"), workflowId, runId)
  }

  const handleOpen = (meta: WorkflowMeta) => {
    if (meta.loadError) {
      setProtectedWorkflow(meta)
      return
    }
    void requireBridgeDomain("workflow").openEditor(meta.id).catch((err) => {
      logger.warn("Workflow editor open failed.", {
        boundary: "renderer.workflow.list.openEditor",
        workflowId: meta.id,
        ...errorDiagnostic(err),
      })
      toast.error("打开工作流失败，请重试")
    })
  }

  const handleConfirmRun = async (params: Record<string, unknown>, nextLastValues: WorkflowLastRunValues) => {
    if (!runTarget) return
    const def = runTarget
    setRunningId(def.id)
    try {
      const workflowApi = requireBridgeDomain("workflow")
      trackWorkflowRunSubmit(def, params, false)
      const result = await workflowApi.runDefinition(def, params)
      if ("errors" in result) {
        const errors = result.errors as { message?: string }[]
        toast.error(errors[0]?.message ?? "工作流校验失败")
        return
      }
      if ("conflict" in result) {
        setConflictState({ def, params, lastValues: nextLastValues })
        setRunTarget(null)
        return
      }
      setLastRunValues((prev) => ({ ...prev, [def.id]: nextLastValues }))
      openRunner(workflowApi, def.id, result.runId)
      setRunTarget(null)
      void refresh()
    } catch (err) {
      showRunFailure(def, params, false, err)
    } finally {
      setRunningId(null)
    }
  }

  const handleForceRun = async () => {
    if (!conflictState) return
    const { def, params, lastValues } = conflictState
    setConflictState(null)
    setRunningId(def.id)
    try {
      const workflowApi = requireBridgeDomain("workflow")
      trackWorkflowRunSubmit(def, params, true)
      const forceResult = await workflowApi.runDefinition(def, params, true)
      if ("errors" in forceResult) {
        const errors = forceResult.errors as Array<{ message?: string }>
        toast.error(errors[0]?.message ?? "运行失败：校验未通过")
        return
      }
      if ("conflict" in forceResult) {
        toast.error("仍有运行中的实例，请先取消")
        return
      }
      if (lastValues) setLastRunValues((prev) => ({ ...prev, [def.id]: lastValues }))
      openRunner(workflowApi, def.id, forceResult.runId)
      void refresh()
    } catch (err) {
      showRunFailure(def, params, true, err)
    } finally {
      setRunningId(null)
    }
  }

  if (loading) return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-center">
          <Loader2 className="size-10 animate-spin text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">加载中…</p>
        </div>
      </div>
    </div>
  )
  if (error) return (
    <div className="flex flex-col gap-3 p-4">
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription className="text-xs">{error}</AlertDescription>
      </Alert>
      <Button size="sm" variant="outline" onClick={refresh}>
        <RefreshCw data-icon="inline-start" />重试
      </Button>
    </div>
  )
  if (items.length === 0 && migrationDiagnostics.length === 0) return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <FileJson className="size-10 text-muted-foreground/50" />
        <EmptyTitle>暂无工作流</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" variant="outline" onClick={onCreate}>
          <Plus data-icon="inline-start" />创建第一个工作流
        </Button>
      </EmptyContent>
    </Empty>
  )

  return (
    <>
      <ModuleContentPanel>
        <Table className="min-w-[52rem] table-fixed">
          <colgroup>
            <col className="w-auto" />
            <col className="w-24" />
            <col className="w-28" />
            <col className="w-24" />
            <col className="w-40" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>工作流</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">节点</TableHead>
              <TableHead>ID</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((meta) => (
              <WorkflowCard key={meta.id} meta={meta}
                runState={runStates[meta.id]}
                running={runningId !== null}
                onOpen={() => handleOpen(meta)}
                onRun={() => void handleRun(meta.id)}
                onOpenActiveRun={(runId) => handleOpenActiveRun(meta.id, runId)}
                onHistory={() => setHistoryWorkflowId(meta.id)}
                onExport={() => void handleExport(meta.id, meta.name)}
                onDelete={() => void handleDelete(meta.id)} />
            ))}
            {migrationDiagnostics.map((diagnostic) => (
              <TableRow
                key={diagnostic.id}
                className="cursor-pointer"
                onClick={() => setMigrationDiagnostic(diagnostic)}
              >
                <TableCell className="font-medium">旧仓库工作流</TableCell>
                <TableCell>
                  <Badge variant="destructive">{MIGRATION_DIAGNOSTIC_DISPLAY[diagnostic.status].label}</Badge>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                <TableCell>
                  <CopyIdButton id={diagnostic.workflowId} kind="workflow" />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="查看恢复诊断"
                    onClick={(event) => {
                      event.stopPropagation()
                      setMigrationDiagnostic(diagnostic)
                    }}
                  >
                    <Info />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ModuleContentPanel>
      <AlertDialog
        open={protectedWorkflow !== null}
        onOpenChange={(open) => { if (!open) setProtectedWorkflow(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>无法打开工作流</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">{protectedWorkflow?.loadError}</span>
              {protectedWorkflow?.rawExportAvailable ? (
                <span className="block">可导出原文备份，并在兼容版本中处理。</span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>关闭</AlertDialogCancel>
            {protectedWorkflow?.rawExportAvailable ? (
              <AlertDialogAction
                onClick={() => {
                  const target = protectedWorkflow
                  setProtectedWorkflow(null)
                  if (target) void handleExport(target.id, target.name)
                }}
              >
                导出原文
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={migrationDiagnostic !== null}
        onOpenChange={(open) => { if (!open) setMigrationDiagnostic(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>旧工作流未恢复</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              {migrationDiagnostic ? (
                <>
                  <span className="block">{MIGRATION_DIAGNOSTIC_DISPLAY[migrationDiagnostic.status].message}</span>
                  {migrationDiagnostic.errorMessage ? <span className="block">详情：{migrationDiagnostic.errorMessage}</span> : null}
                  <span className="block">{MIGRATION_DIAGNOSTIC_DISPLAY[migrationDiagnostic.status].recovery}</span>
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>关闭</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RunParamsDialog
        open={!!runTarget}
        workflowId={runTarget?.id ?? ""}
        params={runTarget?.params ?? []}
        lastValues={runTarget ? lastRunValues[runTarget.id] : undefined}
        onConfirm={async (params, rawValues) => {
          if (!runTarget) return
          const nextValues = createWorkflowLastRunValues(runTarget.params, rawValues)
          await handleConfirmRun(params, nextValues).catch(() => {})
        }}
        onCancel={() => setRunTarget(null)}
      />
      <RunHistoryDialog open={!!historyWorkflowId} workflowId={historyWorkflowId ?? ""} onClose={() => setHistoryWorkflowId(null)} />
      <AlertDialog open={!!conflictState} onOpenChange={(o) => { if (!o) setConflictState(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>运行冲突</AlertDialogTitle>
            <AlertDialogDescription>该工作流有正在执行的运行，是否取消并启动新运行？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button onClick={() => void handleForceRun()}>取消旧运行并启动</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function trackWorkflowRunSubmit(
  def: WorkflowDefinition,
  params: Record<string, unknown>,
  force: boolean,
): void {
  const paramCount = Object.keys(params).length
  track({
    component: "workflow",
    name: "workflow-list-run-submit",
    action: "submit",
    metadata: {
      boundary: "renderer.workflow.list.run-submit",
      workflowId: def.id,
      source: "workflow-list",
      force,
      paramCount,
      hasParams: paramCount > 0,
    },
  })
}

function showRunFailure(
  def: Pick<WorkflowDefinition, "id">,
  params: Record<string, unknown>,
  force: boolean,
  error: unknown,
): void {
  logger.warn("Workflow list run failed.", {
    boundary: "renderer.workflow.list.run",
    workflowId: def.id,
    force,
    paramCount: Object.keys(params).length,
    ...errorDiagnostic(error),
  })
  toast.error("运行失败，请重试")
}
