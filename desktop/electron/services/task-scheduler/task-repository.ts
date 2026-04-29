import { randomUUID } from "node:crypto"

import type { DataNamespace, ScheduledTaskEntryV1 } from "../../runtime/data-repo"
import { computeNextRunAt } from "./schedule-calculator"
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskRunStatus,
  ScheduledTaskUpdateInput,
  TaskAction,
} from "./types"
import { validateCronExpression } from "./cron-expression"

export interface ScheduledTaskRepositoryDeps {
  readonly tasks: DataNamespace<ScheduledTaskEntryV1>
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export class ScheduledTaskRepository {
  private readonly tasks: DataNamespace<ScheduledTaskEntryV1>
  private readonly now: () => Date
  private readonly idFactory: () => string

  constructor(deps: ScheduledTaskRepositoryDeps) {
    this.tasks = deps.tasks
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? (() => `task:${randomUUID()}`)
  }

  async create(input: ScheduledTaskCreateInput): Promise<ScheduledTaskEntryV1> {
    const now = this.isoNow()
    const enabled = input.enabled ?? true
    const task: ScheduledTaskEntryV1 = {
      id: this.idFactory(),
      schemaVersion: 1,
      name: input.name,
      description: input.description,
      scope: input.scope,
      cwd: input.cwd,
      trigger: input.trigger,
      action: normalizeAction(input.action),
      enabled,
      missedRunPolicy: input.missedRunPolicy ?? "skip",
      overlapPolicy: "skip",
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    }
    validateTask(task)
    const next = {
      ...task,
      nextRunAt: enabled
        ? computeNextRunAt({ trigger: input.trigger, from: this.now(), createdAt: now }).toISOString()
        : undefined,
    }
    await this.tasks.upsert(next)
    return next
  }

  async update(id: string, patch: ScheduledTaskUpdateInput): Promise<ScheduledTaskEntryV1> {
    const existing = await this.require(id)
    const trigger = patch.trigger ?? existing.trigger
    const enabled = patch.enabled ?? existing.enabled
    const next: ScheduledTaskEntryV1 = {
      ...existing,
      ...definedPatch({
        name: patch.name,
        description: patch.description,
        scope: patch.scope,
        cwd: patch.cwd,
        trigger: patch.trigger,
        missedRunPolicy: patch.missedRunPolicy,
        enabled: patch.enabled,
      }),
      action: patch.action === undefined ? existing.action : normalizeAction(patch.action),
      nextRunAt: enabled
        ? computeNextRunAt({ trigger, from: this.now(), createdAt: existing.createdAt }).toISOString()
        : undefined,
      updatedAt: this.isoNow(),
    }
    validateTask(next)
    await this.tasks.upsert(next)
    return next
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.tasks.get(id)
    if (!existing) return false
    await this.tasks.remove(id)
    return true
  }

  get(id: string): Promise<ScheduledTaskEntryV1 | null> {
    return this.tasks.get(id)
  }

  list(): Promise<ScheduledTaskEntryV1[]> {
    return this.tasks.list()
  }

  async setEnabled(id: string, enabled: boolean): Promise<ScheduledTaskEntryV1> {
    return this.update(id, { enabled })
  }

  async markScheduled(id: string, nextRunAt: string | undefined): Promise<ScheduledTaskEntryV1 | null> {
    const existing = await this.tasks.get(id)
    if (!existing) return null
    const next: ScheduledTaskEntryV1 = {
      ...existing,
      nextRunAt,
      updatedAt: this.isoNow(),
    }
    await this.tasks.upsert(next)
    return next
  }

  async markRunResult(
    id: string,
    result: { readonly status: Exclude<ScheduledTaskRunStatus, "running"> },
  ): Promise<ScheduledTaskEntryV1 | null> {
    const existing = await this.tasks.get(id)
    if (!existing) return null
    const next: ScheduledTaskEntryV1 = {
      ...existing,
      lastRunAt: this.isoNow(),
      lastStatus: result.status,
      runCount: existing.runCount + 1,
      updatedAt: this.isoNow(),
    }
    await this.tasks.upsert(next)
    return next
  }

  private async require(id: string): Promise<ScheduledTaskEntryV1> {
    const task = await this.tasks.get(id)
    if (!task) throw new Error(`Scheduled task "${id}" was not found`)
    return task
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function normalizeAction(action: TaskAction): TaskAction {
  if (action.type !== "shell_command") return action
  return {
    ...action,
    timeoutMins: action.timeoutMins === undefined ? 30 : action.timeoutMins,
  }
}

function validateTask(task: ScheduledTaskEntryV1): void {
  if (!task.name.trim()) throw new Error("name is required")
  if (task.scope.type === "project" && !task.scope.projectId.trim()) {
    throw new Error("projectId is required")
  }
  if (task.trigger.type === "cron") {
    validateCronExpression(task.trigger.expr)
  }
  if (
    task.trigger.type === "interval"
    && (!Number.isInteger(task.trigger.everyMinutes) || task.trigger.everyMinutes < 1)
  ) {
    throw new Error("everyMinutes must be >= 1")
  }
  if (!task.action.content.trim()) throw new Error("action content is required")
  if (task.action.timeoutMins !== null && task.action.timeoutMins !== undefined) {
    if (!Number.isInteger(task.action.timeoutMins) || task.action.timeoutMins < 1) {
      throw new Error("timeoutMins must be >= 1 or null")
    }
  }
}

function definedPatch<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
