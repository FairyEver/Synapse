import { randomUUID } from "node:crypto"

import type { DataNamespace } from "../../runtime/data-repo"
import { computeNextRunAt } from "./schedule-calculator"
import type {
  ScheduledTaskEntry,
  ScheduledTaskCreateInput,
  ScheduledTaskRunStatus,
  ScheduledTaskUpdateInput,
  TaskTrigger,
} from "./types"
import { validateCronExpression } from "./cron-expression"

export interface ScheduledTaskRepositoryDeps {
  readonly tasks: DataNamespace<ScheduledTaskEntry>
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export class ScheduledTaskRepository {
  private readonly tasks: DataNamespace<ScheduledTaskEntry>
  private readonly now: () => Date
  private readonly idFactory: () => string

  constructor(deps: ScheduledTaskRepositoryDeps) {
    this.tasks = deps.tasks
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? (() => `task:${randomUUID()}`)
  }

  async create(input: ScheduledTaskCreateInput): Promise<ScheduledTaskEntry> {
    const now = this.isoNow()
    const enabled = input.enabled ?? true
    const trigger = normalizeTrigger(input.trigger)
    const task: ScheduledTaskEntry = {
      id: this.idFactory(),
      schemaVersion: 2,
      name: input.name,
      description: input.description,
      scope: input.scope,
      cwd: input.cwd,
      trigger,
      action: input.action,
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
        ? computeNextRunAt({ trigger, from: this.now(), createdAt: now }).toISOString()
        : undefined,
    }
    await this.tasks.upsert(next)
    return next
  }

  async update(id: string, patch: ScheduledTaskUpdateInput): Promise<ScheduledTaskEntry> {
    const existing = await this.require(id)
    const trigger = normalizeTrigger(patch.trigger ?? existing.trigger)
    const enabled = patch.enabled ?? existing.enabled
    const next: ScheduledTaskEntry = {
      ...existing,
      ...definedPatch({
        name: patch.name,
        description: patch.description,
        scope: patch.scope,
        cwd: patch.cwd,
        trigger,
        missedRunPolicy: patch.missedRunPolicy,
        enabled: patch.enabled,
      }),
      action: patch.action === undefined ? existing.action : patch.action,
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

  get(id: string): Promise<ScheduledTaskEntry | null> {
    return this.tasks.get(id)
  }

  list(): Promise<ScheduledTaskEntry[]> {
    return this.tasks.list()
  }

  async setEnabled(id: string, enabled: boolean): Promise<ScheduledTaskEntry> {
    return this.update(id, { enabled })
  }

  async markScheduled(id: string, nextRunAt: string | undefined): Promise<ScheduledTaskEntry | null> {
    const existing = await this.tasks.get(id)
    if (!existing) return null
    const next: ScheduledTaskEntry = {
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
  ): Promise<ScheduledTaskEntry | null> {
    const existing = await this.tasks.get(id)
    if (!existing) return null
    const next: ScheduledTaskEntry = {
      ...existing,
      lastRunAt: this.isoNow(),
      lastStatus: result.status,
      runCount: existing.runCount + 1,
      updatedAt: this.isoNow(),
    }
    await this.tasks.upsert(next)
    return next
  }

  private async require(id: string): Promise<ScheduledTaskEntry> {
    const task = await this.tasks.get(id)
    if (!task) throw new Error(`Scheduled task "${id}" was not found`)
    return task
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function normalizeTrigger(trigger: TaskTrigger): TaskTrigger {
  if (trigger.type === "builtin.interval") {
    return {
      type: "builtin.interval",
      config: {
        ...trigger.config,
        anchor: trigger.config.anchor ?? "created_at",
      },
    }
  }
  return trigger
}

function validateTask(task: ScheduledTaskEntry): void {
  if (!task.name.trim()) throw new Error("name is required")
  if (task.scope.type === "project" && !task.scope.projectId.trim()) {
    throw new Error("projectId is required")
  }
  if (task.trigger.type === "builtin.cron") {
    validateCronExpression(task.trigger.config.expr)
  } else if (
    !Number.isInteger(task.trigger.config.everyMinutes)
    || task.trigger.config.everyMinutes < 1
  ) {
    throw new Error("everyMinutes must be >= 1")
  }
  if (!task.action.type.trim()) throw new Error("action type is required")
}

function definedPatch<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
