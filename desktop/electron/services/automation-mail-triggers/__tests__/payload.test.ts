import { expect, it } from "vitest"
import type { MailMessage } from "../../../../src/types/mail"
import { buildInternalMailPayload, buildMailTriggerEvent, validateMailPayload } from "../payload"
import { buildAutomationTemplateVariables, renderActionTemplate } from "../../../action-runtime/template-variables"
import { mailInternalReceivedManifest } from "../../../../automation-trigger-packages/builtin/mail-internal-received/manifest"
import { mailReceivedManifest } from "../../../../automation-trigger-packages/builtin/mail-received/manifest"

const message: MailMessage = { messageId: "letter", sender: { userId: "system", nickname: "Synapse", handle: null }, recipients: [], toRecipients: [], ccRecipients: [],
  toAddresses: [{ kind: "audience", name: "所有用户" }], relationKind: null, subject: "公告", snippet: "", sentAt: "2026-11-05T00:00:00.000Z", readAt: null,
  attachmentCount: 0, viewerId: "owner", body: "完整正文\n第二行", team: null, conversationId: "conversation", replyToId: null, relation: null, quote: null, attachments: [] }
it("provides full internal body and public address snapshots without expanding hidden recipients", () => {
  const payload = buildInternalMailPayload(message)
  expect(payload).toMatchObject({ body: "完整正文\n第二行", to: "所有用户", sender: "Synapse", attachments: "[]", url: "synapse://mail-internal/letter" })
  expect(message.readAt).toBeNull()
  const event = buildMailTriggerEvent(payload, "2026-11-05T02:00:00.000Z")
  const vars = buildAutomationTemplateVariables({ triggerType: "builtin.mail-internal-received", triggerConfig: {}, automationId: "auto", automationName: "auto", triggeredBy: "trigger", triggeredAt: event.receivedAt, scheduledAt: event.receivedAt, event })
  expect(vars["trigger.payload.body"]).toBe("完整正文\n第二行")
  expect(vars["trigger.payload.receivedAt"]).toBe("2026-11-05T00:00:00.000Z")
})
it("accepts an empty body but never treats missing or oversized content as a complete body", () => {
  expect(buildInternalMailPayload({ ...message, body: "" }).body).toBe("")
  expect(() => buildInternalMailPayload({ ...message, body: "x".repeat(5 * 1024 ** 2 + 1) })).toThrow()
  expect(() => validateMailPayload({ ...buildInternalMailPayload(message), body: undefined })).toThrow()
  expect(() => buildInternalMailPayload({ ...message, attachmentCount: 1 })).toThrow()
})

it.each([
  { manifest: mailInternalReceivedManifest, label: "站内信ID", messageId: "letter", accountId: undefined, expected: "synapse://mail-internal/letter" },
  { manifest: mailReceivedManifest, label: "邮件ID", messageId: "em_one", accountId: "account", expected: "synapse://mail/em_one" },
])("renders $label as a typed reference without exposing the retired messageId variable", ({ manifest, label, messageId, accountId, expected }) => {
  const payload = { ...buildInternalMailPayload(message), messageId, accountId, url: expected }
  const event = buildMailTriggerEvent(payload, "2026-11-06T02:00:00.000Z")
  const variables = buildAutomationTemplateVariables({ triggerType: manifest.id, triggerConfig: {}, automationId: "auto", automationName: "auto", triggeredBy: "trigger", triggeredAt: event.receivedAt, scheduledAt: event.receivedAt, event })
  const descriptor = manifest.variables.find(variable => variable.label === label)
  expect(descriptor).toBeDefined()
  expect(renderActionTemplate(`{{${descriptor!.key}}}`, variables)).toBe(expected)
  expect(manifest.variables.some(variable => variable.key === "trigger.payload.messageId")).toBe(false)
  expect(event.payload).not.toHaveProperty("messageId")
  expect(variables["trigger.payload.messageId"]).toBeUndefined()
  expect(JSON.parse(variables["trigger.payload"]!)).not.toHaveProperty("messageId")
  expect(() => renderActionTemplate("{{trigger.payload.messageId}}", variables)).toThrow("未知变量：trigger.payload.messageId")
})
