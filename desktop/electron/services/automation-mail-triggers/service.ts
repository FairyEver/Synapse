import { AUTOMATION_MAIL_RECONCILE_INTERVAL_MS } from "../../../config"
import type { AutomationItemRepository } from "../automation/item-repository"
import type { AutomationRunRepository } from "../automation/run-repository"
import type { AutomationService } from "../automation/automation-service"
import { INTERRUPTED_RUN_ERROR } from "../automation/automation-service"
import type { AutomationItem } from "../automation/types"
import { MailTriggerActivation } from "./activation"
import { MailTriggerRepository } from "./repository"
import { buildMailTriggerEvent, validateMailPayload } from "./payload"
import type { DeliveryRow, MailReceiptSource, MailTriggerContext } from "./types"

export interface AutomationMailTriggerDeps {
  repository: MailTriggerRepository; activation: MailTriggerActivation; context(): MailTriggerContext
  sourceFor(type: string): MailReceiptSource | undefined
  items: Pick<AutomationItemRepository, "list" | "get">; automation: Pick<AutomationService, "runDurableEvent">
  runs: Pick<AutomationRunRepository, "get" | "start" | "finish">
  logger: { warn(message: string, metadata: Record<string, unknown>): void }
}
const permanent = new Set(["UNAVAILABLE", "STALE_TARGET", "LIMIT_EXCEEDED", "METADATA_INVALID", "MIME_INVALID"])
const codeOf = (error: unknown) => typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code.slice(0, 100) : "RECEIVE_PREPARATION_FAILED"
export class AutomationMailTriggerService {
  private timer: ReturnType<typeof setInterval> | undefined
  private task: Promise<void> | undefined
  private stopped = false
  private followup: ReturnType<typeof setTimeout> | undefined
  private moreWork = false
  constructor(private readonly deps: AutomationMailTriggerDeps) {}
  async start(): Promise<void> {
    if (this.timer) return
    this.stopped = false
    this.timer = setInterval(() => this.wake("poll"), AUTOMATION_MAIL_RECONCILE_INTERVAL_MS); this.timer.unref()
    this.wake("startup")
  }
  wake(reason: string): void {
    if (this.task) this.moreWork = true
    void this.reconcile(reason).catch(error => this.deps.logger.warn("收信自动化补查失败", { code: codeOf(error) }))
  }
  async stop(): Promise<void> { this.stopped = true; if (this.timer) clearInterval(this.timer); if (this.followup) clearTimeout(this.followup); this.timer = undefined; this.followup = undefined; await this.task }
  reconcile(_reason: string): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.task) return this.task
    this.moreWork = false
    const task = this.run().finally(() => {
      if (this.task === task) this.task = undefined
      if (this.moreWork && this.timer && !this.stopped && !this.followup) {
        this.followup = setTimeout(() => { this.followup = undefined; this.wake("continuation") }, 1000); this.followup.unref()
      }
    })
    this.task = task; return task
  }
  private assert(context: MailTriggerContext) {
    context.signal.throwIfAborted()
    const current = this.deps.context()
    if (this.stopped || current.generation !== context.generation || current.identity.ownerId !== context.identity.ownerId || current.identity.apiOrigin !== context.identity.apiOrigin) throw new Error("收信身份已变化")
  }
  private async run(): Promise<void> {
    const context = this.deps.context(); this.assert(context)
    await this.deps.repository.resumeDeletes(context.identity)
    await this.deps.activation.recoverBindings()
    for (const item of await this.deps.items.list()) {
      this.assert(context)
      const source = this.deps.sourceFor(item.trigger.type), binding = item.mailSubscription
      if (!source || !binding) continue
      const root = await this.deps.repository.getSubscription(binding.id)
      if (!root || root.ownerId !== context.identity.ownerId || root.apiOrigin !== context.identity.apiOrigin) continue
      await this.recover(context, item)
      if (!item.enabled || binding.stoppedAt || root.state !== "ready") continue
      for (const historical of await this.deps.repository.closedSubscriptions(item.id, context.identity)) {
        if ((historical.configurationGeneration ?? historical.id) !== (root.configurationGeneration ?? root.id)) {
          await this.deps.repository.retireGeneration(historical); continue
        }
        await this.scanClosed(context, source, historical.id)
      }
      if (source.discover && !item.trigger.config.accountId) {
        const known = new Set((await this.deps.repository.sourcesFor(root.id)).flatMap(row => row.boundary.kind === "mail" ? [row.boundary.accountId] : []))
        try {
          for (const accountId of await source.discover(context)) if (!known.has(accountId)) {
            try { const boundaries = await source.prepare(context, accountId); this.assert(context); await this.deps.repository.addSources(root.id, boundaries) }
            catch (error) { this.assert(context); this.deps.logger.warn("新邮箱来源等待接入", { automationId: item.id, code: codeOf(error) }) }
          }
        } catch (error) { this.assert(context); this.deps.logger.warn("邮箱来源列表暂不可用", { automationId: item.id, code: codeOf(error) }) }
      }
      for (const origin of await this.deps.repository.sourcesFor(root.id)) {
        this.assert(context)
        if (origin.state !== "ready" || origin.retryAt > Date.now()) continue
        try {
          const page = await source.scan(context, origin.boundary, origin.cursor, 50); this.assert(context)
          await this.deps.repository.enqueuePage(root.id, origin.sourceKey, origin.revision, page)
          if (!page.complete) this.moreWork = true
        } catch (error) {
          this.assert(context)
          const code = codeOf(error)
          await this.deps.repository.updateSource(origin.id, fresh => fresh.state !== "ready" ? null :
            { state: code === "STALE_TARGET" || code === "UNAVAILABLE" ? "blocked" : "ready", retryAt: Date.now() + 60_000, errorCode: code })
          this.deps.logger.warn("收信来源补查未完成", { automationId: item.id, sourceKey: origin.sourceKey, code })
        }
      }
      for (let i = 0; i < 50; i++) {
        this.assert(context)
        const pending = await this.deps.repository.nextPending(item.id, context.identity)
        const held = pending ? undefined : (await this.deps.repository.rowsInState(item.id, context.identity, "awaiting_metadata")).find(row => row.retryAt <= Date.now())
        const row = pending ?? held
        if (!row) break
        if (!await this.deliver(context, item, source, row)) { this.moreWork = true; break }
        if (i === 49) this.moreWork = true
      }
    }
  }
  private async recover(context: MailTriggerContext, item: AutomationItem) {
    for (const row of await this.deps.repository.rowsInState(item.id, context.identity, "submitted")) {
      if (!row.runId) throw new Error("已提交收信投递缺少运行关联")
      const run = await this.deps.runs.get(row.runId)
      if (run && run.status !== "running") {
        if (run.error === INTERRUPTED_RUN_ERROR) {
          await this.deps.runs.finish(row.runId, { status: "failed", error: "执行结果不明，未自动重试" })
          await this.deps.repository.finishDispatch(row.id, { state: "unknown", errorCode: "EXECUTION_UNKNOWN" }); continue
        }
        await this.deps.repository.finishDispatch(row.id, { state: run.status === "success" ? "success" : "failed" }); continue
      }
      if (!run) await this.deps.runs.start(item.id, "trigger", { triggerType: item.trigger.type, executorType: item.executor.type, reservedRunId: row.runId })
      await this.deps.runs.finish(row.runId, { status: "failed", error: "执行结果不明，未自动重试" })
      await this.deps.repository.finishDispatch(row.id, { state: "unknown", errorCode: "EXECUTION_UNKNOWN" })
    }
  }
  private async scanClosed(context: MailTriggerContext, source: MailReceiptSource, subscriptionId: string): Promise<void> {
    for (const origin of await this.deps.repository.sourcesFor(subscriptionId)) {
      if (origin.state !== "ready" || origin.retryAt > Date.now()) continue
      if (!origin.endCursor) { await this.deps.repository.updateSource(origin.id, fresh => fresh.endCursor ? null : { state: "blocked", errorCode: "STOP_BOUNDARY_UNCONFIRMED" }); continue }
      const after = origin.cursor.startsWith("{") ? String((JSON.parse(origin.cursor) as { after: string | number }).after) : origin.cursor
      if (BigInt(after) >= BigInt(origin.endCursor)) { await this.deps.repository.updateSource(origin.id, () => ({ state: "closed" })); continue }
      const cursor = JSON.stringify(origin.boundary.kind === "mail" ? { after: Number(after), through: Number(origin.endCursor) } : { after, through: origin.endCursor })
      try {
        const page = await source.scan(context, origin.boundary, cursor, 50); this.assert(context)
        const committed = await this.deps.repository.enqueuePage(subscriptionId, origin.sourceKey, origin.revision, page)
        if (committed && page.complete) {
          await this.deps.repository.updateSource(origin.id, () => ({ state: "closed" }))
        } else this.moreWork = true
      } catch (error) {
        this.assert(context)
        const code = codeOf(error)
        await this.deps.repository.updateSource(origin.id, fresh => fresh.state !== "ready" ? null :
          { state: code === "STALE_TARGET" || code === "UNAVAILABLE" ? "blocked" : "ready", retryAt: Date.now() + 60_000, errorCode: code })
        this.deps.logger.warn("历史启用区间补查未完成", { code })
      }
    }
    const origins = await this.deps.repository.sourcesFor(subscriptionId)
    if (origins.every(origin => origin.state !== "ready")) {
      await this.deps.repository.updateSubscription(subscriptionId, fresh => fresh.state === "closed" ? { state: origins.some(origin => origin.state === "blocked") ? "blocked" : "success" } : null)
    }
  }
  private async deliver(context: MailTriggerContext, item: AutomationItem, source: MailReceiptSource, row: DeliveryRow): Promise<boolean> {
    const original = await this.deps.repository.getSubscription(row.subscriptionId)
    const current = await this.deps.repository.getSubscription(item.mailSubscription!.id)
    if (!original || !current || original.state === "retired" || (original.configurationGeneration ?? original.id) !== (current.configurationGeneration ?? current.id)
      || item.mailSubscription?.previousId === row.subscriptionId && item.mailSubscription.previousRetired) {
      await this.deps.repository.finishDispatch(row.id, { state: "skipped", errorCode: "SUBSCRIPTION_CHANGED" }); return true
    }
    const origin = await this.deps.repository.getSource(row.subscriptionId, row.sourceKey)
    if (!origin || origin.state === "blocked") {
      await this.deps.repository.deferDelivery(row, Date.now() + 60_000, origin?.errorCode ?? "SOURCE_UNAVAILABLE"); return true
    }
    const sequence = row.receipt.sequence ?? row.receipt.locator?.uid
    if (original.endedAt && origin?.endCursor && sequence !== undefined && BigInt(sequence) > BigInt(origin.endCursor)) {
      await this.deps.repository.finishDispatch(row.id, { state: "skipped", errorCode: "OUTSIDE_ENABLED_PERIOD" }); return true
    }
    let claimed = false
    const runId = `automation-mail-run:${row.id}`
    try {
      const payload = validateMailPayload(await source.hydrate(context, row.receipt)); this.assert(context)
      if (row.state === "awaiting_metadata") {
        await this.deps.repository.refreshMetadata(row, payload.receivedAt); return true
      }
      const latest = await this.deps.items.get(item.id)
      if (!latest?.enabled || latest.mailSubscription?.id !== item.mailSubscription!.id) return false
      const result = await this.deps.automation.runDurableEvent({ automationId: item.id, subscriptionId: item.mailSubscription!.id, runId,
        event: buildMailTriggerEvent(payload, new Date().toISOString()), identitySignal: context.signal,
        commitStart: async () => { claimed = await this.deps.repository.commitDispatch(row.id, row.revision, runId); return claimed } })
      if (result.kind !== "settled") {
        if (claimed) await this.deps.repository.releaseUnstartedDispatch(row.id, runId)
        return false
      }
      await this.deps.repository.finishDispatch(row.id, { state: result.run.status === "success" ? "success" : "failed" }); return true
    } catch (error) {
      if (claimed) { await this.recover(context, item); return true }
      this.assert(context)
      const code = codeOf(error)
      if (permanent.has(code)) {
        if (!await this.deps.repository.commitDispatch(row.id, row.revision, runId, row.state as "pending" | "awaiting_metadata")) return false
        await this.deps.runs.start(item.id, "trigger", { triggerType: item.trigger.type, executorType: item.executor.type, reservedRunId: runId })
        await this.deps.runs.finish(runId, { status: "failed", error: `信件准备失败：${code}` })
        await this.deps.repository.finishDispatch(row.id, { state: "failed", errorCode: code }); return true
      }
      const delay = [1000, 5000, 30_000, 60_000][Math.min(row.revision, 3)]!
      await this.deps.repository.deferDelivery(row, Date.now() + delay, code)
      this.deps.logger.warn("信件准备等待重试", { automationId: item.id, code }); return true
    }
  }
}
