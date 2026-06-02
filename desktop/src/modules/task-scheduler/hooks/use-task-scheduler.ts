import { useCallback, useEffect, useRef, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRun,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"

const logger = createRendererLogger("task-scheduler.hooks")

function useTaskSchedulerTasks() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)
  const latestRefreshIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const refreshId = latestRefreshIdRef.current + 1
    latestRefreshIdRef.current = refreshId
    const isLatestRefresh = () => latestRefreshIdRef.current === refreshId

    try {
      if (!hasLoadedRef.current) setLoading(true)
      const nextTasks = await requireSynapseBridge().taskScheduler.listTasks()
      if (!isLatestRefresh()) return
      hasLoadedRef.current = true
      setTasks(nextTasks)
      setError(null)
    } catch (refreshError) {
      if (!isLatestRefresh()) return
      logger.warn("Task scheduler list refresh failed.", {
        action: "listTasks",
        boundary: "renderer.task-scheduler.list",
        errorType: refreshError instanceof Error ? refreshError.name : typeof refreshError,
        errorLength: errorMessageLength(refreshError),
      })
      setError("读取任务失败")
    } finally {
      if (isLatestRefresh()) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return requireSynapseBridge().taskScheduler.onChanged(() => {
      void refresh()
    })
  }, [refresh])

  return {
    tasks,
    loading,
    error,
    refresh,
  }
}

async function createTask(input: ScheduledTaskCreateInput): Promise<ScheduledTask> {
  return requireSynapseBridge().taskScheduler.createTask(input)
}

async function updateTask(id: string, patch: ScheduledTaskUpdateInput): Promise<ScheduledTask> {
  return requireSynapseBridge().taskScheduler.updateTask({ id, patch })
}

async function deleteTask(id: string): Promise<{ deleted: boolean }> {
  return requireSynapseBridge().taskScheduler.deleteTask(id)
}

async function setTaskEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
  return requireSynapseBridge().taskScheduler.setTaskEnabled({ id, enabled })
}

async function runTask(id: string): Promise<ScheduledTaskRun | null> {
  return requireSynapseBridge().taskScheduler.runTask(id)
}

async function stopRun(runId: string): Promise<{ stopped: boolean }> {
  return requireSynapseBridge().taskScheduler.stopRun(runId)
}

async function listRuns(taskId: string, limit = 100): Promise<ScheduledTaskRun[]> {
  return requireSynapseBridge().taskScheduler.listRuns(taskId, { limit })
}

async function exportTasksToFile(json: string): Promise<{ success: boolean; path?: string }> {
  return requireSynapseBridge().taskScheduler.exportTasksToFile(json)
}

async function importTasksFromFile(): Promise<{ success: boolean; content?: string }> {
  return requireSynapseBridge().taskScheduler.importTasksFromFile()
}

function errorMessageLength(error: unknown): number {
  if (error instanceof Error) return error.message.length
  return String(error).length
}

export {
  createTask,
  deleteTask,
  exportTasksToFile,
  importTasksFromFile,
  listRuns,
  runTask,
  setTaskEnabled,
  stopRun,
  updateTask,
  useTaskSchedulerTasks,
}
