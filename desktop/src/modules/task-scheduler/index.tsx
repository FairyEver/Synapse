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
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
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

function TaskSchedulerModule() {
  const { config } = useAppConfig()
  const platform = getRendererPlatform()
  const { tasks, loading, error, refresh } = useTaskSchedulerTasks()
  const { promise } = useAppNotifications()
  const [formState, setFormState] = useState<TaskFormDialogState>({ mode: "create" })
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [historyTask, setHistoryTask] = useState<ScheduledTask | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [importEntries, setImportEntries] = useState<TaskExportEntry[] | null>(null)

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
      logger.error("Task scheduler mutation failed.", { error: mutationError })
      return null
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(input: ScheduledTaskCreateInput) {
    await runMutation(
      async () => {
        const task = await createTask(input)
        logger.info("Task created.", { taskId: task.id, name: task.name })
        return task
      },
      { loading: "正在保存任务...", success: "任务已保存。", error: "保存任务失败。" },
    )
  }

  async function handleUpdate(id: string, patch: ScheduledTaskUpdateInput) {
    await runMutation(
      async () => {
        const task = await updateTask(id, patch)
        logger.info("Task updated.", { taskId: task.id, name: task.name })
        return task
      },
      { loading: "正在保存任务...", success: "任务已保存。", error: "保存任务失败。" },
    )
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    const task = deleteTarget
    await runMutation(
      async () => {
        const result = await deleteTask(task.id)
        logger.info("Task deleted.", { taskId: task.id, name: task.name })
        return result
      },
      { loading: "正在删除任务...", success: "任务已删除。", error: "删除任务失败。" },
    )
    setDeleteTarget(null)
  }

  async function handleExport(selectedIds: string[]) {
    const selectedTasks = tasks.filter((t) => selectedIds.includes(t.id))
    const exportData = serializeTasksForExport(selectedTasks)
    const json = JSON.stringify(exportData, null, 2)
    const result = await exportTasksToFile(json)
    if (result.success) {
      setIsExportOpen(false)
    }
  }

  async function handleImportStart() {
    const result = await importTasksFromFile()
    if (!result.success || !result.content) return
    try {
      const parsed = parseTaskImportFile(result.content)
      setImportEntries(parsed.tasks)
    } catch {
      void promise(
        () => Promise.reject(new Error("文件格式无效")),
        { loading: "", success: "", error: "文件格式无效" },
      )
    }
  }

  async function handleImport(indices: number[]) {
    if (!importEntries) return
    const selected = indices.map((i) => importEntries[i])
    let successCount = 0
    let failCount = 0
    for (const entry of selected) {
      try {
        await createTask({
          name: entry.name,
          description: entry.description,
          scope: entry.scope,
          cwd: entry.cwd,
          trigger: entry.trigger,
          action: entry.action,
          enabled: false,
          missedRunPolicy: entry.missedRunPolicy,
        })
        successCount++
      } catch {
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

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col gap-2.5 bg-surface px-2 py-2.5">
        <div className="flex flex-wrap items-center justify-end gap-3">
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

        <div className="min-h-0 flex-1 overflow-y-auto p-0.5">
          {error ? (
            <div className="flex items-center gap-3 p-4">
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
                void runMutation(
                  () => runTask(task.id),
                  { loading: "正在启动任务...", success: "任务已启动。", error: "启动任务失败。" },
                )
              }}
              onStop={(task) => {
                void runMutation(
                  () => stopRun(task.id),
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
            await runMutation(
              () => stopRun(runId),
              { loading: "正在停止运行...", success: "运行已停止。", error: "停止运行失败。" },
            )
          }}
        />

        <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除任务</AlertDialogTitle>
              <AlertDialogDescription>
                删除后不会再执行。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  void handleDelete()
                }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <TaskExportDialog
          open={isExportOpen}
          onOpenChange={setIsExportOpen}
          tasks={tasks}
          onExport={(ids) => void handleExport(ids)}
        />
        {importEntries ? (
          <TaskImportDialog
            open={true}
            onOpenChange={(open) => { if (!open) setImportEntries(null) }}
            entries={importEntries}
            onImport={(indices) => void handleImport(indices)}
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
