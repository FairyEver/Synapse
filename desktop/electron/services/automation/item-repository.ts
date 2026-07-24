import { randomUUID } from "node:crypto"

import type { ActionManifest } from "../../../action-packages/types"
import type { DataChangeEvent, DataNamespace } from "../../runtime/data-repo"
import type { AutomationTriggerRegistry } from "./trigger-registry"
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
  readonly resolveActionManifest?: (type: string) => ActionManifest | undefined
}

export class AutomationItemRepository {
  private readonly items: DataNamespace<AutomationItem>
  private readonly triggers: AutomationTriggerRegistry
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly resolveActionManifest: (type: string) => ActionManifest | undefined
  private readonly itemQueues = new Map<string, Promise<void>>()
  private readonly itemCache = new Map<string, AutomationItem>()
  private readonly webhookTriggerIndex = new Map<string, Set<string>>()
  private indexHydrated = false

  constructor(deps: AutomationItemRepositoryDeps) {
    this.items = deps.items
    this.triggers = deps.triggers
    this.now = deps.now ?? (() => new Date())
    this.idFactory = deps.idFactory ?? (() => `automation:${randomUUID()}`)
    this.resolveActionManifest = deps.resolveActionManifest ?? (() => undefined)
    this.items.onChange((change) => this.applyItemChange(change))
  }

  async create(input: AutomationCreateInput): Promise<AutomationItem> {
    const now = this.isoNow()
    const actionPolicy = this.resolveActionManifest(input.executor.type)?.automationPolicy
    const enabled = actionPolicy?.initiallyDisabled ? false : input.enabled ?? true
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
      nextRunAt: enabled ? this.computeNextRunAtIso(item, this.now()) : undefined,
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
      const executionChanged = actionExecutionChanged(
        existing,
        candidate,
        this.resolveActionManifest,
      )
      const effectiveCandidate = executionChanged
        ? { ...candidate, enabled: false }
        : candidate
      return {
        ...effectiveCandidate,
        nextRunAt: effectiveCandidate.enabled ? this.computeNextRunAtIso(effectiveCandidate, this.now()) : undefined,
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

  async list(): Promise<AutomationItem[]> {
    const items = await this.items.list()
    this.rebuildIndexes(items)
    return items
  }

  async listWebhookTriggerCandidates(webhookPublicId: string): Promise<AutomationItem[]> {
    if (!this.indexHydrated) {
      await this.list()
    }
    const ids = this.webhookTriggerIndex.get(webhookPublicId)
    if (!ids) return []
    return [...ids]
      .map((id) => this.itemCache.get(id))
      .filter((item): item is AutomationItem => Boolean(item))
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
        nextRunAt: enabled ? this.computeNextRunAtIso(candidate, this.now()) : undefined,
      }
    })
    if (!next) throw new Error(`Automation "${id}" was not found`)
    return next
  }

  async markScheduled(id: string, nextRunAt: string | undefined): Promise<AutomationItem | null> {
    return this.mutateItem(id, (existing) => ({
      ...existing,
      nextRunAt,
    }))
  }

  async markRunResult(
    id: string,
    result: { readonly status: AutomationRunStatus },
  ): Promise<AutomationItem | null> {
    return this.mutateItem(id, (existing) => {
      const now = this.isoNow()
      const trigger = this.triggers.get(existing.trigger.type)
      const reschedulePolicy = existing.enabled
        ? trigger.runtime.getReschedulePolicy?.(
          trigger.manifest.configSchema.parse(existing.trigger.config),
        )
        : undefined
      const recalcNextRunAt = existing.enabled &&
        reschedulePolicy?.mode === "after_completion"
      const next: AutomationItem = {
        ...existing,
        lastRunAt: now,
        lastStatus: result.status,
        runCount: existing.runCount + 1,
      }
      const nextRunAt = recalcNextRunAt
        ? this.computeNextRunAtIso(next, this.now())
        : existing.nextRunAt
      return {
        ...next,
        ...(recalcNextRunAt ? { nextRunAt } : {}),
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

  private rebuildIndexes(items: readonly AutomationItem[]): void {
    this.itemCache.clear()
    this.webhookTriggerIndex.clear()
    for (const item of items) {
      this.indexItem(item)
    }
    this.indexHydrated = true
  }

  private applyItemChange(change: DataChangeEvent<AutomationItem>): void {
    if (change.kind === "clear") {
      this.itemCache.clear()
      this.webhookTriggerIndex.clear()
      this.indexHydrated = true
      return
    }
    if (change.kind === "replace") {
      this.itemCache.clear()
      this.webhookTriggerIndex.clear()
      this.indexHydrated = false
      return
    }
    if (change.previous) {
      this.unindexItem(change.previous)
    }
    if (change.kind === "upsert" && change.value) {
      this.indexItem(change.value)
    }
  }

  private indexItem(item: AutomationItem): void {
    this.itemCache.set(item.id, item)
    const webhookPublicId = webhookPublicIdForItem(item)
    if (!webhookPublicId) return
    const ids = this.webhookTriggerIndex.get(webhookPublicId) ?? new Set<string>()
    ids.add(item.id)
    this.webhookTriggerIndex.set(webhookPublicId, ids)
  }

  private unindexItem(item: AutomationItem): void {
    this.itemCache.delete(item.id)
    const webhookPublicId = webhookPublicIdForItem(item)
    if (!webhookPublicId) return
    const ids = this.webhookTriggerIndex.get(webhookPublicId)
    if (!ids) return
    ids.delete(item.id)
    if (ids.size === 0) {
      this.webhookTriggerIndex.delete(webhookPublicId)
    }
  }

  private normalizeTrigger(trigger: AutomationTriggerRef): AutomationTriggerRef {
    return this.triggers.normalize(trigger)
  }

  private computeNextRunAt(item: AutomationItem, from: Date): Date | null {
    const trigger = this.triggers.get(item.trigger.type)
    if (trigger.manifest.kind !== "schedule") return null
    if (!trigger.runtime.computeNextRunAt) {
      throw new Error(`Automation trigger "${item.trigger.type}" does not support scheduling`)
    }
    return trigger.runtime.computeNextRunAt({
      config: item.trigger.config,
      from,
      createdAt: item.createdAt,
      lastRunAt: item.lastRunAt,
    })
  }

  private computeNextRunAtIso(item: AutomationItem, from: Date): string | undefined {
    return this.computeNextRunAt(item, from)?.toISOString()
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function actionExecutionChanged(
  previous: AutomationItem,
  next: AutomationItem,
  resolveManifest: (type: string) => ActionManifest | undefined,
): boolean {
  const previousPolicy = resolveManifest(previous.executor.type)?.automationPolicy
  const nextPolicy = resolveManifest(next.executor.type)?.automationPolicy
  if (!previousPolicy?.disableOnExecutionChange && !nextPolicy?.disableOnExecutionChange) return false
  const ignoredFields = new Set([
    ...(previousPolicy?.nonExecutionConfigFields ?? []),
    ...(nextPolicy?.nonExecutionConfigFields ?? []),
  ])
  return canonicalExecutionValue({
    scope: previous.scope,
    cwd: previous.cwd,
    trigger: previous.trigger,
    executor: {
      type: previous.executor.type,
      config: withoutConfigFields(previous.executor.config, ignoredFields),
    },
    policy: previous.policy,
  }) !== canonicalExecutionValue({
    scope: next.scope,
    cwd: next.cwd,
    trigger: next.trigger,
    executor: {
      type: next.executor.type,
      config: withoutConfigFields(next.executor.config, ignoredFields),
    },
    policy: next.policy,
  })
}

function withoutConfigFields(
  config: Record<string, unknown>,
  ignoredFields: ReadonlySet<string>,
): Record<string, unknown> {
  const executionConfig = { ...config }
  for (const field of ignoredFields) delete executionConfig[field]
  return executionConfig
}

function canonicalExecutionValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalExecutionValue).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalExecutionValue(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
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

function webhookPublicIdForItem(item: AutomationItem): string | null {
  if (!item.enabled || item.trigger.type !== "builtin.webhook") return null
  const config = item.trigger.config
  if (!isRecord(config)) return null
  const webhookPublicId = config.webhookPublicId
  return typeof webhookPublicId === "string" && webhookPublicId.trim() ? webhookPublicId : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function definedPatch<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}
