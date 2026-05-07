import { useCallback, useEffect, useState } from "react"

import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRun,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"

function useTaskSchedulerTasks() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const nextTasks = await requireSynapseBridge().taskScheduler.listTasks()
      setTasks(nextTasks)
      setError(null)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "读取任务失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
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
