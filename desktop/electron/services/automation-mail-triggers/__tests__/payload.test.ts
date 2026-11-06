import { expect, it } from "vitest"
import type { MailMessage } from "../../../../src/types/mail"
import { buildExternalMailPayload, buildInternalMailPayload, buildMailTriggerEvent, validateMailPayload } from "../payload"
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


it("provides replyable sender and attachment locators without expanding hidden recipients", () => {
  const payload = buildInternalMailPayload({ ...message, sender: { userId: "sender-1", nickname: "发件人", handle: "sender" }, attachmentCount: 1, attachments: [{ attachmentId: "attachment-1", fileName: "report.txt", size: 3 }] })
  expect(payload).toMatchObject({ senderId: "sender-1", senderKind: "user", sentAt: message.sentAt })
  expect(JSON.parse(payload.attachments)).toEqual([{ attachmentId: "attachment-1", name: "report.txt", size: 3, mime: null }])
  const broadcast = buildInternalMailPayload({ ...message, kind: "platform_broadcast" })
  expect(broadcast).toMatchObject({ senderId: "", senderKind: "system", to: "所有用户" })
  const event = buildMailTriggerEvent(payload, "2026-11-06T00:00:00.000Z")
  expect(event.occurredAt).toBe(message.sentAt)
  expect(event.receivedAt).toBe("2026-11-06T00:00:00.000Z")
})

it("provides external sender addresses, Reply-To fallback, send time and attachment IDs", () => {
  const detail: import("../../../../app-capabilities/mail/shared/types").MailDetail = { id: "em_one", accountId: "ma_one", locator: { accountId: "ma_one", folderId: "mf_one", uid: 1, uidValidity: "1" }, from: [{ name: "Sender", address: "from@example.com" }], to: [], cc: [], subject: "报告", snippet: "", date: "2026-11-05T01:00:00Z", receivedAt: "2026-11-05T01:05:00Z", read: false, star: false, attachmentCount: 1, bodyState: "remote", revision: 1, stale: false, bodyRef: null, headers: { replyTo: [{ address: "reply@example.com" }], messageId: null, references: [] }, attachments: [{ id: "mas_one", accountId: "ma_one", name: "report.txt", size: 3, mime: "text/plain", sha256: null, cid: null, state: "remote", attachmentId: "2", messageId: "em_one" }] }
  const account: import("../../../../app-capabilities/mail/shared/types").AccountSummary = { id: "ma_one", name: "邮箱", provider: "custom", email: "owner@example.com", imap: { host: "imap.example.com", port: 993, security: "tls" }, smtp: { host: "smtp.example.com", port: 465, security: "tls" }, sentPolicy: "server", aliases: [], notify: true, revision: 1, paused: false, state: "connected", errorCode: null, capabilities: [] }
  const payload = buildExternalMailPayload(detail, "正文", account)
  expect(JSON.parse(payload.senderAddresses!)).toEqual(["from@example.com"])
  expect(JSON.parse(payload.replyToAddresses!)).toEqual(["reply@example.com"])
  expect(payload.sentAt).toBe("2026-11-05T01:00:00.000Z")
  expect(JSON.parse(payload.attachments)).toEqual([{ assetId: "mas_one", attachmentId: "2", name: "report.txt", size: 3, mime: "text/plain" }])
  const fallback = buildExternalMailPayload({ ...detail, date: null, headers: { ...detail.headers, replyTo: [] } }, "正文", account)
  expect(JSON.parse(fallback.replyToAddresses!)).toEqual(["from@example.com"])
  expect(fallback.sentAt).toBe("")
})
