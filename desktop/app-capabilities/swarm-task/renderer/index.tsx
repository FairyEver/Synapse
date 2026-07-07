import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CircleAlert, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
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
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "../../../src/components/ui/empty"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { SwarmRun, SwarmTask, SwarmTaskConfig, SwarmWorkerRun } from "../shared/schema"
import { SwarmTaskDetail, type SwarmTaskTab } from "./components/swarm-task-detail"
import { SwarmTaskSidebar } from "./components/swarm-task-sidebar"

const logger = createRendererLogger("swarm-task.app")

const defaultTaskConfig: SwarmTaskConfig = {
  projectId: "project-id",
  workspacePath: "/path/to/workspace",
  prompt: "填写任务目标",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    outputProtocol: true,
    parallelContext: true,
    gitContext: false,
    customAppendix: "",
  },
  runMode: "batch",
  concurrency: 1,
  maxRounds: 1,
  output: { mode: "managed-directory", targetFilePolicy: "append-only" },
  summary: { enabled: true, injectRecent: false, recentLimit: 3 },
  handoff: { enabled: false },
  agent: {},
}

export function SwarmTaskModule() {
  const swarmTaskBridge = useMemo(() => requireBridgeDomain("swarmTask"), [])
  const agentBridge = useMemo(() => requireBridgeDomain("agent"), [])
  const runDataRequestIdRef = useRef(0)

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
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [loadError, setLoadError] = useState("")

  const reloadTasks = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError("")
      const nextTasks = await swarmTaskBridge.listTasks()
      setTasks(nextTasks)
      setSelectedTaskId((current) => {
        if (current && nextTasks.some((task) => task.id === current)) return current
        return nextTasks[0]?.id ?? null
      })
    } catch (error) {
      const message = errorMessage(error, "加载失败")
      logger.error("Failed to load swarm tasks.", error)
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
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

  const createTask = useCallback(async () => {
    try {
      setCreating(true)
      const created = await swarmTaskBridge.createTask({
        name: "新建任务",
        config: defaultTaskConfig,
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
    } finally {
      setCreating(false)
    }
  }, [swarmTaskBridge])

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

  const deleteDisabled = useMemo(() => (
    !selectedTask
    || deleting
    || isActiveRunStatus(selectedTask.lastStatus)
    || isActiveRunStatus(selectedActiveRun?.status)
  ), [deleting, selectedActiveRun, selectedTask])

  const saveConfig = useCallback(async () => {
    if (!selectedTask || !draftConfig) return
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
  }, [draftConfig, selectedTask, swarmTaskBridge])

  const startRun = useCallback(async () => {
    if (!selectedTask) return
    try {
      setRunning(true)
      await swarmTaskBridge.startRun({ taskId: selectedTask.id })
      setActiveTab("active")
      await reloadTasks()
    } catch (error) {
      const message = errorMessage(error, "运行失败")
      logger.error("Failed to start swarm task run.", error)
      toast.error(message)
    } finally {
      setRunning(false)
    }
  }, [reloadTasks, selectedTask, swarmTaskBridge])

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
    try {
      await swarmTaskBridge.stopRefill(activeRun.id)
      await reloadRunData(selectedTask)
    } catch (error) {
      const message = errorMessage(error, "停止补位失败")
      logger.error("Failed to stop swarm task refill.", error)
      toast.error(message)
    }
  }, [activeRun, reloadRunData, selectedTask, swarmTaskBridge])

  const cancelRun = useCallback(async () => {
    if (!activeRun) return
    try {
      await swarmTaskBridge.cancelRun(activeRun.id)
      await reloadRunData(selectedTask)
    } catch (error) {
      const message = errorMessage(error, "取消运行失败")
      logger.error("Failed to cancel swarm task run.", error)
      toast.error(message)
    }
  }, [activeRun, reloadRunData, selectedTask, swarmTaskBridge])

  const deleteTask = useCallback(async () => {
    if (!selectedTask) return
    try {
      setDeleting(true)
      await swarmTaskBridge.deleteTask(selectedTask.id)
      setDeleteConfirmOpen(false)
      toast.success("已删除")
      await reloadTasks()
    } catch (error) {
      const message = errorMessage(error, "删除失败")
      logger.error("Failed to delete swarm task.", error)
      toast.error(message)
    } finally {
      setDeleting(false)
    }
  }, [reloadTasks, selectedTask, swarmTaskBridge])

  return (
    <>
      <SystemAppWindowShell
        actions={(
          <div className="flex items-center gap-2 whitespace-nowrap">
            <Button type="button" variant="destructive" onClick={() => setDeleteConfirmOpen(true)} disabled={loading || deleteDisabled}>
              <Trash2 data-icon="inline-start" />
              删除任务
            </Button>
            <Button type="button" variant="outline" onClick={() => void createTask()} disabled={loading || creating}>
              <Plus data-icon="inline-start" />
              新建任务
            </Button>
            <Button type="button" variant="outline" onClick={() => void reloadTasks()} disabled={loading}>
              <RefreshCw data-icon="inline-start" />
              刷新
            </Button>
          </div>
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
              <EmptyTitle>暂无任务</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <SidebarContentLayout
            sidebar={(
              <SwarmTaskSidebar
                tasks={tasks}
                selectedTaskId={selectedTask?.id ?? null}
                onSelectTask={setSelectedTaskId}
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
                onDraftConfigChange={setDraftConfig}
                onSaveConfig={() => void saveConfig()}
                onStartRun={() => void startRun()}
                onRefreshRun={() => void reloadRunData(selectedTask)}
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

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除任务？</AlertDialogTitle>
            <AlertDialogDescription>
              会删除当前任务及运行历史。已创建的 Agent 会话不会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void deleteTask()
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
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

function isActiveRunStatus(status: SwarmRun["status"] | undefined): boolean {
  return status === "running" || status === "draining"
}
