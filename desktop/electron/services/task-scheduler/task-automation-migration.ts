import type { StructuredLogger } from "../../runtime/service-registry"
import type { AutomationCreateInput, AutomationService } from "../automation"
import type { TaskSchedulerService } from "./task-scheduler-service"
import type { ScheduledTaskEntry } from "./types"

export type ScheduledTaskMigrationResult = {
  readonly automationId: string
  readonly deletedTaskId: string
}

export function buildAutomationCreateInputFromTask(
  task: ScheduledTaskEntry,
): AutomationCreateInput {
  return {
    name: task.name,
    description: task.description,
    enabled: task.enabled && task.validation?.status !== "needs_update",
    scope: task.scope,
    cwd: task.cwd,
    trigger: {
      type: task.trigger.type,
      config: {
        ...task.trigger.config,
        activeDays: [...task.activeDays],
      },
    },
    executor: task.action,
    policy: {
      missedRunPolicy: task.missedRunPolicy,
      overlapPolicy: "skip",
    },
  }
}

export interface MigrateTaskToAutomationInput {
  readonly taskId: string
  readonly scheduler: Pick<
    TaskSchedulerService,
    "schedulerTaskGet" | "stopRun" | "deleteTask" | "schedulerTaskDisable"
  >
  readonly automation: Pick<
    AutomationService,
    "automationCreate" | "automationDelete" | "automationDisable"
  >
  readonly logger?: StructuredLogger
}

export async function migrateTaskToAutomation({
  taskId,
  scheduler,
  automation,
  logger,
}: MigrateTaskToAutomationInput): Promise<ScheduledTaskMigrationResult> {
  const startedAt = Date.now()
  logger?.info("Scheduled task migration started.", {
    boundary: "task-scheduler.migrate-to-automation",
    taskId,
  })

  const firstTask = await scheduler.schedulerTaskGet(taskId)
  if (!firstTask) throw new Error(`任务不存在：${taskId}`)

  if (firstTask.activeRun?.status === "running") {
    const activeRunId = firstTask.activeRun.id
    if (!activeRunId) throw new Error("停止运行失败")
    const stopResult = await scheduler.stopRun(activeRunId)
    if (!stopResult.stopped) {
      throw new Error("停止运行失败")
    }
  }

  const task = await scheduler.schedulerTaskGet(taskId)
  if (!task) throw new Error(`任务不存在：${taskId}`)

  const createInput = buildAutomationCreateInputFromTask(task)
  let automationId: string | undefined
  try {
    const created = await automation.automationCreate(createInput)
    automationId = created.id
    const deleted = await scheduler.deleteTask(taskId)
    if (!deleted.deleted) {
      throw new Error(`任务删除失败：${taskId}`)
    }
    logger?.info("Scheduled task migration finished.", {
      boundary: "task-scheduler.migrate-to-automation",
      taskId,
      automationId,
      triggerType: task.trigger.type,
      executorType: task.action.type,
      stoppedActiveRun: firstTask.activeRun?.status === "running",
      durationMs: Date.now() - startedAt,
    })
    return { automationId, deletedTaskId: taskId }
  } catch (error) {
    if (automationId) {
      await rollbackCreatedAutomation({
        taskId,
        automationId,
        scheduler,
        automation,
        logger,
      })
    }
    logger?.warn("Scheduled task migration failed.", {
      boundary: "task-scheduler.migrate-to-automation",
      taskId,
      automationId,
      durationMs: Date.now() - startedAt,
      ...errorMetadata(error),
    })
    throw error
  }
}

async function rollbackCreatedAutomation({
  taskId,
  automationId,
  scheduler,
  automation,
  logger,
}: {
  readonly taskId: string
  readonly automationId: string
  readonly scheduler: Pick<TaskSchedulerService, "schedulerTaskDisable">
  readonly automation: Pick<AutomationService, "automationDelete" | "automationDisable">
  readonly logger?: StructuredLogger
}): Promise<void> {
  try {
    await automation.automationDelete(automationId)
    logger?.info("Rolled back migrated automation.", {
      boundary: "task-scheduler.migrate-to-automation.rollback",
      taskId,
      automationId,
    })
  } catch (rollbackError) {
    logger?.warn("Failed to delete migrated automation during rollback.", {
      boundary: "task-scheduler.migrate-to-automation.rollback",
      taskId,
      automationId,
      ...errorMetadata(rollbackError),
    })
    await Promise.allSettled([
      automation.automationDisable(automationId),
      scheduler.schedulerTaskDisable(taskId),
    ])
  }
}

function errorMetadata(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
} {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}
