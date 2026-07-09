import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { CircleAlert, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useAppConfig } from "../../../src/app-shell/config"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { SidebarContentLayout } from "../../../src/components/sidebar-content-layout"
import { Alert, AlertDescription, AlertTitle } from "../../../src/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../src/components/ui/alert-dialog"
import { Button } from "../../../src/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../src/components/ui/dialog"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "../../../src/components/ui/empty"
import { Input } from "../../../src/components/ui/input"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { shouldBypassDeleteConfirm } from "../../../src/lib/delete-confirm-bypass"
import { SystemAppTopBarActionButton } from "../../../src/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { SynapseProjectConfig } from "../../../src/types/config"
import { isSwarmFileWritePathAllowed, type SwarmRun, type SwarmTask, type SwarmTaskConfig, type SwarmWorkerRun } from "../shared/schema"
import { SwarmTaskDetail, type SwarmTaskTab } from "./components/swarm-task-detail"
import { SwarmTaskSidebar } from "./components/swarm-task-sidebar"

const logger = createRendererLogger("swarm-task.app")
const RUN_REFRESH_INTERVAL_MS = 2_000

type TaskNameDialogState =
  | { readonly mode: "create" }
  | { readonly mode: "rename"; readonly task: SwarmTask }

const baseTaskConfig: Omit<SwarmTaskConfig, "projectId"> = {
  prompt: "填写任务目标",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: false },
    previousHandoff: { enabled: false },
    summary: { enabled: false, injectRecent: false, recentLimit: 3 },
    fileWrite: {
      enabled: false,
      path: "",
      mode: "append-only",
      lock: { enabled: true },
    },
    customAppendix: "",
  },
  runMode: "batch",
  concurrency: 1,
  maxRounds: 1,
  agent: {},
}

export function SwarmTaskModule() {
  const { config } = useAppConfig()
  const projects = config.global.projects
  const swarmTaskBridge = useMemo(() => requireBridgeDomain("swarmTask"), [])
  const agentBridge = useMemo(() => requireBridgeDomain("agent"), [])
  const runDataRequestIdRef = useRef(0)
  const taskNameInputRef = useRef<HTMLInputElement>(null)

  const [tasks, setTasks] = useState<SwarmTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<SwarmTaskTab>("overview")
  const [draftConfig, setDraftConfig] = useState<SwarmTaskConfig | null>(null)
  const [runHistory, setRunHistory] = useState<SwarmRun[]>([])
  const [activeRun, setActiveRun] = useState<SwarmRun | null>(null)
  const [workerRuns, setWorkerRuns] = useState<SwarmWorkerRun[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingRun, setLoadingRun] = useState(false)
  const [creating, setCreating] = useState(false)
  const [taskNameDialog, setTaskNameDialog] = useState<TaskNameDialogState | null>(null)
  const [taskName, setTaskName] = useState("")
  const [taskNameSaving, setTaskNameSaving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SwarmTask | null>(null)
  const [loadError, setLoadError] = useState("")

  const reloadTasks = useCallback(async (options: { readonly showLoading?: boolean } = {}) => {
    const showLoading = options.showLoading ?? true
    try {
      if (showLoading) setLoading(true)
      setLoadError("")
      const nextTasks = await swarmTaskBridge.listTasks()
      setTasks(nextTasks)
      setSelectedTaskId((current) => {
        if (current && nextTasks.some((task) => task.id === current)) return current
        return nextTasks[0]?.id ?? null
      })
      return nextTasks
    } catch (error) {
      const message = errorMessage(error, "加载失败")
      logger.error("Failed to load swarm tasks.", error)
      setLoadError(message)
      toast.error(message)
      return null
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [swarmTaskBridge])

  const reloadRunData = useCallback(async (task: SwarmTask | null) => {
    const requestId = runDataRequestIdRef.current + 1
    runDataRequestIdRef.current = requestId

    if (!task) {
      setRunHistory([])
      setActiveRun(null)
      setWorkerRuns([])
      setLoadingRun(false)
      return
    }

    try {
      setLoadingRun(true)
      const runs = await swarmTaskBridge.listRuns({ taskId: task.id, limit: 20 })
      const latestRun = task.lastRunId
        ? await swarmTaskBridge.getRun(task.lastRunId)
        : runs[0] ?? null
      const nextWorkerRuns = latestRun ? await swarmTaskBridge.listWorkerRuns(latestRun.id) : []
      if (runDataRequestIdRef.current !== requestId) return
      setRunHistory(runs)
      setActiveRun(latestRun)
      setWorkerRuns(nextWorkerRuns)
    } catch (error) {
      if (runDataRequestIdRef.current !== requestId) return
      const message = errorMessage(error, "加载运行失败")
      logger.error("Failed to load swarm task runs.", error)
      toast.error(message)
    } finally {
      if (runDataRequestIdRef.current === requestId) {
        setLoadingRun(false)
      }
    }
  }, [swarmTaskBridge])

  useEffect(() => {
    void reloadTasks()
  }, [reloadTasks])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  )

  useEffect(() => {
    if (tasks.length === 0) {
      if (selectedTaskId !== null) {
        setSelectedTaskId(null)
      }
      return
    }

    if (selectedTaskId && tasks.some((task) => task.id === selectedTaskId)) {
      return
    }

    setSelectedTaskId(tasks[0].id)
  }, [tasks, selectedTaskId])

  useEffect(() => {
    if (!selectedTask) {
      void reloadRunData(null)
      setDraftConfig(null)
      return
    }
    setDraftConfig(selectedTask.currentConfig)
    setRunHistory([])
    setActiveRun(null)
    setWorkerRuns([])
    void reloadRunData(selectedTask)
  }, [reloadRunData, selectedTask])

  const openCreateTaskDialog = useCallback(() => {
    if (projects.length === 0) return
    setTaskName(generateDefaultTaskName())
    setTaskNameDialog({ mode: "create" })
  }, [projects.length])

  const openRenameTaskDialog = useCallback((task: SwarmTask) => {
    setTaskName(task.name)
    setTaskNameDialog({ mode: "rename", task })
  }, [])

  const closeTaskNameDialog = useCallback(() => {
    setTaskNameDialog(null)
    setTaskName("")
  }, [])

  const createTask = useCallback(async (name: string) => {
    const project = projects[0]
    if (!project) return
    try {
      setCreating(true)
      const created = await swarmTaskBridge.createTask({
        name,
        config: createDefaultTaskConfig(project),
      })
      setTasks((current) => [created, ...current.filter((task) => task.id !== created.id)])
      setSelectedTaskId(created.id)
      setDraftConfig(created.currentConfig)
      setActiveTab("config")
      toast.success("已创建")
    } catch (error) {
      const message = errorMessage(error, "创建失败")
      logger.error("Failed to create swarm task.", error)
      toast.error(message)
      throw error
    } finally {
      setCreating(false)
    }
  }, [projects, swarmTaskBridge])

  const renameTask = useCallback(async (task: SwarmTask, name: string) => {
    try {
      setTaskNameSaving(true)
      const updated = await swarmTaskBridge.updateTask({
        taskId: task.id,
        patch: { name },
      })
      setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      toast.success("已重命名")
      closeTaskNameDialog()
    } catch (error) {
      const message = errorMessage(error, "重命名失败")
      logger.error("Failed to rename swarm task.", error)
      toast.error(message)
    } finally {
      setTaskNameSaving(false)
    }
  }, [closeTaskNameDialog, swarmTaskBridge])

  const saveTaskName = useCallback(async () => {
    const name = taskName.trim()
    if (!name || !taskNameDialog) return

    if (taskNameDialog.mode === "create") {
      try {
        await createTask(name)
        closeTaskNameDialog()
      } catch {
        // createTask reports the failure and keeps the dialog open for retry.
      }
      return
    }

    await renameTask(taskNameDialog.task, name)
  }, [closeTaskNameDialog, createTask, renameTask, taskName, taskNameDialog])

  const selectedActiveRun = useMemo(() => {
    if (!selectedTask || activeRun?.taskId !== selectedTask.id) return null
    return activeRun
  }, [activeRun, selectedTask])

  const selectedWorkerRuns = useMemo(() => {
    if (!selectedTask || !selectedActiveRun) return []
    return workerRuns.filter((worker) => (
      worker.taskId === selectedTask.id && worker.runId === selectedActiveRun.id
    ))
  }, [selectedActiveRun, selectedTask, workerRuns])

  const selectedRunHistory = useMemo(() => {
    if (!selectedTask) return []
    return runHistory.filter((run) => run.taskId === selectedTask.id)
  }, [runHistory, selectedTask])

  const refreshCurrentSnapshot = useCallback(async (options: { readonly showLoading?: boolean } = {}) => {
    const nextTasks = await reloadTasks({ showLoading: options.showLoading ?? false })
    if (!nextTasks) return

    const nextTask = (
      selectedTaskId ? nextTasks.find((task) => task.id === selectedTaskId) : null
    ) ?? nextTasks[0] ?? null
    await reloadRunData(nextTask)
  }, [reloadRunData, reloadTasks, selectedTaskId])

  useEffect(() => (
    swarmTaskBridge.onChanged((event) => {
      const matchesTask = !event.taskId || event.taskId === selectedTaskId
      const matchesRun = Boolean(event.runId && event.runId === selectedActiveRun?.id)
      if (!selectedTaskId || matchesTask || matchesRun) {
        void refreshCurrentSnapshot()
      }
    })
  ), [refreshCurrentSnapshot, selectedActiveRun?.id, selectedTaskId, swarmTaskBridge])

  const shouldPollRun = useMemo(() => (
    Boolean(selectedTask && (
      isActiveRunStatus(selectedTask.lastStatus)
      || isActiveRunStatus(selectedActiveRun?.status)
    ))
  ), [selectedActiveRun?.status, selectedTask])

  useEffect(() => {
    if (!shouldPollRun) return undefined

    const refreshWhenVisible = () => {
      if (document.visibilityState === "hidden") return
      void refreshCurrentSnapshot()
    }
    const timer = window.setInterval(refreshWhenVisible, RUN_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [refreshCurrentSnapshot, shouldPollRun])

  const draftConfigIsRunnable = useMemo(() => (
    Boolean(draftConfig?.prompt.trim())
    && Boolean(draftConfig?.projectId)
    && projects.some((project) => project.id === draftConfig?.projectId)
    && (!draftConfig?.promptInjection.fileWrite.enabled || (
      Boolean(draftConfig.promptInjection.fileWrite.path.trim())
      && isSwarmFileWritePathAllowed(draftConfig.promptInjection.fileWrite.path)
    ))
  ), [draftConfig, projects])

  const saveConfig = useCallback(async () => {
    if (!selectedTask || !draftConfig || !draftConfigIsRunnable) return
    try {
      setSaving(true)
      const updated = await swarmTaskBridge.updateTask({
        taskId: selectedTask.id,
        patch: { currentConfig: draftConfig },
      })
      setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)))
      toast.success("已保存")
    } catch (error) {
      const message = errorMessage(error, "保存失败")
      logger.error("Failed to save swarm task config.", error)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }, [draftConfig, draftConfigIsRunnable, selectedTask, swarmTaskBridge])

  const startRun = useCallback(async () => {
    if (!selectedTask || !draftConfigIsRunnable) return
    try {
      setRunning(true)
      await swarmTaskBridge.startRun({ taskId: selectedTask.id })
      setActiveTab("active")
      await refreshCurrentSnapshot()
    } catch (error) {
      const message = errorMessage(error, "运行失败")
      logger.error("Failed to start swarm task run.", error)
      toast.error(message)
    } finally {
      setRunning(false)
    }
  }, [draftConfigIsRunnable, refreshCurrentSnapshot, selectedTask, swarmTaskBridge])

  const openConversation = useCallback(async (worker: SwarmWorkerRun) => {
    if (!selectedTask?.currentConfig.projectId || !worker.conversationId || worker.taskId !== selectedTask.id) return
    try {
      const result = await agentBridge.openConversation({
        projectId: selectedTask.currentConfig.projectId,
        conversationId: worker.conversationId,
        sessionKey: worker.sessionKey,
        platform: "swarm",
      })
      if (!result.opened) {
        toast.error("会话不存在")
      }
    } catch (error) {
      const message = errorMessage(error, "打开会话失败")
      logger.error("Failed to open swarm worker conversation.", error)
      toast.error(message)
    }
  }, [agentBridge, selectedTask])

  const stopRefill = useCallback(async () => {
    if (!activeRun) return
    const fallbackMessage = activeRun.configSnapshot.runMode === "continuous" ? "停止补位失败" : "停止新轮次失败"
    try {
      await swarmTaskBridge.stopRefill(activeRun.id)
      await refreshCurrentSnapshot()
    } catch (error) {
      const message = errorMessage(error, fallbackMessage)
      logger.error("Failed to stop swarm task refill.", error)
      toast.error(message)
    }
  }, [activeRun, refreshCurrentSnapshot, swarmTaskBridge])

  const cancelRun = useCallback(async () => {
    if (!activeRun) return
    try {
      await swarmTaskBridge.cancelRun(activeRun.id)
      await refreshCurrentSnapshot()
    } catch (error) {
      const message = errorMessage(error, "取消运行失败")
      logger.error("Failed to cancel swarm task run.", error)
      toast.error(message)
    }
  }, [activeRun, refreshCurrentSnapshot, swarmTaskBridge])

  const deleteTask = useCallback(async (task: SwarmTask) => {
    try {
      setDeleting(true)
      await swarmTaskBridge.deleteTask(task.id)
      setDeleteTarget(null)
      toast.success("已删除")
      await refreshCurrentSnapshot({ showLoading: true })
    } catch (error) {
      const message = errorMessage(error, "删除失败")
      logger.error("Failed to delete swarm task.", error)
      toast.error(message)
    } finally {
      setDeleting(false)
    }
  }, [refreshCurrentSnapshot, swarmTaskBridge])

  const startDeleteTask = useCallback((task: SwarmTask, event: MouseEvent<HTMLElement>) => {
    if (shouldBypassDeleteConfirm(event)) {
      void deleteTask(task)
      return
    }
    setDeleteTarget(task)
  }, [deleteTask])

  return (
    <>
      <SystemAppWindowShell
        actions={(
          <>
            <SystemAppTopBarActionButton type="button" onClick={openCreateTaskDialog} disabled={loading || creating || projects.length === 0}>
              <Plus data-icon="inline-start" />
              新建任务
            </SystemAppTopBarActionButton>
            <SystemAppTopBarActionButton type="button" onClick={() => void refreshCurrentSnapshot({ showLoading: true })} disabled={loading}>
              <RefreshCw data-icon="inline-start" />
              刷新
            </SystemAppTopBarActionButton>
          </>
        )}
      >
        {loading ? (
          <SwarmTaskLoadingState />
        ) : loadError ? (
          <div className="p-4">
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          </div>
        ) : tasks.length === 0 ? (
          <Empty className="min-h-full">
            <EmptyHeader>
              <EmptyTitle>{projects.length === 0 ? "请先在设置中添加项目" : "暂无任务"}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <SidebarContentLayout
            sidebar={(
              <SwarmTaskSidebar
                tasks={tasks}
                selectedTaskId={selectedTask?.id ?? null}
                onSelectTask={setSelectedTaskId}
                onRenameTask={openRenameTaskDialog}
                onDeleteTask={startDeleteTask}
              />
            )}
            contentScrollable={false}
            sidebarResizable
            sidebarDefaultSize={260}
            sidebarMinSize={220}
            sidebarMaxSize={360}
          >
            {selectedTask && draftConfig ? (
              <SwarmTaskDetail
                task={selectedTask}
                activeTab={activeTab}
                onActiveTabChange={setActiveTab}
                draftConfig={draftConfig}
                activeRun={selectedActiveRun}
                workerRuns={selectedWorkerRuns}
                runHistory={selectedRunHistory}
                loadingRun={loadingRun}
                saving={saving}
                running={running}
                projects={projects}
                canSaveConfig={draftConfigIsRunnable}
                canStartRun={draftConfigIsRunnable}
                onDraftConfigChange={setDraftConfig}
                onSaveConfig={() => void saveConfig()}
                onStartRun={() => void startRun()}
                onRefreshRun={() => void refreshCurrentSnapshot()}
                onStopRefill={() => void stopRefill()}
                onCancelRun={() => void cancelRun()}
                onOpenConversation={(worker) => void openConversation(worker)}
              />
            ) : (
              <Empty className="min-h-full">
                <EmptyHeader>
                  <EmptyTitle>暂无任务</EmptyTitle>
                </EmptyHeader>
              </Empty>
            )}
          </SidebarContentLayout>
        )}
      </SystemAppWindowShell>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => {
        if (!open) setDeleteTarget(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除任务？</AlertDialogTitle>
            <AlertDialogDescription>
              会删除该任务及运行历史。已创建的 Agent 会话不会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                if (deleteTarget) void deleteTask(deleteTarget)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={taskNameDialog !== null} onOpenChange={(open) => {
        if (!open) closeTaskNameDialog()
      }}>
        <DialogContent
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            taskNameInputRef.current?.focus()
            taskNameInputRef.current?.select()
          }}
        >
          <DialogHeader>
            <DialogTitle>{taskNameDialog?.mode === "rename" ? "重命名任务" : "新建任务"}</DialogTitle>
            <DialogDescription className="sr-only">
              设置任务名称。
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={taskNameInputRef}
            aria-label="任务名称"
            value={taskName}
            onChange={(event) => setTaskName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void saveTaskName()
              }
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={creating || taskNameSaving}
              onClick={closeTaskNameDialog}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={creating || taskNameSaving || !taskName.trim()}
              onClick={() => { void saveTaskName() }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function createDefaultTaskConfig(project: SynapseProjectConfig): SwarmTaskConfig {
  return {
    ...baseTaskConfig,
    projectId: project.id,
  }
}

function SwarmTaskLoadingState() {
  return (
    <div className="grid h-full min-h-0 grid-cols-[260px_minmax(0,1fr)]">
      <div className="border-r p-3">
        <Skeleton className="h-9 w-full" />
        <div className="mt-3 grid gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      </div>
      <div className="p-4">
        <div className="mt-4 grid gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return fallback
}

function isActiveRunStatus(status: SwarmRun["status"] | SwarmTask["lastStatus"] | undefined): boolean {
  return status === "running" || status === "draining"
}

function generateDefaultTaskName(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let suffix = ""
  for (let index = 0; index < 4; index += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `任务 ${suffix}`
}
