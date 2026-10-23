import { z } from "zod"
import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"
import type { McpToolDefinition, CapabilityDomainDefinition } from "../../../synapse-capabilities/shared/types"
import type { PermissionAction } from "../../../electron/runtime/security"
import { MAIL_INPUT_SCHEMAS } from "./schema"
import type { MailAction } from "./types"

const descriptions: Record<MailAction, string> = {
  "account.list": "List external email accounts configured on this computer for the current SY identity; never returns credentials.",
  "account.get": "Get one local email account configuration, connection state and available capabilities; no credentials.",
  "account.open": "Open the local email account setup UI. The user enters credentials on this computer; this tool never accepts secrets.",
  "account.update": "Update non-secret email settings with expectedRevision. Endpoint changes require connection revalidation.",
  "account.inspect": "Check IMAP and SMTP authentication independently without sending a test email.",
  "account.pause": "Pause this email account's background connections and synchronization.",
  "account.resume": "Resume background email synchronization and return its job ID.",
  "account.delete": "Remove only this computer's email account and data. Acknowledge local draft and unknown-send impacts explicitly; never deletes server mail.",
  "folder.list": "List indexed server email folders, special-role mappings and available operations.",
  "folder.create": "Create an ordinary email folder, optionally under a known parent.",
  "folder.rename": "Rename an ordinary email folder while preserving its local identity.",
  "folder.delete": "Delete an empty ordinary email folder only; system folders are protected.",
  "folder.update": "Map a real server folder to a special role with account revision checking.",
  "sync.start": "Request bounded metadata synchronization. Returns a job ID; historical bodies and attachments are not mirrored.",
  "sync.get": "Get a synchronization job's progress, actual coverage and diagnostic status.",
  "sync.cancel": "Cancel historical synchronization for this job while leaving normal new-mail monitoring enabled.",
  "message.list": "List indexed external email; omit folderId for this account's folders. Filters and coverage are explicit; reading does not mark mail read.",
  "message.get": "Read metadata and attachment references for one external email ID or full synapse://mail/<id> reference; does not mark it read or fetch every body.",
  "message.count": "Return indexed, unread and server-reported counts separately with actual index coverage.",
  "message.update": "Set read or star flags for 1–100 explicit email IDs; returns individual results.",
  "message.move": "Move explicit emails with a stable request ID. Provider-specific semantics are checked; uncertain operations are not blindly repeated.",
  "message.delete": "Move explicit emails to Trash by default. Permanent deletion is only supported for exact UIDs in Trash; never expunges unrelated mail.",
  "message.restore": "Restore selected Trash emails to the specified folder or Inbox.",
  "search.start": "Start a bounded local metadata or body search. Server text search is not assumed reliable; returned coverage may be incomplete.",
  "search.get": "Page existing search results and read coverage; this call does not drive further network scanning.",
  "search.resume": "Continue one bounded batch of body or metadata scanning for an existing search job.",
  "search.cancel": "Cancel remaining search work and keep the results already found.",
  "draft.list": "List local and indexed remote email draft summaries for one account.",
  "draft.get": "Read a draft and its revision, content and independent local/server save states.",
  "draft.create": "Create a draft, or prepare reply, reply-all or forward from a known email; creating a draft never authorizes sending.",
  "draft.update": "Save email draft fields and asset references with expectedRevision; concurrent edits are rejected without overwriting.",
  "draft.delete": "Discard one exact draft revision and its associated remote copy; never deletes unrelated drafts.",
  "attachment.import_local": "Import a local file into this account's controlled email assets. Does not upload it to Drive.",
  "attachment.list": "List email or draft attachment metadata without downloading all attachment bytes.",
  "attachment.get": "Read attachment name, type, size, CID and hash metadata. Does not parse attachment text.",
  "attachment.download_file": "Download one owned attachment to an absolute local path without overwriting an existing file.",
  "attachment.delete": "Delete only an unreferenced local staged email asset; never modifies a server message.",
  "message.extract_to_file": "Export one external email's original MIME to an absolute local EML file.",
  "body.read_chunk": "Fetch and read a bounded body chunk for one external email; reports completeness and continuation. Never marks it read.",
  "send.preview": "Freeze the exact draft revision, addresses including Bcc, body, references and attachment hashes before sending.",
  "message.send": "Submit a frozen email preview authorized by the user with a stable request ID. confirmed declares checked authorization. Ask only for unresolved ambiguity or requested review; SMTP acceptance is not final delivery. An unknown result must be reconciled, not resent.",
  "operation.list": "List durable email send receipts, including partial rejection and unknown outcomes.",
  "operation.get": "Read a send receipt and perform bounded read-only Sent reconciliation; never repeats SMTP submission.",
  "cache.clear": "Clear only re-downloadable email body/attachment cache; preserves credentials, drafts and pending or unknown sends.",
}
const reads = new Set<MailAction>(["account.list", "account.get", "folder.list", "sync.get", "message.list", "message.get", "message.count", "search.get", "draft.list", "draft.get", "attachment.list", "attachment.get", "body.read_chunk", "operation.list", "operation.get"])
const paginated = new Set<MailAction>(["account.list", "folder.list", "message.list", "search.get", "draft.list", "attachment.list", "operation.list"])
export const MAIL_ACTIONS = Object.keys(MAIL_INPUT_SCHEMAS) as MailAction[]
export const MAIL_DEFINITIONS = Object.fromEntries(MAIL_ACTIONS.map((action) => [action, {
  id: `app.mail.${action}` as CapabilityId,
  description: descriptions[action] + (paginated.has(action) ? " Pagination: cursor-based. Continue with nextCursor; reset when filters change." : ""),
  mutates: !reads.has(action),
  permission: (reads.has(action) ? "content.read" : action === "attachment.download_file" || action === "message.extract_to_file" ? "fs.write.outside-userdata" : action === "attachment.import_local" ? "fs.read.outside-userdata" : "content.mutate") as PermissionAction,
  risk: action === "message.delete" || action === "account.delete" ? "high" as const : "normal" as const,
}])) as Record<MailAction, { id: CapabilityId; description: string; mutates: boolean; permission: PermissionAction; risk: "normal" | "high" }>

export const MAIL_DOMAIN: CapabilityDomainDefinition = {
  id: "mail",
  capabilities: MAIL_ACTIONS.map((a) => ({ id: MAIL_DEFINITIONS[a].id, title: descriptions[a], description: MAIL_DEFINITIONS[a].description, mutates: MAIL_DEFINITIONS[a].mutates, ...(MAIL_DEFINITIONS[a].risk === "high" ? { risk: "high" as const } : {}) })),
}
export const MAIL_MCP_TOOL_ACTIONS = Object.fromEntries(MAIL_ACTIONS.map((a) => [`app_mail_${a.replaceAll(".", "_")}`, MAIL_DEFINITIONS[a].id]))
export function buildMailTools(): McpToolDefinition[] {
  return MAIL_ACTIONS.map((a) => ({ name: `app_mail_${a.replaceAll(".", "_")}`, description: MAIL_DEFINITIONS[a].description, inputSchema: z.toJSONSchema(MAIL_INPUT_SCHEMAS[a], { io: "input" }) }))
}
