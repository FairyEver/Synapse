import { z } from "zod"
import { MAIL_MAX_BODY_BYTES, MAIL_MAX_ATTACHMENTS, MAIL_MAX_PAGE_SIZE, MAIL_PAGE_SIZE } from "./limits"
import { MAIL_MESSAGE_ID_PATTERN, parseMailReference } from "./manifest"

const opaque = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`))
export const accountIdSchema = opaque("ma")
export const folderIdSchema = opaque("mf")
export const assetIdSchema = opaque("mas")
export const draftIdSchema = opaque("md")
export const jobIdSchema = opaque("mj")
export const operationIdSchema = opaque("mo")
export const messageIdSchema = z.string().regex(MAIL_MESSAGE_ID_PATTERN)
export const revisionSchema = z.number().int().positive()
const line = z.string().max(1000).regex(/^[^\r\n\x00]*$/u)
const text = z.string().refine((s) => new TextEncoder().encode(s).length <= MAIL_MAX_BODY_BYTES, "Body too large")
export const addressSchema = z.object({ address: z.email().max(320), name: line.optional() }).strict()
export const endpointSchema = z.object({ host: z.string().min(1).max(253).regex(/^[a-zA-Z0-9._-]+$/u), port: z.number().int().min(1).max(65535), security: z.enum(["tls", "starttls"]) }).strict()
export const accountConfigSchema = z.object({
  provider: z.enum(["aliyun", "custom"]), name: line.min(1).max(100), email: z.email().max(320),
  username: line.min(1).optional(), smtpUsername: line.min(1).optional(),
  imap: endpointSchema, smtp: endpointSchema, sentPolicy: z.enum(["server", "client"]),
  aliases: z.array(z.email().max(320)).max(30).default([]), notify: z.boolean().default(true),
}).strict()
const accountPatchSchema = accountConfigSchema.omit({ aliases: true, notify: true }).partial().extend({
  aliases: z.array(z.email().max(320)).max(30).optional(), notify: z.boolean().optional(),
}).strict().refine((p) => Object.keys(p).length > 0)
export const roleSchema = z.enum(["inbox", "sent", "drafts", "trash", "junk", "none"])
export const locatorSchema = z.object({ accountId: accountIdSchema, folderId: folderIdSchema, uidValidity: z.string().min(1), uid: z.number().int().positive() }).strict()
export const coverageSchema = z.object({ metadataComplete: z.boolean(), serverHistoryComplete: z.boolean().nullable(), indexedCount: z.number().int().nonnegative(), bodyScannedCount: z.number().int().nonnegative(), bodyPendingCount: z.number().int().nonnegative().nullable(), reason: z.string().nullable() }).strict()
const pageInput = { cursor: z.string().max(4096).optional(), limit: z.number().int().min(1).max(MAIL_MAX_PAGE_SIZE).default(MAIL_PAGE_SIZE) }
const account = { accountId: accountIdSchema }
const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() }).strict()
const messageIds = z.array(messageIdSchema).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, "Duplicate IDs")
const mutation = { ...account, messageIds, clientRequestId: z.uuid() }
const addressFilter = z.string().trim().min(1).max(320).describe("Email address (exact, case-insensitive) or display-name substring. Does not match subject or body.")
const filters = {
  folderId: folderIdSchema.optional().describe("Use the folder with role=inbox for received mail; omission includes all account folders."),
  unreadOnly: z.boolean().optional(), starredOnly: z.boolean().optional(),
  from: z.iso.datetime().optional().describe("Inclusive sender/header date lower bound (ISO UTC), NOT a sender address. Use sender for addresses."),
  to: z.iso.datetime().optional().describe("Inclusive sender/header date upper bound (ISO UTC), NOT a recipient address. Use recipient for addresses."),
  receivedAfter: z.iso.datetime().optional().describe("Inclusive server INTERNALDATE lower bound (ISO UTC). Use for today/recently received mail; missing receipt times are excluded and reported in coverage."),
  receivedBefore: z.iso.datetime().optional().describe("Exclusive server INTERNALDATE upper bound (ISO UTC). Convert the user's local day to UTC first."),
  sender: addressFilter.optional().describe("Match From only: exact email address or display-name substring; multiple matches require disambiguation before sending."),
  recipient: addressFilter.optional().describe("Match To or Cc only: exact email address or display-name substring. Does not reveal Bcc."),
  subject: z.string().trim().min(1).max(998).optional().describe("Case-insensitive Unicode-normalized subject substring."),
  hasAttachments: z.boolean().optional().describe("Filter attachment presence using indexed MIME metadata; no attachment bytes are downloaded."),
  attachmentName: z.string().trim().min(1).max(255).optional().describe("Attachment filename substring, e.g. .pdf. Combined with attachmentMime on the SAME attachment."),
  attachmentMime: z.string().trim().min(3).max(127).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/u).optional().describe("Exact MIME type, e.g. application/pdf. Missing indexed MIME metadata is reported in coverage."),
}
const validTimeRange = (v: { from?: string; to?: string; receivedAfter?: string; receivedBefore?: string }) =>
  !(v.from && v.to && Date.parse(v.from) > Date.parse(v.to))
  && !(v.receivedAfter && v.receivedBefore && Date.parse(v.receivedAfter) >= Date.parse(v.receivedBefore))
const messageReference = z.union([
  z.object({ messageId: messageIdSchema }).strict(),
  z.object({ reference: z.string().max(2048).refine((s) => parseMailReference(s) !== null) }).strict(),
])
const assetReference = z.union([
  z.object({ assetId: assetIdSchema }).strict(),
  z.object({ messageId: messageIdSchema, attachmentId: z.string().min(1).max(200) }).strict(),
])
const draftFields = {
  to: z.array(addressSchema).max(500).default([]), cc: z.array(addressSchema).max(500).default([]), bcc: z.array(addressSchema).max(500).default([]),
  subject: line.max(998).default(""), html: text.default(""), text: text.default(""),
  assetIds: z.array(assetIdSchema).max(MAIL_MAX_ATTACHMENTS).default([]),
  inlineImages: z.array(z.object({ assetId: assetIdSchema, cid: line.min(1).max(200) }).strict()).max(MAIL_MAX_ATTACHMENTS).default([]),
}
export const draftInputSchema = z.object({ ...account, ...draftFields }).strict()
const draftPatchSchema = z.object({
  to: draftFields.to.removeDefault().optional(), cc: draftFields.cc.removeDefault().optional(), bcc: draftFields.bcc.removeDefault().optional(),
  subject: draftFields.subject.removeDefault().optional(), html: draftFields.html.removeDefault().optional(), text: draftFields.text.removeDefault().optional(),
  assetIds: draftFields.assetIds.removeDefault().optional(), inlineImages: draftFields.inlineImages.removeDefault().optional(),
}).strict().refine((p) => Object.keys(p).length > 0)
export const sendStateSchema = z.enum(["prepared", "submitting", "accepted", "partial", "failed", "unknown"])
export const MAIL_INPUT_SCHEMAS = {
  "account.list": z.object(pageInput).strict(),
  "account.get": z.object(account).strict(),
  "account.open": z.object({ accountId: accountIdSchema.optional() }).strict(),
  "account.update": z.object({ ...account, expectedRevision: revisionSchema, patch: accountPatchSchema }).strict(),
  "account.inspect": z.object(account).strict(), "account.pause": z.object(account).strict(), "account.resume": z.object(account).strict(),
  "account.delete": z.object({ ...account, expectedRevision: revisionSchema, discardLocalDrafts: z.boolean().default(false), acknowledgeUnknownOperations: z.boolean().default(false) }).strict(),
  "folder.list": z.object({ ...account, ...pageInput }).strict(),
  "folder.create": z.object({ ...account, name: line.min(1).max(255), parentFolderId: folderIdSchema.optional() }).strict(),
  "folder.rename": z.object({ ...account, folderId: folderIdSchema, name: line.min(1).max(255) }).strict(),
  "folder.delete": z.object({ ...account, folderId: folderIdSchema }).strict(),
  "folder.update": z.object({ ...account, folderId: folderIdSchema, role: roleSchema, expectedAccountRevision: revisionSchema }).strict(),
  "sync.start": z.object({ ...account, folderId: folderIdSchema.optional() }).strict(),
  "sync.get": z.object({ jobId: jobIdSchema.optional(), accountId: accountIdSchema.optional() }).strict()
    .refine(v => (v.jobId !== undefined) !== (v.accountId !== undefined), "Provide exactly one of jobId or accountId"),
  "sync.cancel": z.object({ jobId: jobIdSchema }).strict(),
  "message.list": z.object({ ...account, ...filters, ...pageInput }).strict().refine(validTimeRange, "Invalid date range"),
  "message.get": messageReference,
  "message.count": z.object({ ...account, ...filters }).strict().refine(validTimeRange, "Invalid date range"),
  "message.update": z.object({ ...account, messageIds, patch: z.object({ read: z.boolean().optional(), star: z.boolean().optional() }).strict().refine((p) => Object.keys(p).length > 0) }).strict(),
  "message.move": z.object({ ...mutation, targetFolderId: folderIdSchema }).strict(),
  "message.delete": z.object({ ...mutation, permanent: z.boolean().default(false) }).strict(),
  "message.restore": z.object({ ...mutation, targetFolderId: folderIdSchema.optional() }).strict(),
  "search.start": z.object({ ...account, ...filters, query: z.string().trim().min(1).max(500).describe("One literal substring, not a natural-language query, AND expression or Gmail search syntax. Use structured filters for sender/recipient/subject."), fields: z.enum(["metadata", "body"]).default("metadata") }).strict().refine(validTimeRange, "Invalid date range"),
  "search.get": z.object({ jobId: jobIdSchema, ...pageInput }).strict(),
  "search.resume": z.object({ jobId: jobIdSchema }).strict(), "search.cancel": z.object({ jobId: jobIdSchema }).strict(),
  "draft.list": z.object({ ...account, ...pageInput }).strict(), "draft.get": z.object({ draftId: draftIdSchema }).strict(),
  "draft.create": z.union([draftInputSchema, z.object({ ...account, sourceMessageId: messageIdSchema, mode: z.enum(["reply", "reply_all", "forward"]), forwardMode: z.enum(["inline", "eml"]).default("inline") }).strict()]),
  "draft.update": z.object({ draftId: draftIdSchema, expectedRevision: revisionSchema, patch: draftPatchSchema }).strict(),
  "draft.delete": z.object({ draftId: draftIdSchema, expectedRevision: revisionSchema }).strict(),
  "attachment.import_local": z.object({ ...account, filePath: z.string().min(1).max(4096) }).strict(),
  "attachment.list": z.union([z.object({ messageId: messageIdSchema, ...pageInput }).strict(), z.object({ draftId: draftIdSchema, ...pageInput }).strict()]),
  "attachment.get": assetReference,
  "attachment.download_file": z.union([z.object({ assetId: assetIdSchema, outputPath: z.string().min(1).max(4096) }).strict(), z.object({ messageId: messageIdSchema, attachmentId: line.min(1).max(200), outputPath: z.string().min(1).max(4096) }).strict()]),
  "attachment.delete": z.object({ assetId: assetIdSchema }).strict(),
  "message.extract_to_file": z.object({ messageId: messageIdSchema, outputPath: z.string().min(1).max(4096) }).strict(),
  "body.read_chunk": z.object({ messageId: messageIdSchema, bodyRef: assetIdSchema.optional(), cursor: z.string().max(4096).optional() }).strict(),
  "send.preview": z.object({ draftId: draftIdSchema, expectedRevision: revisionSchema }).strict(),
  "message.send": z.object({ previewId: opaque("mp"), clientRequestId: z.uuid(), confirmed: z.literal(true) }).strict(),
  "operation.list": z.object({ ...account, ...pageInput, state: sendStateSchema.optional() }).strict(),
  "operation.get": z.object({ operationId: operationIdSchema }).strict(), "cache.clear": z.object(account).strict(),
} as const

export const accountSummarySchema = accountConfigSchema.extend({ id: accountIdSchema, revision: revisionSchema, paused: z.boolean(), state: z.enum(["unverified", "connecting", "connected", "offline", "auth_failed", "error", "paused"]), errorCode: z.string().nullable(), capabilities: z.array(z.string()) }).strict()
export const folderSchema = z.object({ id: folderIdSchema, accountId: accountIdSchema, path: z.string(), name: z.string(), role: roleSchema, uidValidity: z.string().nullable(), serverCount: z.number().nullable(), metadataComplete: z.boolean(), selectable: z.boolean() }).strict()
export const assetSchema = z.object({ id: assetIdSchema, accountId: accountIdSchema, name: z.string(), mime: z.string(), size: z.number().int().nonnegative(), sha256: z.string().nullable(), cid: z.string().nullable(), state: z.enum(["remote", "staged", "ready", "delete-pending"]), attachmentId: z.string().nullable(), messageId: messageIdSchema.nullable() }).strict()
export const summarySchema = z.object({ id: messageIdSchema, accountId: accountIdSchema, locator: locatorSchema, from: z.array(addressSchema), to: z.array(addressSchema), cc: z.array(addressSchema), subject: z.string(), snippet: z.string(), date: z.string().nullable(), receivedAt: z.iso.datetime().nullable().optional().describe("Server INTERNALDATE, not the sender header date; null/absent means unknown."), read: z.boolean(), star: z.boolean(), attachmentCount: z.number().int().nonnegative(), bodyState: z.enum(["remote", "cached", "unavailable"]), revision: revisionSchema, metadataTruncated: z.boolean().optional(), stale: z.boolean() }).strict()
export const draftSchema = draftInputSchema.extend({ id: draftIdSchema, revision: revisionSchema, state: z.enum(["editing", "consumed", "conflict"]), sourceMessageId: messageIdSchema.nullable(), mode: z.enum(["new", "reply", "reply_all", "forward"]), remoteLocator: locatorSchema.nullable(), localSaved: z.boolean(), syncState: z.enum(["pending", "synced", "failed", "unknown", "conflict"]), updatedAt: z.string() }).strict()
export const receiptSchema = z.object({ operationId: operationIdSchema, accountId: accountIdSchema, state: sendStateSchema, accepted: z.array(z.string()), rejected: z.array(z.string()), messageId: z.string(), sentCopyState: z.enum(["pending", "saved", "unknown", "failed"]), retryStage: z.enum(["none", "sent-copy", "reconcile"]), errorCode: z.string().nullable() }).strict()
export const batchSchema = z.object({ items: z.array(z.object({ id: messageIdSchema, status: z.enum(["succeeded", "failed", "unknown"]), code: z.string().optional(), newRevision: revisionSchema.optional() }).strict()) }).strict()
const ok = z.object({ success: z.boolean() }).strict()
const job = z.object({ jobId: jobIdSchema }).strict()
export const syncProgressSchema = z.object({ phase: z.enum(["indexing", "reconciling"]), completed: z.number().int().nonnegative(), total: z.number().int().nonnegative().nullable() }).strict()
export const jobSchema = z.object({ jobId: jobIdSchema, accountId: accountIdSchema, state: z.enum(["running", "paused", "completed", "cancelled", "failed"]), coverage: coverageSchema, errorCode: z.string().nullable(), syncProgress: syncProgressSchema.optional() }).strict()
const download = z.object({ outputPath: z.string(), size: z.number().int().nonnegative(), sha256: z.string() }).strict()
export const previewSchema = z.object({ previewId: opaque("mp"), expiresAt: z.string(), from: addressSchema, draft: draftSchema, attachments: z.array(assetSchema), messageId: z.string() }).strict()
export const MAIL_RESULT_SCHEMAS = {
  "account.list": page(accountSummarySchema), "account.get": accountSummarySchema, "account.open": ok, "account.update": accountSummarySchema,
  "account.inspect": z.object({ imap: z.object({ ok: z.boolean(), code: z.string().nullable() }).strict(), smtp: z.object({ ok: z.boolean(), code: z.string().nullable() }).strict() }).strict(),
  "account.pause": accountSummarySchema, "account.resume": job, "account.delete": ok,
  "folder.list": page(folderSchema), "folder.create": folderSchema, "folder.rename": folderSchema, "folder.delete": ok, "folder.update": folderSchema,
  "sync.start": job, "sync.get": jobSchema.nullable(), "sync.cancel": jobSchema,
  "message.list": page(summarySchema).extend({ coverage: coverageSchema }),
  "message.get": summarySchema.extend({ attachments: z.array(assetSchema), bodyRef: assetIdSchema.nullable(), headers: z.object({ replyTo: z.array(addressSchema), messageId: z.string().nullable(), references: z.array(z.string()) }).strict() }),
  "message.count": z.object({ indexed: z.number().int().nonnegative(), unread: z.number().int().nonnegative(), serverReported: z.number().nullable(), coverage: coverageSchema }).strict(),
  "message.update": batchSchema, "message.move": batchSchema, "message.delete": batchSchema, "message.restore": batchSchema,
  "search.start": job, "search.get": page(summarySchema).extend({ coverage: coverageSchema, canContinue: z.boolean() }), "search.resume": jobSchema, "search.cancel": jobSchema,
  "draft.list": page(draftSchema.omit({ html: true, text: true })), "draft.get": draftSchema, "draft.create": draftSchema, "draft.update": draftSchema, "draft.delete": ok,
  "attachment.import_local": assetSchema, "attachment.list": page(assetSchema), "attachment.get": assetSchema, "attachment.download_file": download, "attachment.delete": ok,
  "message.extract_to_file": download,
  "body.read_chunk": z.object({ bodyRef: assetIdSchema, html: z.string(), text: z.string(), nextCursor: z.string().nullable(), complete: z.boolean(), truncated: z.boolean() }).strict(),
  "send.preview": previewSchema, "message.send": receiptSchema, "operation.list": page(receiptSchema), "operation.get": receiptSchema,
  "cache.clear": z.object({ removed: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() }).strict(),
} as const
