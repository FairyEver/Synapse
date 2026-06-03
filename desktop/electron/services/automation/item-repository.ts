import { randomUUID } from "node:crypto"

import type { DataNamespace } from "../../runtime/data-repo"
import type { AutomationTriggerDefinition, AutomationTriggerRegistry } from "./trigger-registry"
import type {
  AutomationCreateInput,
  AutomationItem,
  AutomationPolicy,
  AutomationRunStatus,
  AutomationTriggerRef,
  AutomationUpdateInput,
} from "./types"

const DEFAULT_POLICY: AutomationPolicy = {
  missedRunPolicy: "skip",
  overlapPolicy: "skip",
}

export interface AutomationItemRepositoryDeps {
  readonly items: DataNamespace<AutomationItem>
  readonly triggers: AutomationTriggerRegistry
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export class AutomationItemRepository {
  private readonly items: DataNamespace<AutomationItem>
  private readonly triggers: AutomationTriggerRegistry
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly itemQueues = new Map<string, Promise<void>>()

  constructor(deps: AutomationItemRepositoryDeps) {
    this.items = deps.items
    this.triggers = deps.triggers
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? (() => `automation:${randomUUID()}`)
  }

  async create(input: AutomationCreateInput): Promise<AutomationItem> {
    const now = this.isoNow()
    const enabled = input.enabled ?? true
    const trigger = this.normalizeTrigger(input.trigger)
    const item: AutomationItem = {
      id: this.idFactory(),
      schemaVersion: 1,
      name: input.name,
      description: input.description,
      enabled,
      scope: input.scope,
      cwd: input.cwd,
      trigger,
      executor: input.executor,
      policy: normalizePolicy(input.policy),
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      configVersion: 0,
    }
    validateItem(item)
    const next: AutomationItem = {
      ...item,
      nextRunAt: enabled ? this.computeNextRunAt(item, this.now()).toISOString() : undefined,
    }
    await this.items.upsert(next)
    return next
  }

  async update(id: string, patch: AutomationUpdateInput): Promise<AutomationItem> {
    const next = await this.mutateItem(id, (existing) => {
      const trigger = patch.trigger ? this.normalizeTrigger(patch.trigger) : existing.trigger
      const candidate: AutomationItem = {
        ...existing,
        ...definedPatch({
          name: patch.name,
          description: patch.description,
          enabled: patch.enabled,
          scope: patch.scope,
          cwd: patch.cwd,
        }),
        trigger,
        executor: patch.executor ?? existing.executor,
        policy: normalizePolicy({ ...existing.policy, ...patch.policy }),
        updatedAt: this.isoNow(),
        configVersion: existing.configVersion + 1,
      }
      validateItem(candidate)
      return {
        ...candidate,
        nextRunAt: candidate.enabled
          ? this.computeNextRunAt(candidate, this.now()).toISOString()
          : undefined,
      }
    })
    if (!next) throw new Error(`Automation "${id}" was not found`)
    return next
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.items.get(id)
    if (!existing) return false
    await this.items.remove(id)
    return true
  }

  get(id: string): Promise<AutomationItem | null> {
    return this.items.get(id)
  }

  list(): Promise<AutomationItem[]> {
    return this.items.list()
  }

  async setEnabled(id: string, enabled: boolean): Promise<AutomationItem> {
    const next = await this.mutateItem(id, (existing) => {
      const candidate: AutomationItem = {
        ...existing,
        enabled,
        updatedAt: this.isoNow(),
      }
      return {
        ...candidate,
        nextRunAt: enabled
          ? this.computeNextRunAt(candidate, this.now()).toISOString()
          : undefined,
      }
    })
    if (!next) throw new Error(`Automation "${id}" was not found`)
    return next
  }

  async markScheduled(id: string, nextRunAt: string | undefined): Promise<AutomationItem | null> {
    return this.mutateItem(id, (existing) => ({
      ...existing,
      nextRunAt,
      updatedAt: this.isoNow(),
    }))
  }

  async markRunResult(
    id: string,
    result: { readonly status: AutomationRunStatus },
  ): Promise<AutomationItem | null> {
    return this.mutateItem(id, (existing) => {
      const now = this.isoNow()
      const recalcNextRunAt = existing.enabled &&
        existing.trigger.type === "builtin.interval" &&
        existing.trigger.config.anchor === "last_completed_at"
      const next: AutomationItem = {
        ...existing,
        lastRunAt: now,
        lastStatus: result.status,
        runCount: existing.runCount + 1,
        updatedAt: now,
      }
      return {
        ...next,
        ...(recalcNextRunAt
          ? { nextRunAt: this.computeNextRunAt(next, this.now()).toISOString() }
          : {}),
      }
    })
  }

  private async mutateItem(
    id: string,
    updater: (existing: AutomationItem) => AutomationItem,
  ): Promise<AutomationItem | null> {
    const previous = this.itemQueues.get(id) ?? Promise.resolve()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => gate)
    this.itemQueues.set(id, queued)

    await previous.catch(() => undefined)
    try {
      const existing = await this.items.get(id)
      if (!existing) return null
      const next = updater(existing)
      await this.items.upsert(next)
      return next
    } finally {
      release()
      if (this.itemQueues.get(id) === queued) {
        this.itemQueues.delete(id)
      }
    }
  }

  private normalizeTrigger(trigger: AutomationTriggerRef): AutomationTriggerRef {
    return this.triggers.normalize(trigger)
  }

  private computeNextRunAt(item: AutomationItem, from: Date): Date {
    const trigger = this.triggers.get(item.trigger.type) as AutomationTriggerDefinition<Record<string, unknown>>
    if (!trigger.computeNextRunAt) {
      throw new Error(`Automation trigger "${item.trigger.type}" does not support scheduling`)
    }
    return trigger.computeNextRunAt({
      config: item.trigger.config,
      from,
      createdAt: item.createdAt,
      lastRunAt: item.lastRunAt,
    })
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function normalizePolicy(policy: Partial<AutomationPolicy> | undefined): AutomationPolicy {
  return {
    missedRunPolicy: policy?.missedRunPolicy ?? DEFAULT_POLICY.missedRunPolicy,
    overlapPolicy: "skip",
  }
}

function validateItem(item: AutomationItem): void {
  if (!item.name.trim()) throw new Error("name is required")
  if (item.scope.type === "project" && !item.scope.projectId.trim()) {
    throw new Error("projectId is required")
  }
  if (!item.trigger.type.trim()) throw new Error("trigger type is required")
  if (!item.executor.type.trim()) throw new Error("executor type is required")
}

function definedPatch<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
