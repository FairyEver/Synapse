import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"
import type { CapabilityId } from "./naming"

const definitions = [
  ["app_mail_recipient_list", "app.mail.recipient.list", "Browse or search active users sharing a team with the current user. An exact unique result can be provisional; ask the user to choose when names are ambiguous."],
  ["app_mail_organization_list", "app.mail.organization.list", "Search organizations in the current user's teams; selecting a parent includes all descendant members. Pagination: none; returns all matching organizations."],
  ["app_mail_organization_members_list", "app.mail.organization_members.list", "List active direct and descendant members of one organization visible to the current user. Pagination: cursor-based. Continue with nextCursor."],
  ["app_mail_message_list", "app.mail.message.list", "List the current user's received or sent internal mail. Pagination: cursor-based. Continue with nextCursor."],
  ["app_mail_message_count", "app.mail.message.count", "Get exact received, sent, and unread inbox mail counts for the current user."],
  ["app_mail_message_read_all", "app.mail.message.read_all", "Mark all current user's unread inbox mail as read."],
  ["app_mail_message_delete_batch", "app.mail.message.delete_batch", "Hide up to 100 selected mail messages visible to the current user. Returns deleted count and skipped IDs."],
  ["app_mail_message_delete_all", "app.mail.message.delete_all", "Clear the current user's entire inbox or sent mailbox, regardless of search or pagination."],
  ["app_mail_message_get", "app.mail.message.get", "Read one internal mail visible to the current user without marking it read. Pass either messageId or the complete copied synapse://mail/<id> reference."],
  ["app_mail_context_list", "app.mail.context.list", "List only the current user's visible messages in the same mail conversation. Pagination: cursor-based. Continue with nextCursor."],
  ["app_mail_message_update", "app.mail.message.update", "Mark one received mail read or unread for the current user."],
  ["app_mail_message_delete", "app.mail.message.delete", "Hide one mail from the current user's mailbox only."],
  ["app_mail_attachment_create", "app.mail.attachment.create", "Upload a local file as an internal mail attachment without adding it to Synapse Drive."],
  ["app_mail_attachment_download_file", "app.mail.attachment.download_file", "Download an attachment from a mail the current user may read to an absolute local path."],
  ["app_mail_send_preview", "app.mail.send.preview", "Fix recipient addresses, complete subject and body, attachments, and team for final confirmation. Organization membership is expanded again at send time."],
  ["app_mail_message_send", "app.mail.message.send", "Send a previously previewed internal mail only after the user explicitly confirms its addresses, subject, complete body, and attachments in conversation. Organization members may change before send. Does not open a compose UI."],
] as const satisfies readonly (readonly [string, CapabilityId, string])[]

export const MAIL_DOMAIN: CapabilityDomainDefinition = {
  id: "mail",
  capabilities: definitions.map(([, id, description]) => ({ id, title: description, description, mutates: !id.endsWith(".list") && !id.endsWith(".get") && !id.endsWith(".count") && !id.endsWith(".preview"), ...(id.endsWith(".delete_batch") || id.endsWith(".delete_all") ? { risk: "high" as const } : {}) })),
}

export const MAIL_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(definitions.map(([name, id]) => [name, id]))

const text = (description: string) => ({ type: "string", description })
const ids = (description: string) => ({ type: "array", items: { type: "string" }, description })
const content = {
  formatVersion: { type: "integer", enum: [3], description: "Required mail format version." },
  toIds: ids("Primary recipients' resolved userIds. Select each person individually."),
  ccIds: ids("Cc recipients' resolved userIds, or empty array."),
  toOrganizationIds: ids("Primary organization IDs; recipients include active members of every descendant organization at send time."),
  ccOrganizationIds: ids("Cc organization IDs; recipients include active members of every descendant organization at send time."),
  subject: text("Mail subject, at most 120 characters."),
  body: text("Complete plain-text mail body, at most 100000 characters."),
  attachmentIds: ids("Ready attachmentTokens returned by app_mail_attachment_create, or empty when sharing a Drive link in the body."),
  forwardAttachmentIds: ids("Original attachment IDs to include when forwarding, or empty array."),
  relation: { type: "object", properties: { kind: { type: "string", enum: ["reply", "forward"] }, messageId: text("Visible source message ID.") }, required: ["kind", "messageId"], additionalProperties: false },
}

const schemas: Record<string, { properties: Record<string, unknown>; required?: readonly string[] }> = {
  app_mail_recipient_list: { properties: { query: text("Recipient name, handle, or known userId; use an empty string to browse shared-team members."), cursor: text("Next cursor from a browse page.") }, required: ["query"] },
  app_mail_organization_list: { properties: { query: text("Organization or team name; use an empty string to browse organizations in the current user's teams.") }, required: ["query"] },
  app_mail_organization_members_list: { properties: { organizationId: text("Visible organization ID."), cursor: text("Next cursor from the prior member page.") }, required: ["organizationId"] },
  app_mail_message_list: { properties: { box: { type: "string", enum: ["inbox", "sent"] }, query: text("Optional subject or body search."), cursor: text("Next cursor from prior page."), unreadOnly: { type: "boolean", description: "Only unread inbox mail; invalid for sent." } }, required: ["box"] },
  app_mail_message_count: { properties: {} },
  app_mail_message_read_all: { properties: {} },
  app_mail_message_delete_batch: { properties: { messageIds: { ...ids("1 to 100 distinct mail IDs selected by the caller. Hidden or inaccessible IDs are returned in skippedIds."), minItems: 1, maxItems: 100, uniqueItems: true } }, required: ["messageIds"] },
  app_mail_message_delete_all: { properties: { box: { type: "string", enum: ["inbox", "sent"], description: "Clear the complete mailbox, not just current search results or page." } }, required: ["box"] },
  app_mail_message_get: { properties: { messageId: text("Mail ID. Use this or reference, not both."), reference: text("Complete copied synapse://mail/<id> reference. Pass unchanged; use this or messageId, not both.") }, required: [] },
  app_mail_context_list: { properties: { messageId: text("Mail id."), cursor: text("Next cursor from prior context page.") }, required: ["messageId"] },
  app_mail_message_update: { properties: { messageId: text("Mail id."), read: { type: "boolean" } }, required: ["messageId", "read"] },
  app_mail_message_delete: { properties: { messageId: text("Mail id.") }, required: ["messageId"] },
  app_mail_attachment_create: { properties: { filePath: text("Absolute path to a local file to upload directly as a mail attachment.") }, required: ["filePath"] },
  app_mail_attachment_download_file: { properties: { messageId: text("Mail id."), attachmentId: text("Attachment id in the mail."), outputPath: text("Absolute destination path.") }, required: ["messageId", "attachmentId", "outputPath"] },
  app_mail_send_preview: { properties: content, required: ["formatVersion", "toIds", "ccIds", "toOrganizationIds", "ccOrganizationIds", "subject", "body", "attachmentIds", "forwardAttachmentIds"] },
  app_mail_message_send: { properties: { previewId: text("Unexpired previewId from app_mail_send_preview; do not modify the preview after user confirmation."), clientRequestId: text("Stable UUID for retries of this exact send."), confirmed: { type: "boolean", description: "True only after the user explicitly confirms the complete preview in this conversation." } }, required: ["previewId", "clientRequestId", "confirmed"] },
}

export function buildMailTools(): McpToolDefinition[] {
  return definitions.map(([name, , description]) => ({ name, description, inputSchema: { type: "object", properties: schemas[name]!.properties, required: schemas[name]!.required, additionalProperties: false } }))
}
