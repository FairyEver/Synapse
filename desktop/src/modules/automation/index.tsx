import { useState } from "react"
import { LoaderCircle, Plus, RefreshCw } from "lucide-react"

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
import type { AutomationCreateInput, AutomationItem, AutomationRun, AutomationUpdateInput } from "@/types/automation"
import { AutomationCardGrid } from "./components/automation-card-grid"
import { AutomationFormDialog } from "./components/automation-form-dialog"
import { AutomationRunsDialog } from "./components/automation-runs-dialog"
import type { AutomationFormDialogState } from "./types"
import {
  createAutomation,
  deleteAutomation,
  runAutomation,
  setAutomationEnabled,
  stopAutomationRun,
  updateAutomation,
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
  const [formState, setFormState] = useState<AutomationFormDialogState>({ mode: "create" })
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [historyItem, setHistoryItem] = useState<AutomationItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AutomationItem | null>(null)
  const [busy, setBusy] = useState(false)
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

  async function handleCreate(input: AutomationCreateInput) {
    const result = await runMutation(
      async () => {
        const item = await createAutomation(input)
        logger.info("Automation created.", { automationId: item.id, automationNameLength: item.name.length })
        return item
      },
      { loading: "正在保存自动化...", success: "自动化已保存。", error: "保存自动化失败。" },
    )
    if (!result) throw new Error("保存自动化失败。")
  }

  async function handleUpdate(id: string, patch: AutomationUpdateInput) {
    const result = await runMutation(
      async () => {
        const item = await updateAutomation(id, patch)
        logger.info("Automation updated.", { automationId: item.id, automationNameLength: item.name.length })
        return item
      },
      { loading: "正在保存自动化...", success: "自动化已保存。", error: "保存自动化失败。" },
    )
    if (!result) throw new Error("保存自动化失败。")
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
      <AutomationCardGrid
        items={items}
        projects={projects}
        busy={busy}
        runningItemIds={runningItemIds}
        onRun={(item) => { void handleRun(item) }}
        onStop={(item) => { void handleStop(item) }}
        onToggleEnabled={(item, enabled) => { void handleToggleEnabled(item, enabled) }}
        onEdit={(item) => {
          setFormState({ mode: "edit", item })
          setIsFormOpen(true)
        }}
        onHistory={setHistoryItem}
        onDelete={setDeleteTarget}
        onCreateNew={() => {
          setFormState({ mode: "create" })
          setIsFormOpen(true)
        }}
      />
    )
  })()

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h1 className="text-base font-semibold">自动化</h1>
          <div className="flex items-center gap-1">
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
              disabled={busy}
              onClick={() => {
                setFormState({ mode: "create" })
                setIsFormOpen(true)
              }}
            >
              <Plus />
              新建自动化
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1 overscroll-contain">
          <div className="p-4">{content}</div>
        </ScrollArea>

        <AutomationFormDialog
          open={isFormOpen}
          state={formState}
          busy={busy}
          onOpenChange={setIsFormOpen}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />

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
