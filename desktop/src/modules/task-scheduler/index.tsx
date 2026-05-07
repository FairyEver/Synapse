import { useState, type ReactNode } from "react"
import {
  History,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"

import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { getRendererPlatform } from "@/lib/runtime-platform"
import { Badge } from "@/components/ui/badge"
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskStatus,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"
import { TaskFormDialog } from "./components/task-form-dialog"
import { TaskRunsDialog } from "./components/task-runs-dialog"
import type { TaskFormDialogState } from "./types"
import {
  createTask,
  deleteTask,
  runTask,
  setTaskEnabled,
  stopRun,
  updateTask,
  useTaskSchedulerTasks,
} from "./hooks/use-task-scheduler"
import {
  formatTaskAction,
  formatTaskDate,
  formatTaskScope,
  formatTaskStatus,
  formatTaskTrigger,
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

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col gap-2.5 bg-muted/30 px-2 py-2.5">
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

        <div className="min-h-0 flex-1 overflow-y-auto">
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
          {!loading && tasks.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <History />
                </EmptyMedia>
                <EmptyTitle>暂无任务</EmptyTitle>
                <EmptyDescription>新建任务后会按计划执行。</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  onClick={() => {
                    setFormState({ mode: "create" })
                    setIsFormOpen(true)
                  }}
                >
                  <Plus />
                  新建任务
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {tasks.length > 0 ? (
            <div className="overflow-x-auto rounded-lg bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>作用域</TableHead>
                    <TableHead>触发</TableHead>
                    <TableHead>动作</TableHead>
                    <TableHead>上次</TableHead>
                    <TableHead>下次</TableHead>
                    <TableHead className="sticky right-48 w-16 bg-background after:absolute after:inset-y-0 after:-left-px after:w-px after:bg-border">状态</TableHead>
                    <TableHead className="sticky right-36 w-12 bg-background">启用</TableHead>
                    <TableHead className="sticky right-0 w-36 bg-background text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">{task.name}</TableCell>
                      <TableCell>{formatTaskScope(task, config.global.projects)}</TableCell>
                      <TableCell>{formatTaskTrigger(task)}</TableCell>
                      <TableCell>{formatTaskAction(task)}</TableCell>
                      <TableCell>{formatTaskDate(task.lastRunAt, "未运行")}</TableCell>
                      <TableCell>{formatTaskDate(task.nextRunAt, "未排期")}</TableCell>
                      <TableCell className="sticky right-48 w-16 bg-background after:absolute after:inset-y-0 after:-left-px after:w-px after:bg-border">
                        <StatusBadge status={task.lastStatus} />
                      </TableCell>
                      <TableCell className="sticky right-36 w-12 bg-background">
                        <Switch
                          checked={task.enabled}
                          disabled={busy}
                          size="sm"
                          onCheckedChange={(enabled) => {
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
                      </TableCell>
                      <TableCell className="sticky right-0 w-36 bg-background">
                        <div className="flex justify-end gap-1">
                          <IconButton
                            disabled={busy}
                            label="运行"
                            onClick={() => {
                              void runMutation(
                                () => runTask(task.id),
                                { loading: "正在启动任务...", success: "任务已启动。", error: "启动任务失败。" },
                              )
                            }}
                          >
                            <Play />
                          </IconButton>
                          <IconButton
                            label="历史"
                            onClick={() => setHistoryTask(task)}
                          >
                            <History />
                          </IconButton>
                          <IconButton
                            label="编辑"
                            onClick={() => {
                              setFormState({ mode: "edit", task })
                              setIsFormOpen(true)
                            }}
                          >
                            <Pencil />
                          </IconButton>
                          <IconButton
                            disabled={busy}
                            label="删除"
                            onClick={() => setDeleteTarget(task)}
                          >
                            <Trash2 />
                          </IconButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
      </div>
    </TooltipProvider>
  )
}

function StatusBadge({ status }: { status: ScheduledTaskStatus | undefined }) {
  if (status === "failed" || status === "timeout") {
    return <Badge variant="destructive">{formatTaskStatus(status)}</Badge>
  }
  if (status === "success") {
    return <Badge>{formatTaskStatus(status)}</Badge>
  }
  return <Badge variant="secondary">{formatTaskStatus(status)}</Badge>
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
