import { useEffect, useRef, useState, type MouseEvent } from "react"
import { AlertCircle, Plus, RefreshCw } from "lucide-react"

import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { ModulePage } from "@/components/module-page"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"
import { shouldBypassDeleteConfirm } from "@/lib/delete-confirm-bypass"
import { errorLogMeta } from "@/lib/error-sanitize"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import type { AutomationItem, AutomationRun, AutomationStopRunResult } from "@/types/automation"
import { AutomationList } from "./components/automation-list"
import { AutomationEditorForm } from "./editor/editor-form"
import { AutomationDetail } from "./detail/automation-detail"
import type { AutomationEditorMode, AutomationEditorSession, AutomationEditorStep } from "./types"
import { useAutomationDraftGuard } from "./hooks/use-automation-draft-guard"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  deleteAutomation,
  runAutomation,
  setAutomationEnabled,
  stopAutomationRun,
  useAutomationItems,
} from "./hooks/use-automation"

const logger = createRendererLogger("automation")

type AcceptedManualRun = AutomationRun & {
  status: Extract<AutomationRun["status"], "running" | "success">
}

const ALREADY_RUNNING_SKIP_REASON = "automation is already running"
const ALREADY_RUNNING_MESSAGE = "自动化正在运行中"

class AutomationRunCancelledError extends Error {
  readonly run: AutomationRun

  constructor(run: AutomationRun) {
    super("Automation run was cancelled")
    this.name = "AutomationRunCancelledError"
    this.run = run
  }
}

class AutomationRunSkippedError extends Error {
  readonly run: AutomationRun

  constructor(run: AutomationRun, message: string) {
    super(message)
    this.name = "AutomationRunSkippedError"
    this.run = run
  }
}

function isAcceptedManualRun(run: AutomationRun | null): run is AcceptedManualRun {
  return run !== null && (run.status === "running" || run.status === "success")
}

function isAutomationRunCancelledError(error: unknown): error is AutomationRunCancelledError {
  return error instanceof AutomationRunCancelledError
}

function isAutomationRunSkippedError(error: unknown): error is AutomationRunSkippedError {
  return error instanceof AutomationRunSkippedError
}

function getSkippedManualRunMessage(run: AutomationRun): string | null {
  if (run.status === "skipped" && run.error === ALREADY_RUNNING_SKIP_REASON) {
    return ALREADY_RUNNING_MESSAGE
  }
  return null
}

function AutomationModule() {
  const { config } = useAppConfig()
  const projects = config.global.projects
  const { items, loading, error, refresh } = useAutomationItems()
  const { promise } = useAppNotifications()
  const [deleteTarget, setDeleteTarget] = useState<AutomationItem | null>(null)
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null)
  const deleteSucceededRef = useRef(false)
  const deleteFallbackFocusRef = useRef<HTMLButtonElement | null>(null)
  const wasDeleteOpenRef = useRef(false)
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(() => new Set())
  const [editor, setEditor] = useState<{ mode: AutomationEditorMode; step?: AutomationEditorStep; session?: AutomationEditorSession } | null>(null)
  const [detail, setDetail] = useState<{ item: AutomationItem; tab: "config" | "history"; missing?: boolean } | null>(null)
  const [draftSessions, setDraftSessions] = useState<Record<string, AutomationEditorSession>>({})
  const draftGuard = useAutomationDraftGuard(Object.keys(draftSessions).length > 0, () => setDraftSessions({}))
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const returnTarget = useRef<string | null>(null)

  useEffect(() => {
    if (editor || detail || !returnTarget.current) return
    const target = returnTarget.current
    returnTarget.current = null
    if (target === "create") deleteFallbackFocusRef.current?.focus()
    else Array.from(document.querySelectorAll<HTMLElement>("[data-automation-id]")).find(row => row.dataset.automationId === target)?.querySelector<HTMLButtonElement>("button")?.focus()
  }, [editor, detail])

  useEffect(() => {
    setDetail(current => {
      if (!current) return current
      const item = items.find(candidate => candidate.id === current.item.id)
      return item ? { ...current, item, missing: false } : { ...current, missing: true }
    })
  }, [items])
  const [runningItemIds, setRunningItemIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const open = Boolean(deleteTarget)
    if (wasDeleteOpenRef.current && !open && !deleteSucceededRef.current) {
      deleteReturnFocusRef.current?.focus()
    }
    wasDeleteOpenRef.current = open
  }, [deleteTarget])

  async function runItemMutation<T>(
    itemId: string,
    operation: () => Promise<T>,
    messages: {
      trackingName: string
      loading: string
      success: string
      error: string
    },
  ): Promise<T | null> {
    setPendingItemIds((current) => new Set([...current, itemId]))
    try {
      const result = await promise(operation, messages)
      await refresh()
      return result
    } catch (mutationError) {
      logger.error("Automation mutation failed.", {
        boundary: "renderer.automation.mutation",
        ...errorLogMeta(mutationError),
      })
      return null
    } finally {
      setPendingItemIds((current) => {
        const next = new Set(current)
        next.delete(itemId)
        return next
      })
    }
  }

  async function deleteItem(item: AutomationItem): Promise<boolean> {
    if (item.activeRun?.status === "running") return false
    const result = await runItemMutation(
      item.id,
      async () => {
        const deleted = await deleteAutomation(item.id)
        logger.info("Automation deleted.", { automationId: item.id, automationNameLength: item.name.length })
        return deleted
      },
      { trackingName: "automation.delete", loading: "正在删除自动化...", success: "自动化已删除。", error: "删除自动化失败。" },
    )
    return result !== null
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const deleted = await deleteItem(deleteTarget)
    if (deleted) {
      deleteSucceededRef.current = true
      setDeleteTarget(null)
    }
  }

  function handleDeleteStart(item: AutomationItem, event: MouseEvent<HTMLElement>) {
    if (item.activeRun?.status === "running") return
    if (shouldBypassDeleteConfirm(event)) {
      void deleteItem(item)
      return
    }
    deleteReturnFocusRef.current = event.currentTarget
    setDeleteTarget(item)
  }

  async function handleToggleEnabled(item: AutomationItem, enabled: boolean) {
    await runItemMutation(
      item.id,
      async () => {
        const updated = await setAutomationEnabled(item.id, enabled)
        logger.info("Automation enabled state changed.", { automationId: item.id, enabled })
        return updated
      },
      {
        trackingName: enabled ? "automation.enable" : "automation.disable",
        loading: enabled ? "正在启用自动化..." : "正在停用自动化...",
        success: enabled ? "自动化已启用。" : "自动化已停用。",
        error: enabled ? "启用自动化失败。" : "停用自动化失败。",
      },
    )
  }

  async function handleRun(item: AutomationItem) {
    setRunningItemIds((current) => new Set([...current, item.id]))
    try {
      const result = await promise(
        async () => {
          const run = await runAutomation(item.id)
          logger.info("Automation manual run requested.", { automationId: item.id, runId: run?.id })
          if (run?.status === "cancelled") throw new AutomationRunCancelledError(run)
          if (run?.status === "skipped") {
            const skippedMessage = getSkippedManualRunMessage(run)
            if (skippedMessage) throw new AutomationRunSkippedError(run, skippedMessage)
          }
          if (!isAcceptedManualRun(run)) throw new Error(run?.error ?? "运行未开始")
          return run
        },
        {
          trackingName: "automation.run",
          loading: "正在运行自动化...",
          success: "自动化已运行。",
          error: (runError) => {
            if (isAutomationRunCancelledError(runError)) return { message: null }
            if (isAutomationRunSkippedError(runError)) return runError.message
            return "运行自动化失败。"
          },
        },
      )
      await refresh()
      return result
    } catch (runError) {
      if (isAutomationRunCancelledError(runError)) {
        logger.info("Automation manual run stopped.", { automationId: item.id, runId: runError.run.id })
      } else if (isAutomationRunSkippedError(runError)) {
        logger.info("Automation manual run skipped.", {
          automationId: item.id,
          runId: runError.run.id,
          status: runError.run.status,
          reasonLength: runError.run.error?.length ?? 0,
        })
      } else {
        logger.error("Automation mutation failed.", {
          boundary: "renderer.automation.mutation",
          ...errorLogMeta(runError),
        })
      }
      await refresh()
      return null
    } finally {
      setRunningItemIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  async function handleStop(item: AutomationItem) {
    const runId = item.activeRun?.id
    if (!runId) return
    try {
      await promise(
        () => stopRunOrThrow(runId),
        {
          trackingName: "automation.stop",
          loading: "正在停止自动化...",
          success: (result) => result.stopRequested ? "停止请求已发送。" : "自动化已停止。",
          error: "停止自动化失败。",
        },
      )
      logger.info("Automation stop requested.", { automationId: item.id, runId })
      await refresh()
    } catch (stopError) {
      logger.warn("Automation stop failed.", {
        boundary: "renderer.automation.stop",
        automationId: item.id,
        runId,
        ...errorLogMeta(stopError),
      })
    }
  }

  async function stopRunOrThrow(runId: string): Promise<AutomationStopRunResult> {
    const result = await stopAutomationRun(runId)
    if (!result.stopped && !result.alreadyFinished && !result.stopRequested) {
      throw new Error("Automation run was not active")
    }
    return result
  }

  function resumeSession(key: string) {
    const session = draftSessions[key]
    if (session) setDraftSessions(current => { const next = { ...current }; delete next[key]; return next })
    return session
  }

  function handleCreateEditorOpen() {
    returnTarget.current = "create"
    setEditor({ mode: { mode: "create" }, session: resumeSession("create") })
  }

  function handleEditorOpen(item: AutomationItem, step?: AutomationEditorStep) {
    returnTarget.current = item.id
    setEditor({ mode: { mode: "edit", automationId: item.id }, step, session: resumeSession(item.id) })
  }

  function handleDetailOpen(item: AutomationItem, tab: "config" | "history" = "config") {
    returnTarget.current = item.id
    setDetail({ item, tab })
  }

  const content = (() => {
    if (loading) {
      return (
        <div className="rounded-lg border bg-background">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_9rem_6rem_4rem_9rem] gap-3 border-b px-3 py-2 text-sm">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-16 justify-self-end" />
            <Skeleton className="h-4 w-12 justify-self-end" />
            <Skeleton className="h-4 w-10 justify-self-end" />
            <Skeleton className="h-4 w-12 justify-self-end" />
          </div>
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="grid grid-cols-[minmax(0,1fr)_6rem_9rem_6rem_4rem_9rem] items-center gap-3 border-b px-3 py-3 last:border-b-0"
            >
              <div className="min-w-0 flex flex-col gap-2">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-4 w-24 justify-self-end" />
              <Skeleton className="h-4 w-16 justify-self-end" />
              <Skeleton className="h-5 w-9 justify-self-end" />
              <Skeleton className="h-8 w-28 justify-self-end" />
            </div>
          ))}
        </div>
      )
    }
    if (error) {
      return (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertCircle />
            </EmptyMedia>
            <EmptyTitle>{error}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button size="default" variant="outline" onClick={() => { void refresh() }}>
              <RefreshCw data-icon="inline-start" />
              重试
            </Button>
          </EmptyContent>
        </Empty>
      )
    }
    return (
      <AutomationList
        items={items.filter((item) => (
          (filter === "all" || (filter === "enabled" ? item.enabled : !item.enabled)) &&
          item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
        ))}
        projects={projects}
        createDisabled={false}
        pendingItemIds={pendingItemIds}
        runningItemIds={runningItemIds}
        onOpen={handleDetailOpen}
        onEdit={handleEditorOpen}
        onRun={(item) => { void handleRun(item) }}
        onStop={(item) => { void handleStop(item) }}
        onToggleEnabled={(item, enabled) => { void handleToggleEnabled(item, enabled) }}
        onHistory={(item) => handleDetailOpen(item, "history")}
        filtered={Boolean(search.trim() || filter !== "all")}
        onClearFilter={() => { setSearch(""); setFilter("all") }}
        onDelete={handleDeleteStart}
        onCreateNew={() => { void handleCreateEditorOpen() }}
      />
    )
  })()

  const draftLeavePrompt = draftGuard.leaving ? (
    <div role="region" aria-label="未保存的草稿" className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted px-5 py-3">
      <p className="text-sm">还有未保存的草稿</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={draftGuard.keepDrafts}>保留草稿</Button>
        <Button variant="ghost" className="text-destructive" onClick={draftGuard.discardDrafts}>放弃草稿并离开</Button>
      </div>
    </div>
  ) : null

  if (editor) {
    return (
      <TooltipProvider>
        <div className="flex h-full min-h-0 flex-col">
          {draftLeavePrompt}
          <div className="min-h-0 flex-1">
        <AutomationEditorForm
          mode={editor.mode}
          initialSession={editor.session}
          initialStep={editor.step}
          onBack={(session) => {
            if (session) {
              setDraftSessions(current => ({ ...current, [session.item?.id ?? "create"]: session }))
              setDetail(null)
            }
            setEditor(null)
          }}
          onSaved={item => {
            returnTarget.current = item.id
            setDetail({ item, tab: "config" })
            setEditor(null)
            void refresh()
          }}
        />
          </div>
        </div>
      </TooltipProvider>
    )
  }

  if (detail) {
    return <TooltipProvider><div className="flex h-full min-h-0 flex-col">
      {draftLeavePrompt}
      <div className="min-h-0 flex-1"><AutomationDetail key={`${detail.item.id}:${detail.tab}`} item={detail.item} initialTab={detail.tab}
        missing={detail.missing} error={error} busy={pendingItemIds.has(detail.item.id)} onBack={() => setDetail(null)}
        onEdit={step => handleEditorOpen(detail.item, step)} onToggleEnabled={enabled => { void handleToggleEnabled(detail.item, enabled) }}
        onRefresh={() => { void refresh() }} onStopRun={async runId => { await stopRunOrThrow(runId) }} /></div>
    </div></TooltipProvider>
  }

  return (
    <TooltipProvider>
      <ModulePage
        title="自动化"
        actions={(
          <>
            <SystemAppTopBarActionButton
              iconOnly
              type="button"
              disabled={loading}
              aria-label="刷新"
              tooltip="刷新"
              onClick={() => { void refresh() }}
            >
              <RefreshCw className="size-4" />
            </SystemAppTopBarActionButton>
            <SystemAppTopBarActionButton
              ref={deleteFallbackFocusRef}
              type="button"
              disabled={loading}
              onClick={() => { void handleCreateEditorOpen() }}
            >
              <Plus />
              新建
            </SystemAppTopBarActionButton>
          </>
        )}
        afterContent={(
          <>
            <AlertDialog
              open={Boolean(deleteTarget)}
              onOpenChange={(open) => {
                if (!open) setDeleteTarget(null)
              }}
            >
              <AlertDialogContent
                onCloseAutoFocus={(event) => {
                  event.preventDefault()
                  const focusTarget = deleteSucceededRef.current
                    ? deleteFallbackFocusRef.current
                    : deleteReturnFocusRef.current
                  deleteSucceededRef.current = false
                  focusTarget?.focus()
                }}
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>删除自动化</AlertDialogTitle>
                  <AlertDialogDescription>
                    删除后无法恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={Boolean(deleteTarget && pendingItemIds.has(deleteTarget.id)) ||
                      deleteTarget?.activeRun?.status === "running"}
                    onClick={(event) => {
                      event.preventDefault()
                      void handleDelete()
                    }}
                  >
                    删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      >
        {draftLeavePrompt}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList aria-label="自动化状态筛选">
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="enabled">已启用</TabsTrigger>
              <TabsTrigger value="disabled">已停用</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input aria-label="搜索自动化" placeholder="搜索自动化" value={search} className="w-full sm:w-60" onChange={(event) => setSearch(event.target.value)} />
        </div>
        {Object.entries(draftSessions).map(([key, draftSession]) => (
          <div key={key} className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-dashed bg-background px-4 py-3">
            <div className="min-w-0"><p className="truncate text-sm font-medium">{draftSession.draft.name}</p><p className="text-xs text-muted-foreground">未保存草稿 · 本次会话</p></div>
            <Button variant="outline" onClick={() => {
              returnTarget.current = draftSession.item?.id ?? "create"
              setEditor({ mode: draftSession.item ? { mode: "edit", automationId: draftSession.item.id } : { mode: "create" }, session: draftSession })
              resumeSession(key)
            }}>继续编辑</Button>
          </div>
        ))}
        {content}
      </ModulePage>
    </TooltipProvider>
  )
}

export { AutomationModule }
