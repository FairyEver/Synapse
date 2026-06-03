import { useState } from "react"
import { LoaderCircle, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type { AutomationItem, AutomationRun } from "@/types/automation"
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

function isAcceptedManualRun(run: AutomationRun | null): run is AcceptedManualRun {
  return run !== null && (run.status === "running" || run.status === "success")
}

function AutomationModule() {
  const { config } = useAppConfig()
  const projects = config.global.projects
  const { items, loading, error, refresh } = useAutomationItems()
  const { promise } = useAppNotifications()
  const [historyItem, setHistoryItem] = useState<AutomationItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AutomationItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [openingEditor, setOpeningEditor] = useState(false)
  const [runningItemIds, setRunningItemIds] = useState<Set<string>>(() => new Set())

  async function runMutation<T>(
    operation: () => Promise<T>,
    messages: {
      loading: string
      success: string
      error: string
    },
  ): Promise<T | null> {
    try {
      setBusy(true)
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
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleteTarget.activeRun?.status === "running") return
    const item = deleteTarget
    const result = await runMutation(
      async () => {
        const deleted = await deleteAutomation(item.id)
        logger.info("Automation deleted.", { automationId: item.id, automationNameLength: item.name.length })
        return deleted
      },
      { loading: "正在删除自动化...", success: "自动化已删除。", error: "删除自动化失败。" },
    )
    if (result !== null) setDeleteTarget(null)
  }

  async function handleToggleEnabled(item: AutomationItem, enabled: boolean) {
    await runMutation(
      async () => {
        const updated = await setAutomationEnabled(item.id, enabled)
        logger.info("Automation enabled state changed.", { automationId: item.id, enabled })
        return updated
      },
      {
        loading: enabled ? "正在启用自动化..." : "正在停用自动化...",
        success: enabled ? "自动化已启用。" : "自动化已停用。",
        error: enabled ? "启用自动化失败。" : "停用自动化失败。",
      },
    )
  }

  async function handleRun(item: AutomationItem) {
    setRunningItemIds((current) => new Set([...current, item.id]))
    const result = await runMutation(
      async () => {
        const run = await runAutomation(item.id)
        logger.info("Automation manual run requested.", { automationId: item.id, runId: run?.id })
        if (!isAcceptedManualRun(run)) throw new Error(run?.error ?? "运行未开始")
        return run
      },
      { loading: "正在运行自动化...", success: "自动化已运行。", error: "运行自动化失败。" },
    )
    setRunningItemIds((current) => {
      const next = new Set(current)
      next.delete(item.id)
      return next
    })
    return result
  }

  async function handleStop(item: AutomationItem) {
    const runId = item.activeRun?.id
    if (!runId) return
    await stopRunOrThrow(runId)
    await refresh()
  }

  async function stopRunOrThrow(runId: string): Promise<{ readonly stopped: boolean }> {
    const result = await stopAutomationRun(runId)
    if (!result.stopped) throw new Error("Automation run was not active")
    return result
  }

  async function handleCreateEditorOpen() {
    if (openingEditor) return
    setOpeningEditor(true)
    try {
      await requireBridgeDomain("automation").openCreateEditorWindow()
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
      await requireBridgeDomain("automation").openEditorWindow(item.id)
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
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          加载中
        </div>
      )
    }
    if (error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>{error}</p>
          <Button size="sm" variant="outline" onClick={() => { void refresh() }}>
            <RefreshCw />
            重试
          </Button>
        </div>
      )
    }
    return (
      <AutomationList
        items={items}
        projects={projects}
        busy={busy}
        runningItemIds={runningItemIds}
        onOpen={(item) => { void handleEditorOpen(item) }}
        onRun={(item) => { void handleRun(item) }}
        onStop={(item) => { void handleStop(item) }}
        onToggleEnabled={(item, enabled) => { void handleToggleEnabled(item, enabled) }}
        onHistory={setHistoryItem}
        onDelete={setDeleteTarget}
        onCreateNew={() => { void handleCreateEditorOpen() }}
      />
    )
  })()

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-2 py-2.5">
          <h2 className="text-sm font-semibold">自动化</h2>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={loading} onClick={() => { void refresh() }}>
                  <RefreshCw className="size-4" />
                  <span className="sr-only">刷新</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>刷新</TooltipContent>
            </Tooltip>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || openingEditor}
              onClick={() => { void handleCreateEditorOpen() }}
            >
              <Plus />
              新建
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="min-h-full px-2 pb-2 pt-0">{content}</div>
        </ScrollArea>

        <AutomationRunsDialog
          open={Boolean(historyItem)}
          item={historyItem}
          busy={busy}
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
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除自动化</AlertDialogTitle>
              <AlertDialogDescription>
                删除后无法恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy || deleteTarget?.activeRun?.status === "running"}
                onClick={() => { void handleDelete() }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  )
}

function errorLogMeta(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

export { AutomationModule }
