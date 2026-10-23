import { createHash, randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import type { MailRecord } from "../../../electron/runtime/data-repo/schemas/mail"
import { MAIL_MAX_ATTACHMENT_BYTES, MAIL_PREVIEW_TTL_MS } from "../shared/limits"
import { MAIL_INPUT_SCHEMAS, previewSchema } from "../shared/schema"
import { MailError, type AccountConfig, type Draft, type MailAsset, type MailContext, type MailInputs, type MailPreview, type SendReceipt } from "../shared/types"
import { MailRepository } from "./repository"
import { MailAccounts, type StoredAccount } from "./accounts"
import { MailAssets } from "./assets"
import { MailDrafts, type StoredDraft } from "./drafts"
import { compileDraftMime } from "./mime-compose"
import { parseMailStream } from "./mime"
import { providerPolicy } from "./protocol/aliyun-policy"
import { normalizeProtocolError } from "./protocol/types"
import type { MailSendOperations } from "./send-reconcile"

export const mailHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex")
export const connectionFingerprint = (config: AccountConfig): string => mailHash(JSON.stringify([config.provider, config.email, config.imap, config.smtp, config.username ?? config.email, config.smtpUsername ?? config.username ?? config.email, config.sentPolicy]))
const operationId = (value: string): string => {
  const hex = mailHash(value)
  return `mo_${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
export interface SendSnapshot extends Record<string, unknown> {
  draft: Omit<Draft, "html" | "text">; bodyRef: string; rawAssetId: string; rawHash: string; rawSize: number;
  sentRawAssetId: string; sentRawHash: string; from: string; messageId: string; createdAt: string; expiresAt: string;
  envelope: string[]; attachments: MailAsset[]; fingerprint: string; accountFingerprint: string; serverSavesSent: boolean; signature: string
}
interface StoredPreview extends Record<string, unknown> { snapshot: SendSnapshot; pinnedAssetIds: string[]; expired: boolean }
export interface StoredSend extends Record<string, unknown> {
  kind: "send"; state: SendReceipt["state"]; receipt: SendReceipt; snapshot: SendSnapshot; pinnedAssetIds: string[];
  sentFolderId: string | null; sentCopyAttempt: "not_attempted" | "submitting" | "unknown" | "saved" | "failed";
  reconcileBeforeUid: number | null; reconcileHighUid: number | null
}
interface SendKey extends Record<string, unknown> { kind: "send-key"; operationId: string; signature: string }
export async function mimeFingerprint(ctx: MailContext, raw: Buffer): Promise<string> {
  const parsed = await parseMailStream(Readable.from([raw]), { signal: ctx.signal })
  const addresses = (values: typeof parsed.to) => values.map(a => [a.address.toLowerCase(), a.name ?? ""])
  return mailHash(JSON.stringify({ from: addresses(parsed.from), to: addresses(parsed.to), cc: addresses(parsed.cc), subject: parsed.subject, date: parsed.date, html: parsed.html, text: parsed.text, inReplyTo: parsed.inReplyTo, references: parsed.references, attachments: parsed.attachments.map(a => [a.sha256, a.size, a.mime.toLowerCase(), a.filename, a.cid]) }))
}
export class MailSend {
  constructor(private readonly repo: MailRepository, private readonly accounts: MailAccounts, private readonly assets: MailAssets, private readonly drafts: MailDrafts, private readonly operations: MailSendOperations) {}
  async preview(ctx: MailContext, input: MailInputs["send.preview"]): Promise<MailPreview> {
    const params = MAIL_INPUT_SCHEMAS["send.preview"].parse(input), initial = await this.drafts.get(ctx, params.draftId)
    return this.accounts.exclusive(ctx, initial.accountId, async () => {
      const stored = await this.drafts.stored(ctx, params.draftId), draft = await this.drafts.get(ctx, params.draftId)
      if (draft.revision !== params.expectedRevision) throw new MailError("VERSION_CONFLICT", "草稿已变化，请重新预览")
      if (draft.state !== "editing") throw new MailError(draft.state === "consumed" ? "DRAFT_CONSUMED" : "DRAFT_CONFLICT", "请从所选内容新建草稿副本")
      if (!stored.data.bodyRef) throw new MailError("ASSET_UNAVAILABLE", "草稿正文不可用")
      const config = (await this.repo.get<StoredAccount>(ctx, "accounts", draft.accountId)).data.config
      const envelope = [...new Set([...draft.to, ...draft.cc, ...draft.bcc].map(a => a.address))]
      if (!envelope.length) throw new MailError("NO_RECIPIENTS", "请填写收件人")
      const attachments = await Promise.all([...new Set([...draft.assetIds, ...draft.inlineImages.map(i => i.assetId)])].map(id => this.assets.info(ctx, id)))
      const from = config.email, messageId = `<${randomUUID()}@synapse.local>`, createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + MAIL_PREVIEW_TTL_MS).toISOString()
      const headers = { from, messageId, date: createdAt, inReplyTo: stored.data.headers.inReplyTo, references: stored.data.headers.references }
      const generated: string[] = [], added: string[] = []
      let committed = false
      try {
        const mime = await compileDraftMime(ctx, draft, this.assets, { ...headers, keepBcc: false })
        const raw = await this.assets.put(ctx, Readable.from([mime.raw]), { accountId: draft.accountId, name: "send-snapshot.eml", mime: "message/rfc822", pinned: true }, MAIL_MAX_ATTACHMENT_BYTES)
        generated.push(raw.id)
        const serverSavesSent = providerPolicy(config).serverSavesSent
        const sentRaw = serverSavesSent ? raw : await this.assets.put(ctx, Readable.from([(await compileDraftMime(ctx, draft, this.assets, { ...headers, keepBcc: true })).raw]), { accountId: draft.accountId, name: "sent-snapshot.eml", mime: "message/rfc822", pinned: true }, MAIL_MAX_ATTACHMENT_BYTES)
        if (sentRaw.id !== raw.id) generated.push(sentRaw.id)
        const accountFingerprint = connectionFingerprint(config)
        const signature = mailHash(JSON.stringify([draft.id, draft.revision, accountFingerprint, draft.to, draft.cc, draft.bcc, draft.subject, mailHash(JSON.stringify([draft.html, draft.text])), stored.data.headers, attachments.map(a => [a.id, a.sha256, a.size, a.mime, a.name]), draft.inlineImages]))
        const { html: _html, text: _text, ...metadata } = draft
        const snapshot: SendSnapshot = { draft: metadata, bodyRef: stored.data.bodyRef, rawAssetId: raw.id, rawHash: raw.sha256!, rawSize: raw.size, sentRawAssetId: sentRaw.id, sentRawHash: sentRaw.sha256!, from, envelope, messageId, createdAt, expiresAt, attachments, fingerprint: await mimeFingerprint(ctx, mime.raw), accountFingerprint, serverSavesSent, signature }
        const refs = [...new Set([stored.data.bodyRef, ...attachments.map(a => a.id), ...generated])]
        for (const id of refs) if (!generated.includes(id)) { await this.assets.pin(ctx, id, 1); added.push(id) }
        const previewId = `mp_${randomUUID()}`
        await this.repo.save<StoredPreview>(ctx, "previews", previewId, draft.accountId, { snapshot, pinnedAssetIds: refs, expired: false }, 0, createdAt)
        committed = true
        return previewSchema.parse({ previewId, expiresAt, from: { address: from }, draft, attachments, messageId })
      } catch (error) {
        if (!committed && !ctx.signal.aborted) for (const id of [...added, ...generated]) await this.assets.pin(ctx, id, -1)
        throw error
      }
    })
  }
  private async validateSnapshot(ctx: MailContext, snapshot: SendSnapshot): Promise<void> {
    if (Date.parse(snapshot.expiresAt) <= Date.now()) throw new MailError("PREVIEW_EXPIRED", "预览已过期，请重新预览")
    const draft = await this.drafts.stored(ctx, snapshot.draft.id)
    if (draft.data.contentRevision !== snapshot.draft.revision || draft.data.state !== "editing") throw new MailError("PREVIEW_STALE", "草稿已变化，请重新预览")
    const account = await this.accounts.get(ctx, draft.accountId)
    if (connectionFingerprint(account) !== snapshot.accountFingerprint || account.email !== snapshot.from) throw new MailError("PREVIEW_STALE", "邮箱配置已变化，请重新预览")
    for (const attachment of snapshot.attachments) {
      const current = await this.assets.info(ctx, attachment.id)
      if (current.accountId !== draft.accountId || current.state !== "ready" || current.sha256 !== attachment.sha256 || mailHash(await this.assets.read(ctx, current.id)) !== attachment.sha256) throw new MailError("ASSET_CHANGED", "附件已变化，请重新导入并预览")
    }
    if (mailHash(await this.assets.read(ctx, snapshot.rawAssetId)) !== snapshot.rawHash) throw new MailError("ASSET_CHANGED", "发送快照已变化，请重新预览")
  }
  private async outcome(ctx: MailContext, row: MailRecord<StoredSend>, receipt: SendReceipt): Promise<MailRecord<StoredSend>> {
    const data: StoredSend = { ...row.data, state: receipt.state, receipt }
    if (!["accepted", "partial"].includes(receipt.state)) return this.repo.save(ctx, "operations", row.id, row.accountId, data, row.revision, row.sortKey)
    const draft = await this.drafts.stored(ctx, row.data.snapshot.draft.id)
    if (draft.data.contentRevision !== row.data.snapshot.draft.revision) throw new MailError("VERSION_CONFLICT", "草稿修订已变化")
    const operation = { ...row, revision: row.revision + 1, data }, consumed = { ...draft, revision: draft.revision + 1, data: { ...draft.data, state: "consumed" } }
    const { id: _oid, ...opPatch } = operation, { id: _did, ...draftPatch } = consumed
    const committed = await this.repo.storage.commitBatch!({ guards: [{ namespace: "app.mail.operations", id: row.id, expected: { ownerId: ctx.ownerId, revision: row.revision } }, { namespace: "app.mail.drafts", id: draft.id, expected: { ownerId: ctx.ownerId, revision: draft.revision } }], operations: [{ kind: "patch", namespace: "app.mail.operations", id: row.id, patch: opPatch }, { kind: "patch", namespace: "app.mail.drafts", id: draft.id, patch: draftPatch }] })
    this.accounts.context.assertCurrent(ctx)
    if (!committed.committed) throw new MailError("VERSION_CONFLICT", "发送结果保存冲突，请先核验操作")
    this.drafts.notify(ctx, draft.id)
    return operation
  }
  async submit(ctx: MailContext, input: MailInputs["message.send"]): Promise<SendReceipt> {
    const params = MAIL_INPUT_SCHEMAS["message.send"].parse(input), preview = await this.repo.get<StoredPreview>(ctx, "previews", params.previewId)
    return this.accounts.exclusive(ctx, preview.accountId, async () => {
      const snapshot = preview.data.snapshot, id = operationId(`send:${ctx.ownerId}:${preview.accountId}:${snapshot.draft.id}:${snapshot.draft.revision}`), keyId = `request:${mailHash(`${ctx.ownerId}:${preview.accountId}:${params.clientRequestId}`)}`
      const key = await this.repo.find<SendKey>(ctx, "operations", keyId)
      if (key && (key.data.kind !== "send-key" || key.data.signature !== snapshot.signature)) throw new MailError("IDEMPOTENCY_CONFLICT", "此请求标识已用于其他邮件内容")
      let operation = await this.repo.find<StoredSend>(ctx, "operations", key?.data.operationId ?? id)
      if (operation && (operation.data.kind !== "send" || operation.data.snapshot.signature !== snapshot.signature)) throw new MailError("IDEMPOTENCY_CONFLICT", "此草稿修订已有不同的发送快照")
      if (operation && operation.data.state !== "prepared") {
        if (!key) {
          const draft = await this.drafts.stored(ctx, snapshot.draft.id)
          if (draft.data.contentRevision !== snapshot.draft.revision) throw new MailError("PREVIEW_STALE", "草稿已变化，请重新预览")
          await this.repo.save<SendKey>(ctx, "operations", keyId, preview.accountId, { kind: "send-key", operationId: operation.id, signature: snapshot.signature }, 0)
        }
        if (operation.data.state === "submitting") operation = await this.outcome(ctx, operation, { ...operation.data.receipt, state: "unknown", errorCode: "INTERRUPTED", retryStage: "reconcile" })
        return this.operations.finishSentCopyLocked(ctx, operation.id)
      }
      await this.validateSnapshot(ctx, snapshot)
      if (!operation) {
        const refs = [...new Set([snapshot.bodyRef, snapshot.rawAssetId, snapshot.sentRawAssetId, ...snapshot.attachments.map(a => a.id)])]
        const added: string[] = []
        try {
          for (const ref of refs) { await this.assets.pin(ctx, ref, 1); added.push(ref) }
          const receipt: SendReceipt = { operationId: id, accountId: preview.accountId, state: "prepared", accepted: [], rejected: [], messageId: snapshot.messageId, sentCopyState: "pending", retryStage: "none", errorCode: null }
          operation = await this.repo.save<StoredSend>(ctx, "operations", id, preview.accountId, { kind: "send", state: "prepared", receipt, snapshot, pinnedAssetIds: refs, sentFolderId: null, sentCopyAttempt: "not_attempted", reconcileBeforeUid: null, reconcileHighUid: null }, 0, snapshot.createdAt)
        } catch (error) { if (!ctx.signal.aborted) for (const ref of added) await this.assets.pin(ctx, ref, -1); throw error }
      }
      if (!key) await this.repo.save<SendKey>(ctx, "operations", keyId, preview.accountId, { kind: "send-key", operationId: operation.id, signature: snapshot.signature }, 0)
      operation = await this.outcome(ctx, operation, { ...operation.data.receipt, state: "submitting" })
      let smtp: Awaited<ReturnType<typeof this.accounts.protocols.smtp>> | undefined
      try {
        const { config, credential } = await this.accounts.credential(ctx, preview.accountId)
        smtp = await this.accounts.protocols.smtp(ctx, config, credential)
        const response = await smtp.submit({ raw: await this.assets.read(ctx, snapshot.rawAssetId), from: snapshot.from, to: snapshot.envelope, messageId: snapshot.messageId }, ctx.signal)
        const unique = (values: string[]) => [...new Map(values.map(value => [value.toLowerCase(), value])).values()]
        const accepted = unique(response.accepted), rejected = unique(response.rejected), envelope = new Set(snapshot.envelope.map(a => a.toLowerCase()))
        const a = new Set(accepted.map(a => a.toLowerCase())), r = new Set(rejected.map(a => a.toLowerCase()))
        const complete = [...a, ...r].every(value => envelope.has(value)) && [...a].every(value => !r.has(value)) && a.size + r.size === envelope.size
        const state: SendReceipt["state"] = !complete ? "unknown" : accepted.length && rejected.length ? "partial" : accepted.length ? "accepted" : "failed"
        operation = await this.outcome(ctx, operation, { ...operation.data.receipt, state, accepted, rejected, sentCopyState: state === "failed" ? "failed" : "pending", retryStage: state === "unknown" || state === "accepted" || state === "partial" ? "reconcile" : "none", errorCode: !complete ? "INCOMPLETE_SMTP_RECEIPT" : state === "failed" ? "RECIPIENTS_REJECTED" : null })
      } catch (error) {
        if (ctx.signal.aborted) throw error
        const normalized = normalizeProtocolError(error), code = normalized.code
        if (code === "AUTH_FAILED") {
          const account = await this.repo.get<StoredAccount>(ctx, "accounts", preview.accountId)
          await this.repo.save(ctx, "accounts", account.id, account.id, { ...account.data, state: "auth_failed", errorCode: code }, account.revision)
        }
        const definitelyNotSubmitted = normalized.details?.definitelyNotSubmitted === true || ["AUTH_FAILED", "PERMISSION_DENIED", "CONNECTION_CHECK_REQUIRED", "ACCOUNT_REINDEX_REQUIRED"].includes(code)
        const latest = await this.repo.get<StoredSend>(ctx, "operations", operation.id)
        if (["accepted", "partial"].includes(latest.data.state)) return latest.data.receipt
        operation = await this.outcome(ctx, latest, { ...latest.data.receipt, state: definitelyNotSubmitted ? "failed" : "unknown", sentCopyState: definitelyNotSubmitted ? "failed" : "unknown", retryStage: definitelyNotSubmitted ? "none" : "reconcile", errorCode: code })
      } finally { smtp?.close() }
      return this.operations.finishSentCopyLocked(ctx, operation.id)
    })
  }
  async expire(ctx: MailContext, cursor?: string): Promise<{ nextCursor: string | null }> {
    const page = await this.repo.page<StoredPreview>(ctx, "previews", { cursor, limit: 100 })
    for (const row of page.items) if (!row.data.expired && Date.parse(row.data.snapshot.expiresAt) <= Date.now()) await this.accounts.exclusive(ctx, row.accountId, async () => {
      const current = await this.repo.get<StoredPreview>(ctx, "previews", row.id)
      if (current.data.expired) return
      await this.repo.save(ctx, "previews", row.id, row.accountId, { ...current.data, expired: true, pinnedAssetIds: [] }, current.revision, current.sortKey)
      for (const id of current.data.pinnedAssetIds) await this.assets.pin(ctx, id, -1)
    })
    return { nextCursor: page.nextCursor }
  }
}
