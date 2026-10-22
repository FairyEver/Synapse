import type { MailContent, MailMessage } from "@/types/mail"

export function canQuickReplyToMail(source: MailMessage): boolean {
  return source.kind !== "platform_broadcast"
}

export function mailReplyRecipientIds(source: MailMessage, viewerId: string): string[] {
  const recipients = source.sender.userId === viewerId ? source.toRecipients : [source.sender]
  const keepViewer = source.sender.userId === viewerId && recipients.some((person) => person.userId === viewerId)
  return [...new Set(recipients.map((person) => person.userId))].filter((id) => keepViewer || id !== viewerId)
}

export function createMailQuickReplyContent(source: MailMessage, body: string): MailContent {
  return {
    formatVersion: 3,
    toIds: mailReplyRecipientIds(source, source.viewerId),
    ccIds: [],
    toOrganizationIds: [],
    ccOrganizationIds: [],
    subject: `回复：${source.subject}`,
    body,
    attachmentIds: [],
    forwardAttachmentIds: [],
    relation: { kind: "reply", messageId: source.messageId },
  }
}
