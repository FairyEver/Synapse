import { useState, type ReactNode } from "react"
import {
  Download,
  LoaderCircle,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react"

import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { cancelWatchNextAgentSession, requestWatchNextAgentSession } from "@/app-shell/navigation"
import { useAppNotifications } from "@/app-shell/notifications"
import { getRendererPlatform } from "@/lib/runtime-platform"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ScrollArea } from "@/components/ui/scroll-area"
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRun,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"
import { TaskCardGrid } from "./components/task-card-grid"
import { TaskFormDialog } from "./components/task-form-dialog"
import { TaskExportDialog } from "./components/task-export-dialog"
import { TaskImportDialog } from "./components/task-import-dialog"
import { TaskRunsDialog } from "./components/task-runs-dialog"
import type { TaskExportEntry, TaskFormDialogState } from "./types"
import {
  createTask,
  deleteTask,
  exportTasksToFile,
  importTasksFromFile,
  runTask,
  setTaskEnabled,
  stopRun,
  updateTask,
  useTaskSchedulerTasks,
} from "./hooks/use-task-scheduler"
import {
  parseTaskImportFile,
  serializeTasksForExport,
} from "./utils"

const logger = createRendererLogger("task-scheduler")

type AcceptedManualRun = ScheduledTaskRun & {
  status: Extract<ScheduledTaskRun["status"], "running" | "success">
}

function isAcceptedManualRun(run: ScheduledTaskRun | null): run is AcceptedManualRun {
  return run !== null && (run.status === "running" || run.status === "success")
}

function errorLogMeta(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

async function stopRunOrThrow(runId: string): Promise<{ readonly stopped: boolean }> {
  const result = await stopRun(runId)
  if (!result.stopped) throw new Error("Task run was not active")
  return result
}

function TaskSchedulerModule() {
  const { config } = useAppConfig()
  const platform = getRendererPlatform()
  const { tasks, loading, error, refresh } = useTaskSchedulerTasks()
  const { notify, promise } = useAppNotifications()
  const [formState, setFormState] = useState<TaskFormDialogState>({ mode: "create" })
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [historyTask, setHistoryTask] = useState<ScheduledTask | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [runningTaskIds, setRunningTaskIds] = useState<Set<string>>(() => new Set())
  const [isExportOpen, setIsExportOpen] = useState(false)
const [isExporting, setIsExporting] = useState(false)
  const [importEntries, setImportEntries] = useState<TaskExportEntry[] | null>(null)
  const [importing, setImporting] = useState(false)

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
      logger.error("Task scheduler mutation failed.", {
        boundary: "renderer.task-scheduler.mutation",
        ...errorLogMeta(mutationError),
      })
      return null
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(input: ScheduledTaskCreateInput) {
    const result = await runMutation(
      async () => {
        const task = await createTask(input)
        logger.info("Task created.", { taskId: task.id, taskNameLength: task.name.length })
        return task
      },
      { loading: "正在保存任务...", success: "任务已保存。", error: "保存任务失败。" },
    )
    if (!result) throw new Error("保存任务失败。")
  }

  async function handleUpdate(id: string, patch: ScheduledTaskUpdateInput) {
    const result = await runMutation(
      async () => {
        const task = await updateTask(id, patch)
        logger.info("Task updated.", { taskId: task.id, taskNameLength: task.name.length })
        return task
      },
      { loading: "正在保存任务...", success: "任务已保存。", error: "保存任务失败。" },
    )
    if (!result) throw new Error("保存任务失败。")
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    const task = deleteTarget
    if (task.activeRun?.status === "running") {
      return
    }
    const result = await runMutation(
      async () => {
        const result = await deleteTask(task.id)
        logger.info("Task deleted.", { taskId: task.id, taskNameLength: task.name.length })
        return result
      },
      { loading: "正在删除任务...", success: "任务已删除。", error: "删除任务失败。" },
    )
    if (result !== null) {
      setDeleteTarget(null)
    }
  }

  async function handleExport(selectedIds: string[]) {
    setIsExporting(true)
    try {
      const selectedTasks = tasks.filter((t) => selectedIds.includes(t.id))
      const exportData = serializeTasksForExport(selectedTasks)
      const json = JSON.stringify(exportData, null, 2)
      const result = await exportTasksToFile(json)
      if (result.success) {
        setIsExportOpen(false)
        notify({ message: "任务已导出。", tone: "success" })
      }
    } catch (exportError) {
      const selectedTasks = tasks.filter((t) => selectedIds.includes(t.id))
      logger.warn("Task export failed.", {
        action: "exportTasks",
        boundary: "renderer.task-scheduler.export",
        selectedCount: selectedTasks.length,
        agentTaskCount: selectedTasks.filter((task) => task.action.type === "builtin.agent").length,
        actionTypes: [...new Set(selectedTasks.map((task) => task.action.type))],
        triggerTypes: [...new Set(selectedTasks.map((task) => task.trigger.type))],
        ...errorLogMeta(exportError),
      })
      notify({ message: "导出失败", tone: "destructive" })
    } finally {
      setIsExporting(false)
    }
  }

  async function handleImportStart() {
    let content: string | undefined
    try {
      const result = await importTasksFromFile()
      if (!result.success || !result.content) return
      content = result.content
    } catch (importError) {
      logger.warn("Task import failed.", {
        action: "importTasks",
        boundary: "renderer.task-scheduler.import.read",
        ...errorLogMeta(importError),
      })
      notify({ message: "导入失败", tone: "destructive" })
      return
    }

    try {
      const parsed = parseTaskImportFile(content)
      setImportEntries(parsed.tasks)
    } catch (importError) {
      logger.warn("Task import parse failed.", {
        action: "importTasks",
        boundary: "renderer.task-scheduler.import.parse",
        contentLength: content.length,
        ...errorLogMeta(importError),
      })
      notify({ message: "导入失败", tone: "destructive" })
    }
  }

  async function handleImport(indices: number[]) {
    if (!importEntries) return
    const selected = indices.map((i) => importEntries[i])
    let successCount = 0
    let failCount = 0
    for (const [entryIndex, entry] of selected.entries()) {
      try {
        await createTask({
          name: entry.name,
          description: entry.description,
          scope: entry.scope,
          cwd: entry.cwd,
          trigger: entry.trigger,
          action: entry.action,
          enabled: false,
          activeDays: entry.activeDays,
          missedRunPolicy: entry.missedRunPolicy,
        })
        successCount++
      } catch (importError) {
        logger.warn("Task import entry create failed.", {
          action: "importTasks",
          boundary: "renderer.task-scheduler.import.create",
          selectedCount: selected.length,
          entryIndex,
          actionType: entry.action.type,
          taskNameLength: entry.name.length,
          ...errorLogMeta(importError),
        })
        failCount++
      }
    }
    setImportEntries(null)
    await refresh()
    const msg = failCount > 0
      ? `已导入 ${successCount} 个任务，${failCount} 个失败`
      : `已导入 ${successCount} 个任务`
    void promise(
      () => Promise.resolve(null),
      { loading: "", success: msg, error: "" },
    )
  }

  async function handleRunTask(task: ScheduledTask) {
    if (runningTaskIds.has(task.id)) return
    setRunningTaskIds((prev) => new Set(prev).add(task.id))
    const agentProjectId = task.action.type === "builtin.agent"
      ? task.action.config["projectId"]
      : undefined
    const agentSessionWatch = typeof agentProjectId === "string" && agentProjectId.length > 0
      ? {
          projectId: agentProjectId,
          platform: "scheduled",
          sessionKeyPrefix: `scheduled:${agentProjectId}:`,
        }
      : null
    try {
      if (agentSessionWatch) {
        requestWatchNextAgentSession(agentSessionWatch)
      }
      const run = await runTask(task.id)
      if (!isAcceptedManualRun(run)) {
        if (agentSessionWatch) {
          cancelWatchNextAgentSession(agentSessionWatch)
        }
        logger.warn("Task run was not accepted.", {
          action: "runTask",
          boundary: "renderer.task-scheduler.runTask",
          taskId: task.id,
          taskNameLength: task.name.length,
          actionType: task.action.type,
          runId: run?.id,
          runStatus: run?.status ?? "missing",
        })
        notify({ message: "触发失败", tone: "destructive" })
        return
      }
      logger.info("Task run triggered.", {
        taskId: task.id,
        taskNameLength: task.name.length,
        actionType: task.action.type,
        runId: run?.id,
        runStatus: run?.status,
      })
      notify({ message: "任务已触发", tone: "success" })
    } catch (err) {
      if (agentSessionWatch) {
        cancelWatchNextAgentSession(agentSessionWatch)
      }
      logger.error("Failed to run task.", {
        action: "runTask",
        boundary: "renderer.task-scheduler.runTask",
        taskId: task.id,
        taskNameLength: task.name.length,
        actionType: task.action.type,
        ...errorLogMeta(err),
      })
      notify({ message: "触发失败", tone: "destructive" })
    } finally {
      setRunningTaskIds((prev) => {
        const next = new Set(prev)
        next.delete(task.id)
        return next
      })
    }
  }

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-2 py-2.5">
          <div className="flex items-center gap-2">
            <IconButton
              label="刷新"
              onClick={() => {
                void refresh()
              }}
            >
              <RefreshCw />
            </IconButton>
            <IconButton
              label="导入"
              onClick={() => void handleImportStart()}
            >
              <Upload />
            </IconButton>
            <IconButton
              label="导出"
              disabled={tasks.length === 0}
              onClick={() => setIsExportOpen(true)}
            >
              <Download />
            </IconButton>
            <Button
              onClick={() => {
                setFormState({ mode: "create" })
                setIsFormOpen(true)
              }}
            >
              <Plus />
              新建任务
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1 overscroll-contain">
          <div className="min-h-full px-2 pb-2 pt-0">
            {error && !loading ? (
              <div className="flex items-center gap-2 p-4">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={() => void refresh()}>
                  重试
                </Button>
              </div>
            ) : null}
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                加载中
              </div>
            ) : null}
            {!loading && !error ? (
              <TaskCardGrid
                busy={busy}
                runningTaskIds={runningTaskIds}
                projects={config.global.projects}
                tasks={tasks}
                onCreateNew={() => {
                  setFormState({ mode: "create" })
                  setIsFormOpen(true)
                }}
                onDelete={(task) => setDeleteTarget(task)}
                onEdit={(task) => {
                  setFormState({ mode: "edit", task })
                  setIsFormOpen(true)
                }}
                onHistory={(task) => setHistoryTask(task)}
                onRun={(task) => {
                  void handleRunTask(task)
                }}
                onStop={(task) => {
                  const runId = task.activeRun?.id
                  if (!runId) return
                  void runMutation(
                    () => stopRunOrThrow(runId),
                    { loading: "正在停止运行...", success: "运行已停止。", error: "停止运行失败。" },
                  )
                }}
                onToggleEnabled={(task, enabled) => {
                  void runMutation(
                    () => setTaskEnabled(task.id, enabled),
                    {
                      loading: enabled ? "正在启用任务..." : "正在停用任务...",
                      success: enabled ? "任务已启用。" : "任务已停用。",
                      error: "更新任务失败。",
                    },
                  )
                }}
              />
            ) : null}
          </div>
        </ScrollArea>

        <TaskFormDialog
          busy={busy}
          open={isFormOpen}
          platform={platform}
          projects={config.global.projects}
          state={formState}
          onCreate={handleCreate}
          onOpenChange={setIsFormOpen}
          onUpdate={handleUpdate}
        />

        <TaskRunsDialog
          busy={busy}
          open={historyTask !== null}
          task={historyTask}
          onOpenChange={(open) => {
            if (!open) {
              setHistoryTask(null)
            }
          }}
          onStopRun={async (runId) => {
            const result = await runMutation(
              () => stopRunOrThrow(runId),
              { loading: "正在停止运行...", success: "运行已停止。", error: "停止运行失败。" },
            )
            if (result === null) {
              throw new Error("停止运行失败")
            }
          }}
        />

        <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除任务</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget?.activeRun?.status === "running" ? "先停止当前运行，再删除任务。" : "删除后不会再执行。"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy || deleteTarget?.activeRun?.status === "running"}
                onClick={() => {
                  void handleDelete()
                }}
              >
                {busy ? "正在删除..." : "删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <TaskExportDialog
          open={isExportOpen}
          onOpenChange={setIsExportOpen}
          tasks={tasks}
          isExporting={isExporting}
          onExport={(ids) => { void handleExport(ids) }}
        />
        {importEntries ? (
          <TaskImportDialog
            open={true}
            onOpenChange={(open) => { if (!open) setImportEntries(null) }}
            entries={importEntries}
            importing={importing}
            onImport={async (indices) => {
              setImporting(true)
              try {
                await handleImport(indices)
              } finally {
                setImporting(false)
              }
            }}
          />
        ) : null}
      </div>
    </TooltipProvider>
  )
}

function IconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          disabled={disabled}
          size="icon-sm"
          variant="ghost"
          onClick={onClick}
        >
          {children}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export { TaskSchedulerModule }
