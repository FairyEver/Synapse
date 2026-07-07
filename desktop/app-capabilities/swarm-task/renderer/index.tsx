import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleAlert, Play, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { SidebarContentLayout } from "../../../src/components/sidebar-content-layout"
import { Alert, AlertDescription, AlertTitle } from "../../../src/components/ui/alert"
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

const tabs = [
  { id: "config", label: "配置" },
  { id: "active", label: "运行中" },
  { id: "history", label: "历史" },
] as const satisfies ReadonlyArray<{ id: SwarmTaskTab; label: string }>

export function SwarmTaskModule() {
  const swarmTaskBridge = useMemo(() => requireBridgeDomain("swarmTask"), [])
  const agentBridge = useMemo(() => requireBridgeDomain("agent"), [])

  const [tasks, setTasks] = useState<SwarmTask[]>([])
  const [search, setSearch] = useState("")
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<SwarmTaskTab>("config")
  const [draftConfig, setDraftConfig] = useState<SwarmTaskConfig | null>(null)
  const [runHistory, setRunHistory] = useState<SwarmRun[]>([])
  const [activeRun, setActiveRun] = useState<SwarmRun | null>(null)
  const [workerRuns, setWorkerRuns] = useState<SwarmWorkerRun[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingRun, setLoadingRun] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
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
    if (!task) {
      setRunHistory([])
      setActiveRun(null)
      setWorkerRuns([])
      return
    }

    try {
      setLoadingRun(true)
      const runs = await swarmTaskBridge.listRuns({ taskId: task.id, limit: 20 })
      setRunHistory(runs)
      const latestRun = task.lastRunId
        ? await swarmTaskBridge.getRun(task.lastRunId)
        : runs[0] ?? null
      setActiveRun(latestRun)
      setWorkerRuns(latestRun ? await swarmTaskBridge.listWorkerRuns(latestRun.id) : [])
    } catch (error) {
      const message = errorMessage(error, "加载运行失败")
      logger.error("Failed to load swarm task runs.", error)
      toast.error(message)
    } finally {
      setLoadingRun(false)
    }
  }, [swarmTaskBridge])

  useEffect(() => {
    void reloadTasks()
  }, [reloadTasks])

  const filteredTasks = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (keyword.length === 0) return tasks
    return tasks.filter((task) => {
      const source = `${task.name} ${task.currentConfig.workspacePath}`.toLowerCase()
      return source.includes(keyword)
    })
  }, [search, tasks])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  )

  useEffect(() => {
    if (filteredTasks.length === 0) {
      if (selectedTaskId !== null) {
        setSelectedTaskId(null)
      }
      return
    }

    if (selectedTaskId && filteredTasks.some((task) => task.id === selectedTaskId)) {
      return
    }

    setSelectedTaskId(filteredTasks[0].id)
  }, [filteredTasks, selectedTaskId])

  useEffect(() => {
    if (!selectedTask) {
      setDraftConfig(null)
      setRunHistory([])
      setActiveRun(null)
      setWorkerRuns([])
      return
    }
    setDraftConfig(selectedTask.currentConfig)
    void reloadRunData(selectedTask)
  }, [reloadRunData, selectedTask])

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
    if (!selectedTask?.currentConfig.projectId || !worker.conversationId) return
    try {
      await agentBridge.openConversation({
        projectId: selectedTask.currentConfig.projectId,
        conversationId: worker.conversationId,
        sessionKey: worker.sessionKey,
        platform: "swarm",
      })
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

  return (
    <SystemAppWindowShell
      tabs={tabs}
      value={activeTab}
      onValueChange={setActiveTab}
      actions={(
        <Button type="button" variant="outline" onClick={() => void reloadTasks()} disabled={loading}>
          <RefreshCw data-icon="inline-start" />
          刷新
        </Button>
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
      ) : filteredTasks.length === 0 ? (
        <Empty className="min-h-full">
          <EmptyHeader>
            <EmptyTitle>暂无任务</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : selectedTask && draftConfig ? (
        <SidebarContentLayout
          sidebar={(
            <SwarmTaskSidebar
              tasks={filteredTasks}
              selectedTaskId={selectedTask.id}
              search={search}
              onSearchChange={setSearch}
              onSelectTask={setSelectedTaskId}
            />
          )}
          contentScrollable={false}
          sidebarResizable
          sidebarDefaultSize={260}
          sidebarMinSize={220}
          sidebarMaxSize={360}
        >
          <SwarmTaskDetail
            task={selectedTask}
            activeTab={activeTab}
            draftConfig={draftConfig}
            activeRun={activeRun}
            workerRuns={workerRuns}
            runHistory={runHistory}
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
        </SidebarContentLayout>
      ) : (
        <Empty className="min-h-full">
          <EmptyHeader>
            <EmptyTitle>暂无任务</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </SystemAppWindowShell>
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
        <div className="flex items-center justify-between gap-3 border-b pb-3">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Button type="button" disabled>
            <Play data-icon="inline-start" />
            运行
          </Button>
        </div>
        <div className="mt-4 grid gap-3">
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
