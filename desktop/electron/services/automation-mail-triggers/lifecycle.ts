import type { AccountService } from "../account-service"
import type { EventBus } from "../../runtime/event-bus"
import type { AutomationService } from "../automation/automation-service"
import { MailTriggerActivation } from "./activation"
import { AutomationMailTriggerService, type AutomationMailTriggerDeps } from "./service"
import type { MailReceiptSource, MailTriggerContext } from "./types"

export interface MailTriggerLifecycleDeps extends Omit<AutomationMailTriggerDeps, "activation" | "context" | "sourceFor" | "automation"> {
  sources: ReadonlyMap<string, MailReceiptSource>
  automation: Pick<AutomationService, "runDurableEvent" | "attachTriggerLifecycle">
  account: Pick<AccountService, "getState" | "getApiBaseUrlForLive" | "onBeforeIdentityChange" | "onStateChanged">
  events: Pick<EventBus, "onType">
  power: { on(event: "suspend" | "resume", listener: () => void): unknown; removeListener(event: "suspend" | "resume", listener: () => void): unknown }
}
export class AutomationMailTriggerLifecycle {
  private scope: MailTriggerContext | null = null
  private controller: AbortController | undefined
  private generation = 0
  private detaches: (() => void)[] = []
  private providerDetaches: (() => void)[] = []
  private suspended: Promise<void> = Promise.resolve()
  readonly worker: AutomationMailTriggerService
  constructor(private readonly deps: MailTriggerLifecycleDeps) {
    const activation = new MailTriggerActivation({ repository: deps.repository, context: () => this.context(), sourceFor: type => deps.sources.get(type), listItems: () => deps.items.list() })
    this.worker = new AutomationMailTriggerService({ ...deps, activation, context: () => this.context(), sourceFor: type => deps.sources.get(type) })
    this.activation = activation
  }
  private readonly activation: MailTriggerActivation
  context(): MailTriggerContext {
    if (!this.scope || this.scope.signal.aborted) throw new Error("请先登录 Synapse，收信服务当前不可用")
    return this.scope
  }
  assertCurrent(context: MailTriggerContext): void {
    context.signal.throwIfAborted()
    const current = this.context()
    if (current.generation !== context.generation || current.identity.ownerId !== context.identity.ownerId || current.identity.apiOrigin !== context.identity.apiOrigin) throw new Error("收信身份已变化")
  }
  private invalidate(): void { this.controller?.abort(); this.controller = undefined; this.scope = null }
  private refresh(): void {
    const state = this.deps.account.getState()
    const identity = state.status === "authenticated" ? { ownerId: state.profile.user.id, apiOrigin: this.deps.account.getApiBaseUrlForLive().replace(/\/+$/u, "") } : null
    if (identity && this.scope && !this.scope.signal.aborted && identity.ownerId === this.scope.identity.ownerId && identity.apiOrigin === this.scope.identity.apiOrigin) return
    this.invalidate()
    if (identity) { this.controller = new AbortController(); this.scope = { identity, generation: ++this.generation, signal: this.controller.signal } }
  }
  async start(): Promise<void> {
    if (this.detaches.length) return
    this.refresh()
    for (const type of this.deps.sources.keys()) this.providerDetaches.push(this.deps.automation.attachTriggerLifecycle(type, this.activation))
    const report = (code: string) => this.deps.logger.warn("收信后台生命周期操作失败", { code })
    const suspend = () => { this.invalidate(); this.suspended = this.worker.stop(); void this.suspended.catch(() => report("SUSPEND_FAILED")) }
    const resume = () => { void this.suspended.then(async () => { this.refresh(); if (this.scope) await this.worker.start() }).catch(() => report("RESUME_FAILED")) }
    this.deps.power.on("suspend", suspend); this.deps.power.on("resume", resume)
    this.detaches.push(() => { this.deps.power.removeListener("suspend", suspend); this.deps.power.removeListener("resume", resume) },
      this.deps.account.onBeforeIdentityChange(async () => { this.invalidate(); await this.worker.stop() }),
      this.deps.account.onStateChanged(() => { this.refresh(); if (this.scope) { void this.worker.start().catch(() => report("IDENTITY_START_FAILED")); this.worker.wake("account") } }),
      this.deps.events.onType("account", "account.notificationChanged", () => this.worker.wake("internal-receipt")),
      this.deps.events.onType("account", "mail.changed", () => this.worker.wake("mail-sync")),
      this.deps.events.onType("live", "live.stateChanged", () => this.worker.wake("reconnected")),
      this.deps.events.onType("automation", "automation.itemChanged", event => {
        const { reason, automationId } = (event.payload as { reason?: string; automationId?: string }) ?? {}
        if (reason === "deleted" && automationId) void this.deps.repository.deleteAutomationState(automationId).catch(() => report("DELETE_CLEANUP_PENDING"))
        if (reason && !reason.startsWith("run-")) this.worker.wake("configuration")
      }))
    if (this.scope) await this.worker.start()
  }
  async stop(): Promise<void> {
    this.invalidate()
    for (const detach of this.detaches.splice(0)) detach()
    await this.worker.stop()
    for (const detach of this.providerDetaches.splice(0)) detach()
  }
}
