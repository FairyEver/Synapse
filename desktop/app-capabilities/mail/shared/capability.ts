import { z } from "zod"
import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"
import type { McpToolDefinition, CapabilityDomainDefinition } from "../../../synapse-capabilities/shared/types"
import type { PermissionAction } from "../../../electron/runtime/security"
import { MAIL_INPUT_SCHEMAS } from "./schema"
import type { MailAction } from "./types"

const descriptions: Record<MailAction, string> = {
  "account.list": "List external email accounts configured on this computer for the current SY identity; never returns credentials. If exactly one account exists and nextCursor is null, use it directly without asking which sender. Honor an explicit account; replies and existing drafts inherit their accountId. Ask only when multiple accounts remain ambiguous.",
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
  "sync.get": "Read synchronization state without starting work. Provide exactly one of jobId or accountId; accountId returns the current runtime job or null when none exists. After completion, automatic reconciliation keeps the job completed; manual refresh and failure recovery report active progress. Stopped jobs are not reported as running. syncProgress reports indexing or reconciling with confirmed completed/total counts (unknown total is null); indexed totals alone do not mean flag reconciliation is finished. Use message.count for indexed and server-reported totals and current coverage.",
  "sync.cancel": "Cancel historical synchronization for this job while leaving normal new-mail monitoring enabled.",
  "message.list": "List indexed external email, newest server receipt time first (unknown times fall back to header date). Use Inbox role folderId for received mail; omission includes Sent and Trash. Combine sender/recipient, subject, attachment and receivedAfter/receivedBefore filters. Address filters use exact emails or display names, not body mentions. Call sync.start/get first for latest mail; listing alone does not refresh. Coverage discloses unknown receipt/attachment metadata; reading never marks mail read.",
  "message.get": "Read metadata and attachment references for one external email ID or full synapse://mail/<id> reference; provide exactly one of messageId or reference. Does not mark it read or fetch every body.",
  "message.count": "Count matching indexed/unread mail with the same structured filters as message.list, without fetching bodies. Server-reported totals are null for filtered queries; coverage discloses unknown receipt/attachment metadata.",
  "message.update": "Set read or star flags for 1–100 explicit email IDs; returns individual results.",
  "message.move": "Move explicit emails with a stable request ID. Provider-specific semantics are checked; uncertain operations are not blindly repeated.",
  "message.delete": "Move explicit emails to Trash by default. Permanent deletion is only supported for exact UIDs in Trash; never expunges unrelated mail.",
  "message.restore": "Restore selected Trash emails to the specified folder or Inbox.",
  "search.start": "Start a bounded local literal-substring metadata/body search with structured sender, recipient, subject, attachment and receipt-time filters. query is not a natural-language or AND expression. Use message.list for structured-only searches and name/address lookup. Body search starts with cached text; explicitly resume for bounded remote scans. Returned coverage may be incomplete.",
  "search.get": "Page existing search results and read coverage; this call does not drive further network scanning.",
  "search.resume": "Continue one bounded batch of body or metadata scanning for an existing search job.",
  "search.cancel": "Cancel remaining search work and keep the results already found.",
  "draft.list": "List local and indexed remote email draft summaries for one account.",
  "draft.get": "Read a draft and its revision, content and independent local/server save states.",
  "draft.create": "Create a draft using accountId and content fields, or prepare reply, reply-all or forward using accountId, sourceMessageId, mode and optional forwardMode. The two input forms are mutually exclusive and validated at runtime; creating a draft never authorizes sending.",
  "draft.update": "Save email draft fields and asset references with expectedRevision; concurrent edits are rejected without overwriting.",
  "draft.delete": "Discard one exact draft revision and its associated remote copy; never deletes unrelated drafts.",
  "attachment.import_local": "Import a local file into this account's controlled email assets. Does not upload it to Drive.",
  "attachment.list": "List email or draft attachment metadata without downloading all attachment bytes. Provide exactly one of messageId or draftId.",
  "attachment.get": "Read attachment name, type, size, CID and hash metadata. Provide assetId, or messageId together with attachmentId; the forms are mutually exclusive. Does not parse attachment text.",
  "attachment.download_file": "Download one owned attachment to an absolute outputPath without overwriting an existing file. Provide assetId, or messageId together with attachmentId; the forms are mutually exclusive.",
  "attachment.delete": "Delete only an unreferenced local staged email asset; never modifies a server message.",
  "message.extract_to_file": "Export one external email's original MIME to an absolute local EML file.",
  "body.read_chunk": "Fetch and read a bounded body chunk for one external email; reports completeness and continuation. Never marks it read.",
  "send.preview": "Freeze the exact draft revision, addresses including Bcc, body, references and attachment hashes before sending.",
  "message.send": "Submit a frozen email preview authorized by the user with a stable request ID. confirmed declares checked authorization. Ask only for unresolved ambiguity or requested review; SMTP acceptance is not final delivery. An unknown result must be reconciled, not resent.",
  "operation.list": "List durable email send receipts, including partial rejection and unknown outcomes.",
  "operation.get": "Read a send receipt and perform bounded read-only Sent reconciliation; never repeats SMTP submission.",
  "cache.clear": "Clear only re-downloadable email body/attachment cache; preserves credentials, drafts and pending or unknown sends.",
}
const labels: Record<MailAction, string> = {
  "account.list": "列出本机邮箱账号、选择邮箱",
  "account.get": "读取邮箱设置和连接状态",
  "account.open": "打开邮箱接入设置、添加阿里邮箱",
  "account.update": "修改邮箱显示名、通知和非密码设置",
  "account.inspect": "检查 IMAP 和 SMTP 邮箱连接",
  "account.pause": "暂停后台收信",
  "account.resume": "恢复后台收信",
  "account.delete": "从当前电脑移除邮箱账号",
  "folder.list": "列出收件箱、已发送、草稿、回收站等文件夹",
  "folder.create": "新建邮件文件夹",
  "folder.rename": "重命名邮件文件夹",
  "folder.delete": "删除空邮件文件夹",
  "folder.update": "设置系统文件夹映射",
  "sync.start": "同步邮箱索引和历史邮件摘要",
  "sync.get": "查看邮箱同步进度和覆盖范围",
  "sync.cancel": "取消历史索引、继续收取新邮件",
  "message.list": "收件箱和已发送等邮件列表、按发件人收件人姓名地址主题附件和收件时间查信",
  "message.get": "查看邮件详情、读取邮件链接",
  "message.count": "统计邮件和未读数量",
  "message.update": "标记已读、未读和星标",
  "message.move": "移动邮件到文件夹",
  "message.delete": "邮件移入回收站或精确永久删除",
  "message.restore": "从回收站恢复邮件",
  "search.start": "搜索邮件主题、地址和正文、按字段组合筛选",
  "search.get": "查看邮件搜索结果和不完整覆盖范围",
  "search.resume": "继续检索尚未扫描的邮件正文",
  "search.cancel": "取消剩余邮件搜索",
  "draft.list": "列出邮件草稿",
  "draft.get": "读取邮件草稿和修订版本",
  "draft.create": "起草邮件、回复、回复全部和转发",
  "draft.update": "保存邮件草稿、正文和附件",
  "draft.delete": "删除指定版本的草稿",
  "attachment.import_local": "添加本机文件为邮件附件",
  "attachment.list": "列出邮件或草稿附件",
  "attachment.get": "读取邮件附件信息",
  "attachment.download_file": "下载邮件附件到本机",
  "attachment.delete": "删除未被引用的本机附件",
  "message.extract_to_file": "导出邮件原文 EML",
  "body.read_chunk": "按块读取邮件正文",
  "send.preview": "预览发件人、收件人、密送、正文和附件",
  "message.send": "发送已授权的邮件预览",
  "operation.list": "列出邮件发送回执",
  "operation.get": "核验邮件发送结果、查询已发送副本",
  "cache.clear": "清理可重新下载的邮箱缓存"
}
const reads = new Set<MailAction>(["account.list", "account.get", "folder.list", "sync.get", "message.list", "message.get", "message.count", "search.get", "draft.list", "draft.get", "attachment.list", "attachment.get", "body.read_chunk", "operation.list", "operation.get"])
const paginated = new Set<MailAction>(["account.list", "folder.list", "message.list", "search.get", "draft.list", "attachment.list", "operation.list"])
export const MAIL_ACTIONS = Object.keys(MAIL_INPUT_SCHEMAS) as MailAction[]
export const MAIL_DEFINITIONS = Object.fromEntries(MAIL_ACTIONS.map((action) => [action, {
  id: `app.mail.${action}` as CapabilityId,
  description: labels[action] + "。" + descriptions[action] + (paginated.has(action) ? " Pagination: cursor-based. Continue with nextCursor; reset when filters change." : ""),
  mutates: !reads.has(action),
  permission: (reads.has(action) ? "content.read" : action === "attachment.download_file" || action === "message.extract_to_file" ? "fs.write.outside-userdata" : action === "attachment.import_local" ? "fs.read.outside-userdata" : "content.mutate") as PermissionAction,
  risk: action === "message.delete" || action === "account.delete" ? "high" as const : "normal" as const,
}])) as Record<MailAction, { id: CapabilityId; description: string; mutates: boolean; permission: PermissionAction; risk: "normal" | "high" }>

export const MAIL_DOMAIN: CapabilityDomainDefinition = {
  id: "mail",
  capabilities: MAIL_ACTIONS.map((a) => ({ id: MAIL_DEFINITIONS[a].id, title: labels[a], description: MAIL_DEFINITIONS[a].description, mutates: MAIL_DEFINITIONS[a].mutates, ...(MAIL_DEFINITIONS[a].risk === "high" ? { risk: "high" as const } : {}) })),
}
export const MAIL_MCP_TOOL_ACTIONS = Object.fromEntries(MAIL_ACTIONS.map((a) => [`app_mail_${a.replaceAll(".", "_")}`, MAIL_DEFINITIONS[a].id]))
export function buildMailTools(): McpToolDefinition[] {
  return MAIL_ACTIONS.map((a) => {
    const schema = z.toJSONSchema(MAIL_INPUT_SCHEMAS[a], { io: "input" })
    // Some MCP clients reject top-level combinators. Discovery exposes all fields;
    // the shared runtime schema still enforces the strict alternative branches.
    const branches = schema.anyOf as { properties?: Record<string, unknown>; required?: string[] }[] | undefined
    const inputSchema = branches ? {
      type: "object" as const,
      properties: Object.assign({}, ...branches.map(branch => branch.properties)),
      required: (branches[0].required ?? []).filter(field => branches.every(branch => branch.required?.includes(field))),
      additionalProperties: false,
    } : { ...schema, type: "object" as const, properties: schema.properties ?? {}, additionalProperties: typeof schema.additionalProperties === "boolean" ? schema.additionalProperties : true }
    return { name: `app_mail_${a.replaceAll(".", "_")}`, description: MAIL_DEFINITIONS[a].description, inputSchema }
  })
}
