import { expect, it } from "vitest"
import type { AutomationTriggerVariableDescriptor } from "../../automation-trigger-packages/types.shared"
import { cronTriggerManifest } from "../../automation-trigger-packages/builtin/cron/manifest"
import { intervalTriggerManifest } from "../../automation-trigger-packages/builtin/interval/manifest"
import { webhookTriggerManifest } from "../../automation-trigger-packages/builtin/webhook/manifest"
import { mailInternalReceivedManifest } from "../../automation-trigger-packages/builtin/mail-internal-received/manifest"
import { mailReceivedManifest } from "../../automation-trigger-packages/builtin/mail-received/manifest"
import { validateAutomationPrompt } from "../../automation-trigger-packages/variable-contract"
import { buildAutomationTemplateVariables, renderActionTemplate } from "../../electron/action-runtime/template-variables"
import { buildMailTriggerEvent } from "../../electron/services/automation-mail-triggers/payload"

const letter = { messageId: "letter", subject: "报告", body: "正文", sender: "发件人", to: "收件人", cc: "", receivedAt: "2026-11-05T23:00:00.000Z", sentAt: "2026-11-05T23:00:00.000Z", attachmentCount: 0, attachments: "[]", url: "synapse://mail-internal/letter", senderId: "sender", senderKind: "user" as const }
const webhook = { source: "webhook", type: "received", receivedAt: "2026-11-06T00:00:00.000Z", occurredAt: "2026-11-05T23:00:00.000Z", payload: { deliveryId: "d", webhook: { id: "w", publicId: "public", name: "ERP" }, request: { method: "POST", receivedAt: "2026-11-05T23:00:00.000Z", body: { order: { id: "ORDER-1" } }, query: {}, headers: {} } } }

it.each([
  { manifest: cronTriggerManifest, config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" }, event: undefined },
  { manifest: intervalTriggerManifest, config: { everyMinutes: 60, anchor: "created_at" }, event: undefined },
  { manifest: webhookTriggerManifest, config: {}, event: webhook },
  { manifest: mailInternalReceivedManifest, config: {}, event: buildMailTriggerEvent(letter, "2026-11-06T00:00:00.000Z") },
  { manifest: mailReceivedManifest, config: {}, event: buildMailTriggerEvent({ ...letter, messageId: "em_one", url: "synapse://mail/em_one", accountId: "ma_one", accountName: "邮箱", accountAddress: "owner@example.com", senderAddresses: '["sender@example.com"]', replyToAddresses: '["reply@example.com"]' }, "2026-11-06T00:00:00.000Z") },
])("makes every discovered variable and alias usable for $manifest.id", ({ manifest, config, event }) => {
  const descriptors: readonly AutomationTriggerVariableDescriptor[] = manifest.variables
  const keys = descriptors.map(variable => variable.key)
  expect(new Set(keys).size).toBe(keys.length)
  expect(keys).not.toContain("trigger.payload.url")
  expect(keys).not.toContain("trigger.payload.messageId")
  const variables = buildAutomationTemplateVariables({ triggerType: manifest.id, triggerConfig: config, triggeredBy: "trigger", triggeredAt: "2026-11-06T01:00:00.000Z", executedAt: "2026-11-06T01:00:00.000Z", scheduledAt: "2026-11-05T23:00:00.000Z", runId: "run-1", automationId: "auto", automationName: "汇总", event })
  for (const descriptor of descriptors) {
    const template = `{{${descriptor.key}}}`
    expect(validateAutomationPrompt(template, descriptors)).toBeNull()
    const rendered = renderActionTemplate(template, variables)
    for (const alias of descriptor.aliases ?? []) {
      expect(validateAutomationPrompt(`{{${alias}}}`, descriptors)).toBeNull()
      expect(renderActionTemplate(`{{${alias}}}`, variables)).toBe(rendered)
    }
  }
})
