import type { AutomationTriggerEvent } from "../../../automation-trigger-packages/types.shared"
import type { MainActionRegistry } from "../../action-runtime/action-registry"
import type { EventBus } from "../../runtime/event-bus"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { AutomationExecutionService } from "./execution-service"
import type { AutomationItemRepository } from "./item-repository"
import type { AutomationRunRepository } from "./run-repository"
import type { AutomationTriggerRegistry } from "./trigger-registry"
import type {
  AutomationCreateInput,
  AutomationItem,
  AutomationListOptions,
  AutomationRun,
  AutomationRunTrigger,
  AutomationTriggerRuntimeContext,
  AutomationUpdateInput,
  AutomationValidation,
} from "./types"

const TIMER_MAX_DELAY_MS = 2_147_483_647
const STOP_SETTLE_WAIT_MS = 3_000
const NEEDS_UPDATE_MESSAGE = "自动化配置需要更新"
const INTERRUPTED_RUN_ERROR = "应用异常退出，运行已在启动恢复时标记为失败。"

export interface AutomationServiceDeps {
  readonly items: AutomationItemRepository
  readonly runs: AutomationRunRepository
  readonly triggers: AutomationTriggerRegistry
  readonly actions: MainActionRegistry
  readonly execution: AutomationExecutionService
  readonly defaultCwd: string
  readonly eventBus?: Pick<EventBus, "emit">
  readonly logger?: StructuredLogger
  readonly now?: () => Date
}

type AutomationChangeReason =
  | "created"
  | "updated"
  | "deleted"
  | "enabled"
  | "disabled"
  | "scheduled"
  | "run-started"
  | "run-finished"
  | "run-skipped"
  | "run-stopped"

type AutomationChangedPayload = {
  readonly automationId?: string
  readonly runId?: string
  readonly reason: AutomationChangeReason
}

export class AutomationService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly runningItemIds = new Set<string>()
  private readonly eventRunChains = new Map<string, Promise<void>>()
  private started = false

  constructor(private readonly deps: AutomationServiceDeps) {}

  async start(): Promise<void> {
    if (this.started) return
    await this.recoverInterruptedRuns()
    const items = await this.deps.items.list()
    for (const item of items) {
      try {
        await this.scheduleOnStartup(item)
      } catch (error) {
        this.deps.logger?.warn?.("Automation startup failed, skipping.", {
          automationId: item.id,
          name: item.name,
          boundary: "automation-startup",
          ...errorMetadata(error),
        })
      }
    }
    this.started = true
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const runs = await this.deps.runs.listRunning()
    let recoveredCount = 0
    for (const run of runs) {
      try {
        const finished = await this.deps.runs.finish(run.id, {
          status: "failed",
          error: INTERRUPTED_RUN_ERROR,
          result: {
            status: "failed",
            summary: "应用异常退出",
            error: INTERRUPTED_RUN_ERROR,
          },
        })
        recoveredCount += 1
        this.emitAutomationChanged({
          automationId: finished.automationId,
          runId: finished.id,
          reason: "run-finished",
        })
        try {
          await this.deps.items.markRunResult(finished.automationId, { status: "failed" })
        } catch (markError) {
          this.deps.logger?.warn("markRunResult failed after startup automation run recovery.", {
            source: "automation",
            automationId: finished.automationId,
            runId: finished.id,
            status: "failed",
            boundary: "automation-startup-run-recovery",
            ...errorMetadata(markError),
          })
        }
      } catch (error) {
        this.deps.logger?.warn("Automation run startup recovery failed.", {
          automationId: run.automationId,
          runId: run.id,
          boundary: "automation-startup-run-recovery",
          ...errorMetadata(error),
        })
      }
    }
    if (recoveredCount > 0) {
      this.deps.logger?.info("Recovered interrupted automation runs.", {
        boundary: "automation-startup-run-recovery",
        recoveredCount,
      })
    }
  }

  async stop(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    try {
      await this.stopActiveRuns()
    } finally {
      this.runningItemIds.clear()
      this.started = false
    }
  }

  async automationList(options: AutomationListOptions = {}): Promise<AutomationItem[]> {
    const items = await this.deps.items.list()
    const limitedItems = items
      .filter((item) => options.enabled === undefined || item.enabled === options.enabled)
      .filter((item) => matchesAutomationScope(item, options.scope))
      .sort(compareAutomationItemsByRecentEdit)
      .slice(0, options.limit ?? items.length)
    const result = await Promise.all(limitedItems.map((item) => this.withRuntimeState(item)))
    this.deps.logger?.info("Automations listed.", {
      boundary: "automation.item-list",
      itemCount: result.length,
    })
    return result
  }

  async automationGet(id: string): Promise<AutomationItem | null> {
    const item = await this.deps.items.get(id)
    const result = item ? await this.withRuntimeState(item) : null
    this.deps.logger?.info("Automation loaded.", {
      boundary: "automation.item-get",
      automationId: id,
      found: Boolean(result),
    })
    return result
  }

  async automationCreate(input: AutomationCreateInput): Promise<AutomationItem> {
    const startedAt = Date.now()
    try {
      const item = await this.deps.items.create(this.normalizeCreateInput(input))
      if (this.started && item.enabled && this.isItemValid(item)) await this.schedule(item.id, item.nextRunAt)
      this.emitAutomationChanged({ automationId: item.id, reason: "created" })
      this.deps.logger?.info("Automation created.", {
        boundary: "automation.item-create",
        automationId: item.id,
        triggerType: item.trigger.type,
        executorType: item.executor.type,
        enabled: item.enabled,
        durationMs: Date.now() - startedAt,
      })
      return this.withRuntimeState(item)
    } catch (error) {
      this.deps.logger?.warn("Automation create failed.", {
        boundary: "automation.item-create",
        triggerType: input.trigger.type,
        executorType: input.executor.type,
        enabled: input.enabled,
        durationMs: Date.now() - startedAt,
        ...errorMetadata(error),
      })
      throw error
    }
  }

  async automationUpdate(id: string, patch: AutomationUpdateInput): Promise<AutomationItem> {
    const startedAt = Date.now()
    const normalizedPatch = this.normalizeUpdateInput(patch)
    const oldItem = await this.deps.items.get(id)
    this.cancel(id)
    try {
      const item = await this.deps.items.update(id, normalizedPatch)
      if (this.started && item.enabled && this.isItemValid(item)) await this.schedule(item.id, item.nextRunAt)
      this.emitAutomationChanged({ automationId: item.id, reason: "updated" })
      this.deps.logger?.info("Automation updated.", {
        boundary: "automation.item-update",
        automationId: item.id,
        patchKeys: Object.keys(patch),
        enabled: item.enabled,
        durationMs: Date.now() - startedAt,
      })
      return this.withRuntimeState(item)
    } catch (error) {
      if (this.started && oldItem?.enabled && oldItem.nextRunAt && this.isItemValid(oldItem)) {
        await this.schedule(oldItem.id, oldItem.nextRunAt)
      }
      this.deps.logger?.warn("Automation update failed.", {
        boundary: "automation.item-update",
        automationId: id,
        patchKeys: Object.keys(patch),
        durationMs: Date.now() - startedAt,
        ...errorMetadata(error),
      })
      throw error
    }
  }

  async automationDelete(id: string): Promise<{ readonly deleted: boolean }> {
    const startedAt = Date.now()
    if (this.runningItemIds.has(id) || this.deps.execution.getActiveRunIdForItem(id)) {
      throw new Error("Automation is currently running. Stop it before deleting.")
    }
    const oldItem = await this.deps.items.get(id)
    this.cancel(id)
    try {
      const deleted = await this.deps.items.delete(id)
      const deletedRunCount = deleted ? await this.deleteRunsAfterItemDelete(id) : 0
      if (deleted) this.emitAutomationChanged({ automationId: id, reason: "deleted" })
      this.deps.logger?.info("Automation deleted.", {
        boundary: "automation.item-delete",
        automationId: id,
        deleted,
        deletedRunCount,
        durationMs: Date.now() - startedAt,
      })
      return { deleted }
    } catch (error) {
      if (this.started && oldItem?.enabled && oldItem.nextRunAt && this.isItemValid(oldItem)) {
        await this.schedule(oldItem.id, oldItem.nextRunAt)
      }
      this.deps.logger?.warn("Automation delete failed.", {
        boundary: "automation.item-delete",
        automationId: id,
        durationMs: Date.now() - startedAt,
        ...errorMetadata(error),
      })
      throw error
    }
  }

  private async deleteRunsAfterItemDelete(id: string): Promise<number> {
    try {
      return await this.deps.runs.deleteByAutomation(id)
    } catch (error) {
      this.deps.logger?.warn("Automation run cleanup after delete failed.", {
        boundary: "automation.run-delete",
        automationId: id,
        ...errorMetadata(error),
      })
      return 0
    }
  }

  async automationEnable(id: string): Promise<AutomationItem> {
    return this.setAutomationEnabled(id, true)
  }

  async automationDisable(id: string): Promise<AutomationItem> {
    return this.setAutomationEnabled(id, false)
  }

  async runNow(id: string): Promise<AutomationRun | null> {
    const startedAt = Date.now()
    const item = await this.deps.items.get(id)
    if (!item) {
      this.deps.logger?.info("Automation manual run skipped because item was not found.", {
        boundary: "automation.run-now",
        automationId: id,
        found: false,
        durationMs: Date.now() - startedAt,
      })
      return null
    }
    if (!this.isItemValid(item)) {
      throw new Error(NEEDS_UPDATE_MESSAGE)
    }
    this.cancel(id)
    try {
      const run = await this.executeOrSkip(item, "manual")
      this.deps.logger?.info("Automation manual run requested.", {
        boundary: "automation.run-now",
        automationId: id,
        runId: run?.id,
        status: run?.status,
        durationMs: Date.now() - startedAt,
      })
      return run
    } catch (error) {
      this.deps.logger?.warn("Automation manual run failed.", {
        boundary: "automation.run-now",
        automationId: id,
        durationMs: Date.now() - startedAt,
        ...errorMetadata(error),
      })
      throw error
    } finally {
      await this.rescheduleAfterManualRun(id)
    }
  }

  runAutomationNow(id: string): Promise<AutomationRun | null> {
    return this.runNow(id)
  }

  async acceptEvent(event: AutomationTriggerEvent): Promise<AutomationRun[]> {
    const startedAt = Date.now()
    const traceMetadata = automationEventTraceMetadata(event)
    this.deps.logger?.info("Automation event received.", {
      source: "automation",
      eventSource: event.source,
      eventType: event.type,
      receivedAt: event.receivedAt,
      ...traceMetadata,
      boundary: "automation-event-trigger",
    })
    const items = await this.listEventCandidateItems(event, traceMetadata.webhookPublicId)
    const acceptedRunPromises: Array<Promise<AutomationRun | null>> = []
    let matchedCount = 0
    for (const item of items) {
      if (!item.enabled) continue
      if (!this.isItemValid(item)) {
        this.logInvalidEventTriggerConfig(item)
        continue
      }
      const trigger = this.deps.triggers.get(item.trigger.type)
      if (trigger.manifest.kind !== "event") continue
      if (!trigger.runtime.shouldAcceptEvent) continue
      const parsedConfig = trigger.manifest.configSchema.safeParse(item.trigger.config)
      if (!parsedConfig.success) {
        this.warnEventTriggerConfigInvalid(item, parsedConfig.error)
        continue
      }
      try {
        const accepted = await trigger.runtime.shouldAcceptEvent({ config: parsedConfig.data, event })
        if (!accepted) continue
        matchedCount += 1
      } catch (error) {
        this.deps.logger?.warn("Automation event trigger failed, skipping item.", {
          automationId: item.id,
          triggerType: item.trigger.type,
          boundary: "automation-event-trigger",
          ...errorMetadata(error),
        })
        continue
      }
      const triggerContext: AutomationTriggerRuntimeContext = {
        triggeredBy: "trigger",
        triggeredAt: event.receivedAt,
        scheduledAt: event.receivedAt,
        event,
      }
      acceptedRunPromises.push(
        this.executeQueuedEvent(item, triggerContext).catch((error) => {
          this.deps.logger?.warn("Automation event execution failed, skipping item.", {
            automationId: item.id,
            triggerType: item.trigger.type,
            executorType: item.executor.type,
            boundary: "automation-event-trigger",
            ...errorMetadata(error),
          })
          return null
        }),
      )
    }
    const acceptedRuns = (await Promise.all(acceptedRunPromises))
      .filter((run): run is AutomationRun => run !== null)
    this.deps.logger?.info("Automation event processing complete.", {
      source: "automation",
      eventSource: event.source,
      eventType: event.type,
      receivedAt: event.receivedAt,
      ...traceMetadata,
      checkedCount: items.length,
      matchedCount,
      acceptedCount: acceptedRuns.length,
      durationMs: Date.now() - startedAt,
      boundary: "automation-event-trigger",
    })
    return acceptedRuns
  }

  private listEventCandidateItems(
    event: AutomationTriggerEvent,
    webhookPublicId: string | undefined,
  ): Promise<AutomationItem[]> {
    if (event.source === "webhook" && webhookPublicId) {
      return this.deps.items.listWebhookTriggerCandidates(webhookPublicId)
    }
    return this.deps.items.list()
  }

  async stopRun(runId: string): Promise<{
    readonly stopped: boolean
    readonly alreadyFinished?: boolean
    readonly stopRequested?: boolean
  }> {
    const run = await this.deps.runs.get(runId)
    const abortRequested = this.deps.execution.stopRun(runId)
    const alreadyFinished = Boolean(run && !abortRequested)
    const settled = abortRequested
      ? await Promise.race([
        this.deps.execution.waitForRunToSettle(runId),
        delay(STOP_SETTLE_WAIT_MS).then(() => false),
      ])
      : false
    const stopped = abortRequested && settled
    const stopRequested = abortRequested && !settled
    this.deps.logger?.info("Automation stop requested.", {
      ...(run ? { automationId: run.automationId } : {}),
      runId,
      stopped,
      stopRequested,
      alreadyFinished,
      runFound: Boolean(run),
      boundary: "automation-stop-run",
    })
    if (stopped || alreadyFinished) {
      this.emitAutomationChanged({ automationId: run?.automationId, runId, reason: "run-stopped" })
    }
    return {
      stopped,
      ...(alreadyFinished ? { alreadyFinished: true } : {}),
      ...(stopRequested ? { stopRequested: true } : {}),
    }
  }

  async automationRunList(
    automationId: string,
    options?: { readonly limit?: number },
  ): Promise<AutomationRun[]> {
    try {
      const runs = await this.deps.runs.listByAutomation(automationId, options)
      this.deps.logger?.info("Automation runs listed.", {
        boundary: "automation.run-list",
        automationId,
        runCount: runs.length,
        limit: options?.limit,
      })
      return runs
    } catch (error) {
      this.deps.logger?.warn("Automation runs list failed.", {
        boundary: "automation.run-list",
        automationId,
        limit: options?.limit,
        ...errorMetadata(error),
      })
      throw error
    }
  }

  async triggerForTest(
    id: string,
    triggeredBy: AutomationRunTrigger,
  ): Promise<AutomationRun | null> {
    return this.runScheduled(id, triggeredBy, { respectNextRunAt: false })
  }

  automationRuntimeInspect(): {
    readonly timers: readonly string[]
    readonly runningItemIds: readonly string[]
  } {
    return {
      timers: [...this.timers.keys()],
      runningItemIds: [...this.runningItemIds],
    }
  }

  private async setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationItem> {
    const startedAt = Date.now()
    const oldItem = await this.deps.items.get(id)
    if (enabled && oldItem && !this.isItemValid(oldItem)) {
      throw new Error(NEEDS_UPDATE_MESSAGE)
    }
    this.cancel(id)
    try {
      const item = await this.deps.items.setEnabled(id, enabled)
      if (this.started && item.enabled && this.isItemValid(item)) await this.schedule(item.id, item.nextRunAt)
      this.emitAutomationChanged({ automationId: item.id, reason: enabled ? "enabled" : "disabled" })
      this.deps.logger?.info("Automation enabled state changed.", {
        boundary: "automation.item-set-enabled",
        automationId: item.id,
        enabled: item.enabled,
        durationMs: Date.now() - startedAt,
      })
      return this.withRuntimeState(item)
    } catch (error) {
      if (this.started && oldItem?.enabled && oldItem.nextRunAt && this.isItemValid(oldItem)) {
        await this.schedule(oldItem.id, oldItem.nextRunAt)
      }
      this.deps.logger?.warn("Automation enabled state change failed.", {
        boundary: "automation.item-set-enabled",
        automationId: id,
        enabled,
        durationMs: Date.now() - startedAt,
        ...errorMetadata(error),
      })
      throw error
    }
  }

  private async stopActiveRuns(): Promise<void> {
    const runIds = new Set(this.deps.execution.getActiveRunIds())
    for (const itemId of this.runningItemIds) {
      const runId = this.deps.execution.getActiveRunIdForItem(itemId)
      if (runId) runIds.add(runId)
    }
    await Promise.all([...runIds].map((runId) => this.stopRun(runId)))
  }

  private async scheduleOnStartup(item: AutomationItem): Promise<void> {
    if (!this.isItemValid(item)) return
    if (!item.enabled) return
    const nextRunAt = item.nextRunAt ? new Date(item.nextRunAt) : null
    if (!nextRunAt || Number.isNaN(nextRunAt.getTime()) || nextRunAt.getTime() > this.now().getTime()) {
      await this.schedule(item.id, item.nextRunAt)
      return
    }
    if (item.policy.missedRunPolicy === "run_once") {
      this.runScheduledInBackground(item.id, "missed_run")
      return
    }
    await this.schedule(item.id)
  }

  private async schedule(id: string, preferredNextRunAt?: string): Promise<void> {
    this.cancel(id)
    const item = await this.deps.items.get(id)
    if (!item?.enabled) return
    if (!this.isItemValid(item)) return
    const nextRunAt = this.resolveNextRunAt(item, preferredNextRunAt)
    if (!nextRunAt) {
      try {
        await this.deps.items.markScheduled(id, undefined)
      } catch (error) {
        this.deps.logger?.warn?.("Automation markScheduled failed for unscheduled trigger.", {
          automationId: id,
          boundary: "automation-schedule-none",
          ...errorMetadata(error),
        })
      }
      return
    }
    try {
      await this.deps.items.markScheduled(id, nextRunAt.toISOString())
    } catch (error) {
      this.deps.logger?.warn?.("Automation markScheduled failed, scheduling in memory only.", {
        automationId: id,
        boundary: "automation-schedule-fallback",
        ...errorMetadata(error),
      })
    }
    const delayMs = Math.min(
      TIMER_MAX_DELAY_MS,
      Math.max(0, nextRunAt.getTime() - this.now().getTime()),
    )
    const timer = setTimeout(() => {
      this.runScheduledInBackground(id, "trigger")
    }, delayMs)
    this.timers.set(id, timer)
    this.emitAutomationChanged({ automationId: id, reason: "scheduled" })
    this.deps.logger?.info?.("Automation timer set.", {
      automationId: id,
      nextRunAt: nextRunAt.toISOString(),
      delayMs,
      boundary: "automation-schedule-timer",
    })
  }

  private runScheduledInBackground(id: string, triggeredBy: AutomationRunTrigger): void {
    void this.runScheduled(id, triggeredBy).catch((error) => {
      this.deps.logger?.warn("Automation background run failed.", {
        automationId: id,
        triggeredBy,
        boundary: "automation-background-run",
        ...errorMetadata(error),
      })
    })
  }

  private async runScheduled(
    id: string,
    triggeredBy: AutomationRunTrigger,
    options: { readonly respectNextRunAt?: boolean } = {},
  ): Promise<AutomationRun | null> {
    this.timers.delete(id)
    const item = await this.deps.items.get(id)
    if (!item) return null
    if (!item.enabled) {
      return this.recordSkipped(item, triggeredBy, "automation is disabled")
    }
    if (!this.isItemValid(item)) {
      return this.recordSkipped(item, triggeredBy, NEEDS_UPDATE_MESSAGE)
    }
    if (options.respectNextRunAt !== false && await this.deferTriggerRunUntilDue(item, triggeredBy)) return null
    const trigger = this.deps.triggers.get(item.trigger.type)
    const parsedTriggerConfig = trigger.manifest.configSchema.parse(item.trigger.config)
    if (trigger.runtime.shouldRunNow && !trigger.runtime.shouldRunNow({
      config: parsedTriggerConfig,
      now: this.now(),
    })) {
      await this.schedule(id)
      return this.recordSkipped(item, triggeredBy, "trigger runtime guard skipped run")
    }
    const reschedulePolicy = trigger.runtime.getReschedulePolicy?.(parsedTriggerConfig) ??
      { mode: "before_run" as const }
    const deferSchedule = reschedulePolicy.mode === "after_completion"
    if (triggeredBy === "trigger" && reschedulePolicy.mode === "before_run") await this.schedule(id)
    try {
      return await this.executeOrSkip(item, triggeredBy)
    } finally {
      if (
        (triggeredBy === "trigger" && deferSchedule) ||
        triggeredBy === "missed_run"
      ) {
        await this.schedule(id)
      }
    }
  }

  private async rescheduleAfterManualRun(id: string): Promise<void> {
    if (!this.started) return
    const item = await this.deps.items.get(id)
    if (!item?.enabled) return
    if (!this.isItemValid(item)) return
    const trigger = this.deps.triggers.get(item.trigger.type)
    if (trigger.manifest.kind !== "schedule") return
    await this.schedule(id)
  }

  private async executeOrSkip(
    item: AutomationItem,
    triggeredBy: AutomationRunTrigger,
    triggerContext?: AutomationTriggerRuntimeContext,
  ): Promise<AutomationRun> {
    if (this.runningItemIds.has(item.id)) {
      return this.recordSkipped(item, triggeredBy, "automation is already running", triggerContext)
    }
    this.runningItemIds.add(item.id)
    try {
      const run = await this.deps.execution.runItem(
        item,
        triggeredBy,
        {
          onRunStarted: (startedRun) => {
            this.emitAutomationChanged({
              automationId: item.id,
              runId: startedRun.id,
              reason: "run-started",
            })
          },
        },
        triggerContext,
      )
      this.emitAutomationChanged({ automationId: item.id, runId: run.id, reason: "run-finished" })
      return run
    } finally {
      this.runningItemIds.delete(item.id)
    }
  }

  private executeQueuedEvent(
    item: AutomationItem,
    triggerContext: AutomationTriggerRuntimeContext,
  ): Promise<AutomationRun> {
    const previous = this.eventRunChains.get(item.id) ?? Promise.resolve()
    const runPromise = previous
      .catch(() => undefined)
      .then(() => this.executeOrSkip(item, "trigger", triggerContext))
    const chain = runPromise.then(() => undefined, () => undefined)
    this.eventRunChains.set(item.id, chain)
    void chain.finally(() => {
      if (this.eventRunChains.get(item.id) === chain) {
        this.eventRunChains.delete(item.id)
      }
    })
    return runPromise
  }

  private async deferTriggerRunUntilDue(
    item: AutomationItem,
    triggeredBy: AutomationRunTrigger,
  ): Promise<boolean> {
    if (triggeredBy !== "trigger") return false
    if (!item.nextRunAt) return false
    const nextRunAt = new Date(item.nextRunAt)
    if (Number.isNaN(nextRunAt.getTime())) return false
    const now = this.now()
    if (nextRunAt.getTime() <= now.getTime()) return false

    await this.schedule(item.id, nextRunAt.toISOString())
    this.deps.logger?.info?.("Automation trigger timer woke before due time, rescheduled.", {
      automationId: item.id,
      nextRunAt: nextRunAt.toISOString(),
      now: now.toISOString(),
      boundary: "automation-schedule-checkpoint",
    })
    return true
  }

  private async recordSkipped(
    item: AutomationItem,
    triggeredBy: AutomationRunTrigger,
    error: string,
    triggerContext?: AutomationTriggerRuntimeContext,
  ): Promise<AutomationRun> {
    const reason = skippedReasonWithEventDelivery(error, triggerContext?.event)
    const run = await this.deps.runs.start(item.id, triggeredBy, {
      triggerType: item.trigger.type,
      executorType: item.executor.type,
    })
    const finished = await this.deps.runs.finish(run.id, {
      status: "skipped",
      error: reason,
    })
    try {
      await this.deps.items.markRunResult(item.id, { status: "skipped" })
    } catch (markError) {
      this.deps.logger?.warn("markRunResult failed after skipped automation run.", {
        source: "automation",
        automationId: item.id,
        runId: run.id,
        triggeredBy,
        status: "skipped",
        boundary: "automation-mark-run-result",
        ...errorMetadata(markError),
      })
    }
    this.deps.logger?.info("Automation run skipped.", {
      automationId: item.id,
      runId: run.id,
      triggeredBy,
      status: "skipped",
      boundary: "automation-skip-run",
      reason,
    })
    this.emitAutomationChanged({ automationId: item.id, runId: finished.id, reason: "run-skipped" })
    return finished
  }

  private emitAutomationChanged(payload: AutomationChangedPayload): void {
    this.deps.eventBus?.emit({
      domain: "automation",
      type: "automation.itemChanged",
      payload,
      timestamp: this.now().toISOString(),
    }, { backpressure: "coalesce" })
  }

  private resolveNextRunAt(item: AutomationItem, preferredNextRunAt?: string): Date | null {
    if (preferredNextRunAt) {
      const preferred = new Date(preferredNextRunAt)
      if (preferred.getTime() > this.now().getTime()) return preferred
    }
    const trigger = this.deps.triggers.get(item.trigger.type)
    if (trigger.manifest.kind !== "schedule") return null
    if (!trigger.runtime.computeNextRunAt) {
      throw new Error(`Automation trigger "${item.trigger.type}" does not support scheduling`)
    }
    return trigger.runtime.computeNextRunAt({
      config: item.trigger.config,
      from: this.now(),
      createdAt: item.createdAt,
      lastRunAt: item.lastRunAt,
    })
  }

  private cancel(id: string): void {
    const timer = this.timers.get(id)
    if (!timer) return
    clearTimeout(timer)
    this.timers.delete(id)
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private async withRuntimeState(item: AutomationItem): Promise<AutomationItem> {
    const validation = this.validateItem(item)
    const baseItem = validation.status === "valid"
      ? item
      : { ...item, enabled: false, validation }
    if (!this.runningItemIds.has(item.id)) return baseItem
    const runId = this.deps.execution.getActiveRunIdForItem(item.id)
    return {
      ...baseItem,
      activeRun: { status: "running", id: runId },
    }
  }

  private isItemValid(item: AutomationItem): boolean {
    return this.validateItem(item).status === "valid"
  }

  private validateItem(item: AutomationItem): AutomationValidation {
    const triggerValidation = this.deps.triggers.validateStoredConfig(item.trigger.type, item.trigger.config)
    const executorValidation = this.deps.actions.validateStoredConfig(item.executor.type, item.executor.config)
    if (triggerValidation.status === "valid" && executorValidation.status === "valid") {
      return { status: "valid", issues: [] }
    }
    return {
      status: "needs_update",
      issues: [
        ...(triggerValidation.status === "needs_update" ? triggerValidation.issues : []),
        ...(executorValidation.status === "needs_update" ? executorValidation.issues : []),
      ],
    }
  }

  private logInvalidEventTriggerConfig(item: AutomationItem): void {
    try {
      const trigger = this.deps.triggers.get(item.trigger.type)
      if (trigger.manifest.kind !== "event") return
      const parsed = trigger.manifest.configSchema.safeParse(item.trigger.config)
      if (!parsed.success) {
        this.warnEventTriggerConfigInvalid(item, parsed.error)
      }
    } catch (error) {
      this.deps.logger?.warn("Automation event trigger lookup failed, skipping item.", {
        automationId: item.id,
        triggerType: item.trigger.type,
        boundary: "automation-event-trigger",
        ...errorMetadata(error),
      })
    }
  }

  private warnEventTriggerConfigInvalid(item: AutomationItem, error: unknown): void {
    this.deps.logger?.warn("Automation event trigger config invalid, skipping item.", {
      automationId: item.id,
      triggerType: item.trigger.type,
      boundary: "automation-event-trigger",
      ...errorMetadata(error),
    })
  }

  private normalizeCreateInput(input: AutomationCreateInput): AutomationCreateInput {
    return {
      ...input,
      trigger: this.deps.triggers.normalize(input.trigger),
      executor: this.normalizeExecutor(input.executor),
    }
  }

  private normalizeUpdateInput(patch: AutomationUpdateInput): AutomationUpdateInput {
    return {
      ...patch,
      ...(patch.trigger ? { trigger: this.deps.triggers.normalize(patch.trigger) } : {}),
      ...(patch.executor ? { executor: this.normalizeExecutor(patch.executor) } : {}),
    }
  }

  private normalizeExecutor(executor: AutomationCreateInput["executor"]): AutomationCreateInput["executor"] {
    return {
      type: executor.type,
      config: this.deps.actions.parseConfig(executor.type, executor.config),
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMetadata(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

function skippedReasonWithEventDelivery(reason: string, event: AutomationTriggerEvent | undefined): string {
  const deliveryId = event?.payload?.deliveryId
  return typeof deliveryId === "string" && deliveryId.length > 0
    ? `${reason} (deliveryId: ${deliveryId})`
    : reason
}

function compareAutomationItemsByRecentEdit(left: AutomationItem, right: AutomationItem): number {
  const updatedAtOrder = compareIsoTimestampDesc(left.updatedAt, right.updatedAt)
  if (updatedAtOrder !== 0) return updatedAtOrder
  return compareIsoTimestampDesc(left.createdAt, right.createdAt)
}

function matchesAutomationScope(item: AutomationItem, scope: AutomationListOptions["scope"]): boolean {
  if (!scope) return true
  if (scope.type !== item.scope.type) return false
  if (scope.type === "project" && scope.projectId) {
    return item.scope.type === "project" && item.scope.projectId === scope.projectId
  }
  return true
}

function compareIsoTimestampDesc(left: string, right: string): number {
  if (left === right) return 0
  return right.localeCompare(left)
}

function automationEventTraceMetadata(event: AutomationTriggerEvent): {
  readonly deliveryId?: string
  readonly webhookPublicId?: string
} {
  const deliveryId = typeof event.payload.deliveryId === "string" ? event.payload.deliveryId : undefined
  const webhook = event.payload.webhook
  const webhookPublicId = isRecord(webhook) && typeof webhook.publicId === "string"
    ? webhook.publicId
    : undefined
  return {
    ...(deliveryId !== undefined ? { deliveryId } : {}),
    ...(webhookPublicId !== undefined ? { webhookPublicId } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
