import { useEffect, useRef, useState, type MouseEvent } from "react"
import { AlertCircle, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"

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
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { runTrackedOperation } from "@/lib/ui-tracking"
import { shouldBypassDeleteConfirm } from "@/lib/delete-confirm-bypass"
import { errorLogMeta } from "@/lib/error-sanitize"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import type { AutomationItem, AutomationRun, AutomationStopRunResult } from "@/types/automation"
import { AutomationList } from "./components/automation-list"
import { AutomationRunsDialog } from "./components/automation-runs-dialog"
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
  const [historyItem, setHistoryItem] = useState<AutomationItem | null>(null)
  const historyReturnFocusRef = useRef<HTMLElement | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AutomationItem | null>(null)
  const deleteReturnFocusRef = useRef<HTMLElement | null>(null)
  const deleteSucceededRef = useRef(false)
  const deleteFallbackFocusRef = useRef<HTMLButtonElement | null>(null)
  const wasDeleteOpenRef = useRef(false)
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(() => new Set())
  const [openingEditor, setOpeningEditor] = useState(false)
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

  async function handleCreateEditorOpen() {
    if (openingEditor) return
    setOpeningEditor(true)
    try {
      await runTrackedOperation(
        { component: "automation", eventKey: "automation.editor.create-open" },
        () => requireBridgeDomain("automation").editor.openCreate(),
      )
    } catch (openError) {
      logger.warn("Automation create editor open failed.", {
        boundary: "renderer.automation.open-create-editor",
        ...errorLogMeta(openError),
      })
      toast.error("打开自动化失败，请重试")
    } finally {
      setOpeningEditor(false)
    }
  }

  async function handleEditorOpen(item: AutomationItem) {
    try {
      await runTrackedOperation(
        { component: "automation", eventKey: "automation.editor.edit-open" },
        () => requireBridgeDomain("automation").editor.openEdit(item.id),
      )
    } catch (openError) {
      logger.warn("Automation editor open failed.", {
        boundary: "renderer.automation.open-editor",
        automationId: item.id,
        ...errorLogMeta(openError),
      })
      toast.error("打开自动化失败，请重试")
    }
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
            <Button size="sm" variant="outline" onClick={() => { void refresh() }}>
              <RefreshCw data-icon="inline-start" />
              重试
            </Button>
          </EmptyContent>
        </Empty>
      )
    }
    return (
      <AutomationList
        items={items}
        projects={projects}
        createDisabled={openingEditor}
        pendingItemIds={pendingItemIds}
        runningItemIds={runningItemIds}
        onOpen={(item) => { void handleEditorOpen(item) }}
        onRun={(item) => { void handleRun(item) }}
        onStop={(item) => { void handleStop(item) }}
        onToggleEnabled={(item, enabled) => { void handleToggleEnabled(item, enabled) }}
        onHistory={(item, event) => {
          historyReturnFocusRef.current = event.currentTarget
          setHistoryItem(item)
        }}
        onDelete={handleDeleteStart}
        onCreateNew={() => { void handleCreateEditorOpen() }}
      />
    )
  })()

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
              disabled={openingEditor}
              onClick={() => { void handleCreateEditorOpen() }}
            >
              <Plus />
              新建
            </SystemAppTopBarActionButton>
          </>
        )}
        afterContent={(
          <>
            <AutomationRunsDialog
              open={Boolean(historyItem)}
              item={historyItem}
              busy={Boolean(historyItem && pendingItemIds.has(historyItem.id))}
              returnFocusRef={historyReturnFocusRef}
              onOpenChange={(open) => {
                if (!open) setHistoryItem(null)
              }}
              onStopRun={async (runId) => {
                await stopRunOrThrow(runId)
              }}
            />

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
        {content}
      </ModulePage>
    </TooltipProvider>
  )
}

export { AutomationModule }
