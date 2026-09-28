import { z } from "zod"
import type { MailMessage, MailOperationResult, MailSummary } from "../../src/types/mail"

const person = z.object({ userId: z.string(), nickname: z.string().nullable(), handle: z.string().nullable() })
const legacySummary = z.object({
  messageId: z.string(), sender: person, recipients: z.array(person), subject: z.string(), snippet: z.string(),
  sentAt: z.string(), readAt: z.string().nullable(), attachmentCount: z.number(),
})
const legacyMessage = legacySummary.extend({
  viewerId: z.string(), body: z.string(), team: z.object({ id: z.string(), name: z.string() }),
  replyToId: z.string().nullable(), attachments: z.array(z.object({ attachmentId: z.string(), fileName: z.string(), mimeType: z.string().nullable().optional(), size: z.number() })),
})

function isLegacy(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && !("toRecipients" in value) && !("ccRecipients" in value) && !("relationKind" in value)
    && !("conversationId" in value) && !("relation" in value) && !("quote" in value)
}

function normalizeSummary(value: unknown): MailSummary {
  if (!isLegacy(value)) return value as MailSummary
  const summary = legacySummary.parse(value)
  return { ...summary, toRecipients: summary.recipients, ccRecipients: [], relationKind: null }
}

export function normalizeMailPage(value: unknown): MailOperationResult["messageList"] {
  if (typeof value !== "object" || value === null || !("items" in value) || !Array.isArray(value.items)) {
    return value as MailOperationResult["messageList"]
  }
  return { ...value, items: value.items.map(normalizeSummary) } as MailOperationResult["messageList"]
}

export function normalizeMailMessage(value: unknown): MailMessage {
  if (!isLegacy(value)) return value as MailMessage
  const message = legacyMessage.parse(value)
  return {
    ...normalizeSummary(message), viewerId: message.viewerId, body: message.body, team: message.team,
    replyToId: message.replyToId, attachments: message.attachments,
    conversationId: message.messageId, relation: null, quote: null, legacyFormat: true,
  }
}
