import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"
import type { CapabilityId } from "./naming"

const definitions = [
  ["app_mail_recipient_list", "app.mail.recipient.list", "Search active users sharing a team with the current user. An exact unique result can be provisional; ask the user to choose when names are ambiguous."],
  ["app_mail_message_list", "app.mail.message.list", "List the current user's received or sent internal mail."],
  ["app_mail_message_get", "app.mail.message.get", "Read one internal mail visible to the current user."],
  ["app_mail_message_update", "app.mail.message.update", "Mark one received mail read or unread for the current user."],
  ["app_mail_message_delete", "app.mail.message.delete", "Hide one mail from the current user's mailbox only."],
  ["app_mail_draft_list", "app.mail.draft.list", "List current user's cross-device mail drafts."],
  ["app_mail_draft_create", "app.mail.draft.create", "Create a mail draft."],
  ["app_mail_draft_update", "app.mail.draft.update", "Update a mail draft using its current baseVersion."],
  ["app_mail_draft_delete", "app.mail.draft.delete", "Delete a mail draft."],
  ["app_mail_attachment_create", "app.mail.attachment.create", "Upload a local file as an internal mail attachment without adding it to Synapse Drive."],
  ["app_mail_attachment_download_file", "app.mail.attachment.download_file", "Download an attachment from a mail the current user may read to an absolute local path."],
  ["app_mail_send_preview", "app.mail.send.preview", "Fix recipients, complete subject and body, attachments, and team for final confirmation. Show the full preview to the user before sending."],
  ["app_mail_message_send", "app.mail.message.send", "Send a previously previewed internal mail only after the user explicitly confirms that exact recipients, subject, complete body, and attachments in conversation. Does not open a compose UI."],
] as const

export const MAIL_DOMAIN: CapabilityDomainDefinition = {
  id: "mail",
  capabilities: definitions.map(([, id, description]) => ({ id: id as CapabilityId, title: description, description, mutates: !id.endsWith(".list") && !id.endsWith(".get") && !id.endsWith(".preview") })),
}

export const MAIL_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(definitions.map(([name, id]) => [name, id]))

const text = (description: string) => ({ type: "string", description })
const ids = (description: string) => ({ type: "array", items: { type: "string" }, description })
const content = {
  recipientIds: ids("Resolved userIds. Select each recipient individually; no group address."),
  subject: text("Mail subject, at most 120 characters."),
  body: text("Complete plain-text mail body, at most 100000 characters."),
  attachmentIds: ids("Ready attachmentTokens returned by app_mail_attachment_create, or empty when sharing a Drive link in the body."),
  replyToId: text("Optional source message id when replying or forwarding."),
}

const schemas: Record<string, { properties: Record<string, unknown>; required?: readonly string[] }> = {
  app_mail_recipient_list: { properties: { query: text("Recipient name, handle, or known userId to search in shared teams.") }, required: ["query"] },
  app_mail_message_list: { properties: { box: { type: "string", enum: ["inbox", "sent"] }, query: text("Optional subject or body search."), cursor: text("Next cursor from prior page.") }, required: ["box"] },
  app_mail_message_get: { properties: { messageId: text("Mail id.") }, required: ["messageId"] },
  app_mail_message_update: { properties: { messageId: text("Mail id."), read: { type: "boolean" } }, required: ["messageId", "read"] },
  app_mail_message_delete: { properties: { messageId: text("Mail id.") }, required: ["messageId"] },
  app_mail_draft_list: { properties: {} },
  app_mail_draft_create: { properties: content, required: ["recipientIds", "subject", "body", "attachmentIds"] },
  app_mail_draft_update: { properties: { draftId: text("Draft id."), baseVersion: { type: "integer" }, ...content }, required: ["draftId", "baseVersion", "recipientIds", "subject", "body", "attachmentIds"] },
  app_mail_draft_delete: { properties: { draftId: text("Draft id.") }, required: ["draftId"] },
  app_mail_attachment_create: { properties: { filePath: text("Absolute path to a local file to upload directly as a mail attachment.") }, required: ["filePath"] },
  app_mail_attachment_download_file: { properties: { messageId: text("Mail id."), attachmentId: text("Attachment id in the mail."), outputPath: text("Absolute destination path.") }, required: ["messageId", "attachmentId", "outputPath"] },
  app_mail_send_preview: { properties: content, required: ["recipientIds", "subject", "body", "attachmentIds"] },
  app_mail_message_send: { properties: { previewId: text("Unexpired previewId from app_mail_send_preview; do not modify the preview after user confirmation."), clientRequestId: text("Stable UUID for retries of this exact send."), confirmed: { type: "boolean", description: "True only after the user explicitly confirms the complete preview in this conversation." } }, required: ["previewId", "clientRequestId", "confirmed"] },
}

export function buildMailTools(): McpToolDefinition[] {
  return definitions.map(([name, , description]) => ({ name, description, inputSchema: { type: "object", properties: schemas[name]!.properties, required: schemas[name]!.required, additionalProperties: false } }))
}
