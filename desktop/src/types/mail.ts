export type MailPerson = { userId: string; nickname: string | null; handle: string | null }
export type MailAttachment = { attachmentId: string; fileName: string; mimeType?: string | null; size: number; versionId?: string | null }
export type MailSummary = {
  messageId: string
  sender: MailPerson
  recipients: MailPerson[]
  subject: string
  snippet: string
  sentAt: string
  readAt: string | null
  attachmentCount: number
}
export type MailMessage = MailSummary & { viewerId: string; body: string; team: { id: string; name: string }; replyToId: string | null; attachments: MailAttachment[] }
export type MailDraft = { draftId: string; recipientIds: string[]; subject: string; body: string; attachmentIds: string[]; attachments?: MailAttachment[]; replyToId: string | null; version: number; updatedAt: string }
export type MailContent = { recipientIds: string[]; subject: string; body: string; attachmentIds: string[]; replyToId?: string }
export type MailOperation =
  | { kind: "recipientSearch"; query: string }
  | { kind: "messageList"; box: "inbox" | "sent"; query?: string; cursor?: string }
  | { kind: "messageGet"; messageId: string }
  | { kind: "messageSetRead"; messageId: string; read: boolean }
  | { kind: "messageDelete"; messageId: string }
  | { kind: "draftList" }
  | { kind: "draftCreate"; content: MailContent }
  | { kind: "draftUpdate"; draftId: string; baseVersion: number; content: MailContent }
  | { kind: "draftDelete"; draftId: string }
  | { kind: "attachmentPrepare"; driveItemId: string; versionId?: string }
  | { kind: "attachmentLocal"; filePath: string }
  | { kind: "attachmentDownload"; messageId: string; attachmentId: string; outputPath?: string }
  | { kind: "sendPreview"; content: MailContent }
  | { kind: "send"; previewId: string; clientRequestId: string }

export type MailOperationResult = {
  recipientSearch: { items: (MailPerson & { matchKind: "exact" | "prefix" | "partial" | "fuzzy" | "browse"; similarity: number; sharedTeamIds: string[] })[] }
  messageList: { items: MailSummary[]; nextCursor: string | null }
  messageGet: MailMessage
  messageSetRead: { read: boolean }
  messageDelete: { deleted: boolean }
  draftList: { items: MailDraft[] }
  draftCreate: MailDraft
  draftUpdate: MailDraft
  draftDelete: { deleted: boolean }
  attachmentPrepare: MailAttachment & { attachmentToken: string; state: "ready" }
  attachmentLocal: MailAttachment & { attachmentToken: string; state: "ready" }
  attachmentDownload: { path: string } | null
  sendPreview: { previewId: string; expiresAt: string; team: { id: string; name: string }; recipients: MailPerson[]; subject: string; body: string; attachments: MailAttachment[] }
  send: { messageId: string; recipientIds: string[]; sentAt: string }
}
