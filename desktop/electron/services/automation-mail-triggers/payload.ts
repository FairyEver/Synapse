import { z } from "zod"
import type { MailMessage, MailPerson } from "../../../src/types/mail"
import type { AccountSummary, MailDetail } from "../../../app-capabilities/mail/shared/types"
import type { AutomationTriggerEvent } from "../../../automation-trigger-packages/types.shared"
import type { PreparedMailPayload } from "./types"
import { MAIL_MAX_BODY_BYTES } from "../../../config"
import { buildMailMessageReference } from "../../../synapse-capabilities/shared/message-reference"

const text = z.string()
const payloadSchema = z.object({ messageId: text.min(1), subject: text, body: text.refine(body => Buffer.byteLength(body) <= MAIL_MAX_BODY_BYTES, "正文超过大小上限"),
  sender: text, to: text, cc: text, receivedAt: z.iso.datetime(), attachmentCount: z.number().int().nonnegative(), attachments: text, url: text,
  sentAt: text.optional(), senderId: text.optional(), senderKind: z.enum(["user", "system"]).optional(), senderAddresses: text.optional(), replyToAddresses: text.optional(),
  accountId: text.optional(), accountName: text.optional(), accountAddress: text.optional() }).strict()
export function validateMailPayload(value: unknown): PreparedMailPayload {
  const parsed = payloadSchema.safeParse(value)
  if (!parsed.success) throw Object.assign(new Error("信件内容或元数据不完整"), { code: "METADATA_INVALID" })
  return parsed.data
}
const person = (value: MailPerson) => value.nickname || value.handle || ""
export function buildInternalMailPayload(message: MailMessage): PreparedMailPayload {
  if (message.attachments.length !== message.attachmentCount) throw Object.assign(new Error("信件附件信息不完整"), { code: "METADATA_INVALID" })
  return validateMailPayload({ messageId: message.messageId, subject: message.subject, body: message.body, sender: person(message.sender),
    to: message.toAddresses ? message.toAddresses.map(a => a.name).join("、") : message.toRecipients.map(person).join("、"),
    cc: message.ccAddresses ? message.ccAddresses.map(a => a.name).join("、") : message.ccRecipients.map(person).join("、"),
    sentAt: message.sentAt, senderId: message.kind === "platform_broadcast" ? "" : message.sender.userId, senderKind: message.kind === "platform_broadcast" ? "system" : "user",
    receivedAt: message.sentAt, attachmentCount: message.attachmentCount,
    attachments: JSON.stringify(message.attachments.map(a => ({ attachmentId: a.attachmentId, name: a.fileName, size: a.size, mime: a.mimeType ?? null }))),
    url: `synapse://mail-internal/${message.messageId}` })
}
export function buildExternalMailPayload(detail: MailDetail, body: string, account: AccountSummary): PreparedMailPayload {
  if (detail.metadataTruncated || detail.attachmentCount !== detail.attachments.length) throw Object.assign(new Error("邮件元数据不完整"), { code: "METADATA_INVALID" })
  const address = (value: { name?: string; address: string }) => value.name ? `${value.name} <${value.address}>` : value.address
  return validateMailPayload({ messageId: detail.id, subject: detail.subject, body, sender: detail.from.map(address).join(", "), to: detail.to.map(address).join(", "), cc: detail.cc.map(address).join(", "),
    sentAt: detail.date && !Number.isNaN(Date.parse(detail.date)) ? new Date(detail.date).toISOString() : "",
    senderAddresses: JSON.stringify(detail.from.map(value => value.address)), replyToAddresses: JSON.stringify((detail.headers.replyTo.length ? detail.headers.replyTo : detail.from).map(value => value.address)),
    receivedAt: detail.receivedAt, attachmentCount: detail.attachmentCount,
    attachments: JSON.stringify(detail.attachments.map(a => ({ assetId: a.id, attachmentId: a.attachmentId, name: a.name, size: a.size, mime: a.mime }))),
    url: `synapse://mail/${detail.id}`, accountId: account.id, accountName: account.name, accountAddress: account.email })
}
export function buildMailTriggerEvent(payload: PreparedMailPayload, discoveredAt: string): AutomationTriggerEvent {
  const { messageId, ...validated } = validateMailPayload(payload)
  return { occurredAt: validated.receivedAt, source: validated.accountId ? "mail" : "mail-internal", type: "message.received", receivedAt: discoveredAt,
    payload: { ...validated, id: validated.accountId ? `synapse://mail/${messageId}` : buildMailMessageReference(messageId) } }
}
