import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"
import type { CapabilityId } from "./naming"

const definitions = [
  ["app_mail_internal_recipient_list", "app.mail_internal.recipient.list", "Browse or search active users sharing a team with the current user. Returns contactEmail (nullable, never the login email) for external email address lookup as well as internal recipients. Resolve names using context and candidates; ask only when uncertainty remains."],
  ["app_mail_internal_organization_list", "app.mail_internal.organization.list", "Search organizations/departments in the current user's teams for internal mail or read-only external email recipient resolution. Disambiguate by team; a parent includes descendants. For external email, fetch all member pages and use contactEmail only, never an organization ID or an old relay address. Pagination: none; returns all matching organizations."],
  ["app_mail_internal_organization_members_list", "app.mail_internal.organization_members.list", "List active direct and descendant members of one visible organization, including nullable contactEmail (never login email). For external department email, read ALL pages until nextCursor is null; missing/invalid contactEmail must be reported by name and block sending until the user explicitly excludes those members. No silent omission or login-email fallback. Deduplicate actual email addresses, To wins Cc, then use external mail draft/preview/send. Pagination: cursor-based. Continue with nextCursor."],
  ["app_mail_internal_contact_list", "app.mail_internal.contact.list", "List historical senders for inbox or explicit To/Cc users and organizations for sent mail, newest related message first. Returns contact keys and inbox unread counts across the entire visible mailbox. Does not expand organization members. Pagination: none; returns all distinct contacts."],
  ["app_mail_internal_message_list", "app.mail_internal.message.list", "List the current user's received or sent internal mail. Optionally filter by a contactKey returned by app_mail_internal_contact_list, intersected with search and unread state. Sent contacts match explicit To/Cc addresses, not expanded organization members. Pagination: cursor-based. Continue with nextCursor; reset cursor when any filter changes."],
  ["app_mail_internal_message_count", "app.mail_internal.message.count", "Get exact received, sent, and unread inbox mail counts for the current user."],
  ["app_mail_internal_message_read_all", "app.mail_internal.message.read_all", "Mark all current user's unread inbox mail as read."],
  ["app_mail_internal_message_delete_batch", "app.mail_internal.message.delete_batch", "Hide up to 100 selected mail messages visible to the current user. Returns deleted count and skipped IDs."],
  ["app_mail_internal_message_delete_all", "app.mail_internal.message.delete_all", "Clear the current user's entire inbox or sent mailbox, regardless of search or pagination."],
  ["app_mail_internal_message_get", "app.mail_internal.message.get", "Read one internal mail visible to the current user without marking it read. Pass either messageId or the complete copied synapse://mail-internal/<id> reference."],
  ["app_mail_internal_context_list", "app.mail_internal.context.list", "List only the current user's visible messages in the same mail conversation. Pagination: cursor-based. Continue with nextCursor."],
  ["app_mail_internal_message_update", "app.mail_internal.message.update", "Mark one received mail read or unread for the current user."],
  ["app_mail_internal_message_delete", "app.mail_internal.message.delete", "Hide one mail from the current user's mailbox only."],
  ["app_mail_internal_attachment_create", "app.mail_internal.attachment.create", "Upload a local file as an internal mail attachment without adding it to Synapse Drive."],
  ["app_mail_internal_attachment_download_file", "app.mail_internal.attachment.download_file", "Download an attachment from a mail the current user may read to an absolute local path."],
  ["app_mail_internal_send_preview", "app.mail_internal.send.preview", "Fix recipient addresses, complete subject and body, attachments, and team before sending. Check the returned content; ask for confirmation only when ambiguity, uncertainty, or content requiring user review remains, or the user requested review. Organization membership is expanded again at send time."],
  ["app_mail_internal_message_send", "app.mail_internal.message.send", "Send a previously previewed internal mail authorized by the user. Send directly when recipients, content, and attachments are clear and no ambiguity, uncertainty, or content requiring user review remains. Otherwise resolve those points with the user before sending; honor any request to review first. Organization members may change before send. Does not open a compose UI."],
] as const satisfies readonly (readonly [string, CapabilityId, string])[]

export const MAIL_INTERNAL_DOMAIN: CapabilityDomainDefinition = {
  id: "mail_internal",
  capabilities: definitions.map(([, id, description]) => ({ id, title: description, description, mutates: !id.endsWith(".list") && !id.endsWith(".get") && !id.endsWith(".count") && !id.endsWith(".preview"), ...(id.endsWith(".delete_batch") || id.endsWith(".delete_all") ? { risk: "high" as const } : {}) })),
}

export const MAIL_INTERNAL_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(definitions.map(([name, id]) => [name, id]))

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
  attachmentIds: ids("Ready attachmentTokens returned by app_mail_internal_attachment_create, or empty when sharing a Drive link in the body."),
  forwardAttachmentIds: ids("Original attachment IDs to include when forwarding, or empty array."),
  relation: { type: "object", properties: { kind: { type: "string", enum: ["reply", "forward"] }, messageId: text("Visible source message ID.") }, required: ["kind", "messageId"], additionalProperties: false },
}

const schemas: Record<string, { properties: Record<string, unknown>; required?: readonly string[] }> = {
  app_mail_internal_recipient_list: { properties: { query: text("Recipient name, handle, or known userId; use an empty string to browse shared-team members."), cursor: text("Next cursor from a browse page.") }, required: ["query"] },
  app_mail_internal_organization_list: { properties: { query: text("Organization or team name; use an empty string to browse organizations in the current user's teams.") }, required: ["query"] },
  app_mail_internal_organization_members_list: { properties: { organizationId: text("Visible organization ID."), cursor: text("Next cursor from the prior member page.") }, required: ["organizationId"] },
  app_mail_internal_contact_list: { properties: { box: { type: "string", enum: ["inbox", "sent"] } }, required: ["box"] },
  app_mail_internal_message_list: { properties: { box: { type: "string", enum: ["inbox", "sent"] }, contactKey: text("Exact key from app_mail_internal_contact_list for this mailbox. Omit for all contacts."), query: text("Optional subject or body search."), cursor: text("Next cursor from prior page."), unreadOnly: { type: "boolean", description: "Only unread inbox mail; invalid for sent." } }, required: ["box"] },
  app_mail_internal_message_count: { properties: {} },
  app_mail_internal_message_read_all: { properties: {} },
  app_mail_internal_message_delete_batch: { properties: { messageIds: { ...ids("1 to 100 distinct mail IDs selected by the caller. Hidden or inaccessible IDs are returned in skippedIds."), minItems: 1, maxItems: 100, uniqueItems: true } }, required: ["messageIds"] },
  app_mail_internal_message_delete_all: { properties: { box: { type: "string", enum: ["inbox", "sent"], description: "Clear the complete mailbox, not just current search results or page." } }, required: ["box"] },
  app_mail_internal_message_get: { properties: { messageId: text("Mail ID. Use this or reference, not both."), reference: text("Complete copied synapse://mail-internal/<id> reference. Pass unchanged; use this or messageId, not both.") }, required: [] },
  app_mail_internal_context_list: { properties: { messageId: text("Mail id."), cursor: text("Next cursor from prior context page.") }, required: ["messageId"] },
  app_mail_internal_message_update: { properties: { messageId: text("Mail id."), read: { type: "boolean" } }, required: ["messageId", "read"] },
  app_mail_internal_message_delete: { properties: { messageId: text("Mail id.") }, required: ["messageId"] },
  app_mail_internal_attachment_create: { properties: { filePath: text("Absolute path to a local file to upload directly as a mail attachment.") }, required: ["filePath"] },
  app_mail_internal_attachment_download_file: { properties: { messageId: text("Mail id."), attachmentId: text("Attachment id in the mail."), outputPath: text("Absolute destination path.") }, required: ["messageId", "attachmentId", "outputPath"] },
  app_mail_internal_send_preview: { properties: content, required: ["formatVersion", "toIds", "ccIds", "toOrganizationIds", "ccOrganizationIds", "subject", "body", "attachmentIds", "forwardAttachmentIds"] },
  app_mail_internal_message_send: { properties: { previewId: text("Unexpired previewId from app_mail_internal_send_preview. Recreate the preview after content changes or expiry and re-evaluate whether user review is needed."), clientRequestId: text("Stable UUID for retries of this exact send."), confirmed: { type: "boolean", description: "Set true when the user has authorized sending and the caller has checked the preview: no unresolved ambiguity, uncertainty, or content requiring user review remains, and any user-requested review is complete. A separate confirmation reply is not required for a clear authorized send. This is a caller declaration, not proof of a user reply." } }, required: ["previewId", "clientRequestId", "confirmed"] },
}

export function buildMailInternalTools(): McpToolDefinition[] {
  return definitions.map(([name, , description]) => ({ name, description, inputSchema: { type: "object", properties: schemas[name]!.properties, required: schemas[name]!.required, additionalProperties: false } }))
}
