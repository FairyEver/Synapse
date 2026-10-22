import type { MailContent, MailMessage } from "@/types/mail"

export function canQuickReplyToMail(source: MailMessage): boolean {
  return source.kind !== "platform_broadcast"
}

type MailReplyRecipients = { toIds: string[]; toOrganizationIds: string[] }

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export function mailReplyRecipients(source: MailMessage, viewerId: string): MailReplyRecipients {
  if (source.sender.userId !== viewerId) {
    return { toIds: unique([source.sender.userId]), toOrganizationIds: [] }
  }

  const addresses = source.toAddresses?.length ? source.toAddresses : null
  const personIds = addresses
    ? addresses.filter((address) => address.kind === "user").map((address) => address.userId)
    : source.toRecipients.map((person) => person.userId)
  const organizationIds = addresses
    ? addresses.filter((address) => address.kind === "organization").map((address) => address.organizationId)
    : []
  const keepViewer = personIds.includes(viewerId)
  return {
    toIds: unique(personIds).filter((id) => keepViewer || id !== viewerId),
    toOrganizationIds: unique(organizationIds),
  }
}

export function createMailQuickReplyContent(source: MailMessage, body: string): MailContent {
  const recipients = mailReplyRecipients(source, source.viewerId)
  return {
    formatVersion: 3,
    toIds: recipients.toIds,
    ccIds: [],
    toOrganizationIds: recipients.toOrganizationIds,
    ccOrganizationIds: [],
    subject: `回复：${source.subject}`,
    body,
    attachmentIds: [],
    forwardAttachmentIds: [],
    relation: { kind: "reply", messageId: source.messageId },
  }
}
