export type MailPerson = { userId: string; nickname: string | null; handle: string | null }
export type MailAttachment = { attachmentId: string; fileName: string; mimeType?: string | null; size: number }
export type MailRelation = { kind: "reply" | "forward"; messageId: string }
export type MailQuote = { sender: MailPerson; toRecipients: MailPerson[]; ccRecipients: MailPerson[]; subject: string; body: string; sentAt: string }
export type MailSummary = {
  messageId: string
  sender: MailPerson
  recipients: MailPerson[]
  toRecipients: MailPerson[]
  ccRecipients: MailPerson[]
  relationKind: "reply" | "forward" | null
  subject: string
  snippet: string
  sentAt: string
  readAt: string | null
  attachmentCount: number
}
export type MailMessage = MailSummary & { viewerId: string; body: string; team: { id: string; name: string }; conversationId: string; replyToId: string | null; relation: MailRelation | null; quote: MailQuote | null; attachments: MailAttachment[]; legacyFormat?: boolean }
export type MailContent = { formatVersion: 2; toIds: string[]; ccIds: string[]; subject: string; body: string; attachmentIds: string[]; forwardAttachmentIds: string[]; relation?: MailRelation }
export type MailOperation =
  | { kind: "recipientSearch"; query: string; cursor?: string }
  | { kind: "messageList"; box: "inbox" | "sent"; query?: string; cursor?: string; unreadOnly?: boolean }
  | { kind: "messageCount" }
  | { kind: "messageReadAll" }
  | { kind: "messageDeleteBatch"; messageIds: string[] }
  | { kind: "messageDeleteAll"; box: "inbox" | "sent" }
  | { kind: "messageGet"; messageId: string }
  | { kind: "messageContext"; messageId: string; cursor?: string }
  | { kind: "messageSetRead"; messageId: string; read: boolean }
  | { kind: "messageDelete"; messageId: string }
  | { kind: "attachmentLocal"; filePath: string }
  | { kind: "attachmentDownload"; messageId: string; attachmentId: string; outputPath?: string }
  | { kind: "sendPreview"; content: MailContent }
  | { kind: "send"; previewId: string; clientRequestId: string }

export type MailOperationResult = {
  recipientSearch: { items: (MailPerson & { matchKind: "exact" | "prefix" | "partial" | "fuzzy" | "browse"; similarity: number; sharedTeamIds: string[] })[]; nextCursor: string | null }
  messageList: { items: MailSummary[]; nextCursor: string | null }
  messageCount: { inboxTotal: number; sentTotal: number; unread: number }
  messageReadAll: { updated: number }
  messageDeleteBatch: { deleted: number; skippedIds: string[] }
  messageDeleteAll: { deleted: number }
  messageGet: MailMessage
  messageContext: { items: MailSummary[]; nextCursor: string | null }
  messageSetRead: { read: boolean }
  messageDelete: { deleted: boolean }
  attachmentLocal: MailAttachment & { attachmentToken: string; state: "ready" }
  attachmentDownload: { path: string } | null
  sendPreview: { previewId: string; expiresAt: string; team: { id: string; name: string }; recipients: MailPerson[]; toRecipients: MailPerson[]; ccRecipients: MailPerson[]; subject: string; body: string; quote: MailQuote | null; attachments: MailAttachment[] }
  send: { messageId: string; recipientIds: string[]; sentAt: string }
}
