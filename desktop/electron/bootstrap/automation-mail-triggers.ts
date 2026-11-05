import { powerMonitor } from "electron"
import type { ServiceDescriptor } from "../runtime/service-registry"
import type { DataRepository } from "../runtime/data-repo"
import type { EventBus } from "../runtime/event-bus"
import { accountService } from "../services/account-service"
import type { AutomationItem, AutomationRun } from "../services/automation/types"
import type { AutomationService } from "../services/automation/automation-service"
import { AutomationRunRepository } from "../services/automation/run-repository"
import { MailTriggerRepository } from "../services/automation-mail-triggers/repository"
import { AutomationMailTriggerLifecycle } from "../services/automation-mail-triggers/lifecycle"
import { InternalMailReceiptSource } from "../services/automation-mail-triggers/internal-source"
import { ExternalMailReceiptSource } from "../services/automation-mail-triggers/external-source"
import { buildInternalMailPayload } from "../services/automation-mail-triggers/payload"
import { normalizeMailMessage } from "../services/mail-response"
import type { MailService } from "../../app-capabilities/mail/main/service"
import type { MailReceiptSource } from "../services/automation-mail-triggers/types"
import { mailInternalReceivedManifest } from "../../automation-trigger-packages/builtin/mail-internal-received/manifest"
import { mailReceivedManifest } from "../../automation-trigger-packages/builtin/mail-received/manifest"

export const coreAutomationMailTriggersDescriptor: ServiceDescriptor<AutomationMailTriggerLifecycle> = {
  id: "core.automation-mail-triggers", criticality: "degraded", startupPhase: "background",
  dependsOn: ["core.automation", "core.mail", "core.data-repository", "core.event-bus"],
  create(ctx) {
    const storage = ctx.registry.get<DataRepository>("core.data-repository"), mail = ctx.registry.get<MailService>("core.mail")
    const items = storage.namespace<AutomationItem>("automation.items")
    let runtime: AutomationMailTriggerLifecycle
    const internal = new InternalMailReceiptSource({ assertCurrent: context => runtime.assertCurrent(context),
      checkpoint: context => accountService.mailAutomationCheckpoint(context.signal), changes: (context, input) => accountService.mailAutomationChanges(input, context.signal),
      read: async (context, messageId) => {
        runtime.assertCurrent(context)
        const scope = accountService.captureAccountRequestScope()
        if (!scope || scope.accountId !== context.identity.ownerId) throw new Error("站内信身份不可用")
        const response = await accountService.fetchAuthenticated(`/mail-internal/messages/${encodeURIComponent(messageId)}`, { signal: context.signal }, "站内信不可用。", scope)
        const message = normalizeMailMessage(await response.json()); runtime.assertCurrent(context)
        return buildInternalMailPayload(message)
      } })
    const external = new ExternalMailReceiptSource({ assertCurrent: context => runtime.assertCurrent(context),
      listAccounts: context => mail.automationAccountIds(context),
      prepare: (context, accountId) => mail.prepareAutomationReceipts(context, accountId), scan: (context, boundary, cursor, limit) => mail.scanAutomationReceipts(context, boundary, cursor, limit), read: (context, receipt) => mail.readAutomationReceipt(context, receipt) })
    runtime = new AutomationMailTriggerLifecycle({ repository: new MailTriggerRepository(storage), items: { list: () => items.list(), get: id => items.get(id) },
      runs: new AutomationRunRepository({ runs: storage.namespace<AutomationRun>("automation.runs") }), automation: ctx.registry.get<AutomationService>("core.automation"),
      sources: new Map<string, MailReceiptSource>([[mailInternalReceivedManifest.id, internal], [mailReceivedManifest.id, external]]),
      account: accountService, events: ctx.registry.get<EventBus>("core.event-bus"), power: powerMonitor, logger: ctx.logger.child("automation-mail-triggers") })
    return runtime
  },
  start: runtime => runtime.start(), stop: runtime => runtime.stop(),
}
