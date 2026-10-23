import type { MailRecord } from "../../../electron/runtime/data-repo/schemas/mail"
import { MAIL_MAX_ATTACHMENT_BYTES } from "../shared/limits"
import { MAIL_INPUT_SCHEMAS, receiptSchema } from "../shared/schema"
import { MailError, type MailContext, type MailInputs, type MailResults, type SendReceipt } from "../shared/types"
import { MailRepository } from "./repository"
import { MailAccounts } from "./accounts"
import { MailAssets } from "./assets"
import { MailDrafts, type StoredDraft } from "./drafts"
import { connectionFingerprint, mailHash, mimeFingerprint, type StoredSend } from "./send"
import { normalizeProtocolError, type MailImapSession } from "./protocol/types"
import type { StoredFolder } from "./sync"

export class MailSendOperations {
  constructor(private readonly repo: MailRepository, private readonly accounts: MailAccounts, private readonly assets: MailAssets, private readonly drafts: MailDrafts) {}
  private async stored(ctx: MailContext, id: string): Promise<MailRecord<StoredSend>> {
    const row = await this.repo.get<StoredSend>(ctx, "operations", id)
    if (row.data.kind !== "send") throw new MailError("UNAVAILABLE", "发送操作不存在")
    return row
  }
  private async save(ctx: MailContext, id: string, patch: Partial<StoredSend>, receiptPatch: Partial<SendReceipt>): Promise<MailRecord<StoredSend>> {
    const row = await this.stored(ctx, id), receipt = receiptSchema.parse({ ...row.data.receipt, ...receiptPatch })
    return this.repo.save(ctx, "operations", id, row.accountId, { ...row.data, ...patch, state: receipt.state, receipt }, row.revision, row.sortKey)
  }
  private async sentFolder(ctx: MailContext, accountId: string, preferred: string | null): Promise<StoredFolder> {
    if (preferred) {
      const row = await this.repo.find<StoredFolder>(ctx, "folders", preferred)
      if (row && row.accountId === accountId && row.data.folder.selectable) return row.data
    }
    let cursor: string | undefined
    const folders: StoredFolder[] = []
    do {
      const page = await this.repo.page<StoredFolder>(ctx, "folders", { accountId, cursor, limit: 100 })
      folders.push(...page.items.filter(r => r.data.folder.role === "sent" && r.data.folder.selectable).map(r => r.data)); cursor = page.nextCursor ?? undefined
    } while (cursor)
    if (folders.length !== 1) throw new MailError("ROLE_MAPPING_REQUIRED", "请先配置已发送文件夹映射")
    return folders[0]
  }
  /** Mutating copy repair is reachable only from the confirmed send action, under its account queue. */
  async finishSentCopyLocked(ctx: MailContext, id: string): Promise<SendReceipt> {
    let row = await this.stored(ctx, id)
    if (!["accepted", "partial"].includes(row.data.state) || row.data.receipt.sentCopyState === "saved") return row.data.receipt
    if (row.data.snapshot.serverSavesSent) return (await this.save(ctx, id, {}, { retryStage: "reconcile" })).data.receipt
    if (["unknown", "submitting"].includes(row.data.sentCopyAttempt)) return (await this.save(ctx, id, { sentCopyAttempt: "unknown" }, { sentCopyState: "unknown", retryStage: "reconcile" })).data.receipt
    let session: MailImapSession | undefined, appendStarted = false
    try {
      const { config, credential } = await this.accounts.credential(ctx, row.accountId)
      if (connectionFingerprint(config) !== row.data.snapshot.accountFingerprint) throw new MailError("ACCOUNT_CHANGED", "邮箱配置已变化，未写入其他服务器")
      const folder = await this.sentFolder(ctx, row.accountId, row.data.sentFolderId)
      const raw = await this.assets.read(ctx, row.data.snapshot.sentRawAssetId)
      if (mailHash(raw) !== row.data.snapshot.sentRawHash) throw new MailError("ASSET_CHANGED", "已发送副本快照已变化")
      session = await this.accounts.protocols.imap(ctx, config, credential)
      const selected = await session.select(folder.folder.path, ctx.signal)
      row = await this.save(ctx, id, { sentFolderId: folder.folder.id, sentCopyAttempt: "submitting" }, { sentCopyState: "pending", retryStage: "reconcile" })
      appendStarted = true
      const appended = await session.append(folder.folder.path, raw, ["\\Seen"], ctx.signal)
      return (await this.save(ctx, id, { sentCopyAttempt: appended?.uidValidity === selected.uidValidity ? "saved" : "unknown" }, { sentCopyState: appended?.uidValidity === selected.uidValidity ? "saved" : "unknown", retryStage: appended?.uidValidity === selected.uidValidity ? "none" : "reconcile", errorCode: appended?.uidValidity === selected.uidValidity ? null : "SENT_COPY_UNKNOWN" })).data.receipt
    } catch (error) {
      if (ctx.signal.aborted) throw error
      const normalized = normalizeProtocolError(error), knownFailure = !appendStarted || normalized.details?.definitelyNotSubmitted === true
      return (await this.save(ctx, id, { sentCopyAttempt: knownFailure ? "failed" : "unknown" }, { sentCopyState: knownFailure ? "failed" : "unknown", retryStage: knownFailure ? "sent-copy" : "reconcile", errorCode: normalized.code })).data.receipt
    } finally { await session?.close() }
  }
  private async reconcileLocked(ctx: MailContext, id: string): Promise<SendReceipt> {
    let row = await this.stored(ctx, id)
    if (row.data.state === "submitting") row = await this.save(ctx, id, {}, { state: "unknown", retryStage: "reconcile", errorCode: "INTERRUPTED" })
    if (!["accepted", "partial", "unknown"].includes(row.data.state) || row.data.receipt.sentCopyState === "saved") return row.data.receipt
    let session: MailImapSession | undefined
    try {
      const { config, credential } = await this.accounts.credential(ctx, row.accountId)
      if (connectionFingerprint(config) !== row.data.snapshot.accountFingerprint) throw new MailError("ACCOUNT_CHANGED", "邮箱配置已变化，未查询其他服务器")
      const folder = await this.sentFolder(ctx, row.accountId, row.data.sentFolderId)
      session = await this.accounts.protocols.imap(ctx, config, credential)
      const mailbox = await session.select(folder.folder.path, ctx.signal)
      const allUids = (await session.searchUids(folder.folder.path, { all: true }, ctx.signal)).sort((a, b) => b - a)
      const high = allUids[0] ?? 0, before = high > (row.data.reconcileHighUid ?? 0) ? null : row.data.reconcileBeforeUid
      const uids = allUids.filter(uid => before === null || uid < before).slice(0, 100)
      const headers = uids.length ? await session.fetchHeaders(folder.folder.path, uids, ctx.signal) : []
      const snapshot = row.data.snapshot, expectedDate = Date.parse(snapshot.createdAt)
      const candidates = headers.filter(header => header.messageId === snapshot.messageId && header.subject === snapshot.draft.subject && header.from.some(a => a.address.toLowerCase() === snapshot.from.toLowerCase()) && header.date !== null && Math.abs(Date.parse(header.date) - expectedDate) <= 5 * 60_000 && Math.abs(header.size - snapshot.rawSize) <= 64 * 1024)
      row = await this.save(ctx, id, { sentFolderId: folder.folder.id, reconcileHighUid: high, reconcileBeforeUid: uids.length === 100 ? uids.at(-1)! : null }, {})
      if (candidates.length !== 1 || candidates[0].size > MAIL_MAX_ATTACHMENT_BYTES) return row.data.receipt
      const stream = await session.fetchPart(folder.folder.path, candidates[0].uid, undefined, ctx.signal, MAIL_MAX_ATTACHMENT_BYTES)
      const chunks: Buffer[] = []; let bytes = 0
      try {
        for await (const chunk of stream) {
          ctx.signal.throwIfAborted(); const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += buffer.length
          if (bytes > MAIL_MAX_ATTACHMENT_BYTES) throw new MailError("LIMIT_EXCEEDED", "已发送副本超过核验上限")
          chunks.push(buffer)
        }
      } finally { stream.destroy() }
      const check = await session.select(folder.folder.path, ctx.signal)
      if (check.uidValidity !== mailbox.uidValidity || await mimeFingerprint(ctx, Buffer.concat(chunks, bytes)) !== snapshot.fingerprint) return row.data.receipt
      // A copy proves archived content, not the missing per-recipient RCPT outcome.
      return (await this.save(ctx, id, { sentCopyAttempt: "saved" }, { sentCopyState: "saved", retryStage: row.data.state === "unknown" ? "reconcile" : "none", errorCode: row.data.state === "unknown" ? "RECIPIENT_OUTCOME_UNKNOWN" : null })).data.receipt
    } catch (error) {
      if (ctx.signal.aborted) throw error
      return (await this.save(ctx, id, {}, { errorCode: normalizeProtocolError(error).code })).data.receipt
    } finally { await session?.close() }
  }
  async get(ctx: MailContext, input: MailInputs["operation.get"]): Promise<SendReceipt> {
    const params = MAIL_INPUT_SCHEMAS["operation.get"].parse(input), row = await this.stored(ctx, params.operationId)
    return this.accounts.exclusive(ctx, row.accountId, () => this.reconcileLocked(ctx, row.id))
  }
  async list(ctx: MailContext, input: MailInputs["operation.list"]): Promise<MailResults["operation.list"]> {
    const params = MAIL_INPUT_SCHEMAS["operation.list"].parse(input)
    await this.repo.get(ctx, "accounts", params.accountId)
    const items: SendReceipt[] = []; let cursor = params.cursor
    do {
      const page = await this.repo.page<StoredSend>(ctx, "operations", { accountId: params.accountId, cursor, limit: params.limit - items.length, binding: params.state ?? "all-sends" })
      for (const row of page.items) if (row.data.kind === "send" && (!params.state || row.data.state === params.state)) items.push(receiptSchema.parse(row.data.receipt))
      cursor = page.nextCursor ?? undefined; if (!cursor) break
    } while (items.length < params.limit)
    return { items, nextCursor: cursor ?? null }
  }
  async recover(ctx: MailContext): Promise<void> {
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredSend>(ctx, "operations", { cursor, limit: 100 })
      for (const record of page.items) if (record.data.kind === "send") await this.accounts.exclusive(ctx, record.accountId, async () => {
        let row = await this.stored(ctx, record.id)
        if (row.data.state === "submitting") row = await this.save(ctx, row.id, {}, { state: "unknown", retryStage: "reconcile", errorCode: "INTERRUPTED" })
        if (row.data.sentCopyAttempt === "submitting") row = await this.save(ctx, row.id, { sentCopyAttempt: "unknown" }, { sentCopyState: "unknown", retryStage: "reconcile" })
        if (["accepted", "partial"].includes(row.data.state)) {
          const draft = await this.repo.find<StoredDraft>(ctx, "drafts", row.data.snapshot.draft.id)
          if (draft && draft.data.contentRevision === row.data.snapshot.draft.revision && draft.data.state !== "consumed") await this.repo.save(ctx, "drafts", draft.id, draft.accountId, { ...draft.data, state: "consumed" }, draft.revision, draft.sortKey)
        }
      })
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }
}
