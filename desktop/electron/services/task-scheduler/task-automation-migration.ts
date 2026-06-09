import type { AutomationCreateInput } from "../automation"
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

export async function migrateTaskToAutomation(): Promise<ScheduledTaskMigrationResult> {
  throw new Error("migrateTaskToAutomation is not wired")
}
