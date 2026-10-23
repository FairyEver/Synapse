import { createHash, randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import type { MailRecord } from "../../../electron/runtime/data-repo/schemas/mail"
import { MAIL_MAX_ATTACHMENT_BYTES } from "../shared/limits"
import { MailError, type DraftSyncResult, type MailContext, type MessageLocator } from "../shared/types"
import { MailRepository } from "./repository"
import { MailAccounts, type StoredAccount } from "./accounts"
import { MailAssets } from "./assets"
import { MailDrafts, type DraftAppend, type StoredDraft } from "./drafts"
import { compileDraftMime } from "./mime-compose"
import { assertRemoteGeneration, type StoredFolder } from "./sync"
import { normalizeProtocolError, type MailImapSession } from "./protocol/types"

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
const result = (row: MailRecord<StoredDraft>): DraftSyncResult => ({ draftId: row.id, syncState: row.data.syncState, remoteLocator: row.data.remoteLocator })
export class MailDraftSync {
  private running = new Map<string, Promise<void>>()
  private controllers = new Map<string, AbortController>()
  private requested = new Map<string, MailContext>()
  constructor(private readonly repo: MailRepository, private readonly accounts: MailAccounts, private readonly assets: MailAssets, private readonly drafts: MailDrafts, private readonly onError: (code: string, id: string) => void = () => undefined) {}
  enqueue(ctx: MailContext, id: string): void {
    if (this.running.has(id)) { this.requested.set(id, ctx); return }
    const controller = new AbortController(); this.controllers.set(id, controller)
    ctx = { ...ctx, signal: AbortSignal.any([ctx.signal, controller.signal]) }
    const task = Promise.resolve().then(() => this.sync(ctx, id)).then(async result => {
      if (result.syncState === "pending" && !ctx.signal.aborted) {
        const draft = await this.drafts.stored(ctx, id), account = await this.accounts.get(ctx, draft.accountId)
        if (!account.paused && account.state === "connected") this.requested.set(id, ctx)
      }
    }).catch(error => { if (!ctx.signal.aborted) this.onError(normalizeProtocolError(error).code, id) }).finally(() => {
      this.running.delete(id); this.controllers.delete(id)
      const next = this.requested.get(id); this.requested.delete(id)
      if (next && !next.signal.aborted) this.enqueue(next, id)
    })
    this.running.set(id, task)
  }
  async stopAccount(ctx: MailContext, accountId: string): Promise<void> {
    for (const [id, controller] of this.controllers) {
      const row = await this.repo.find<StoredDraft>(ctx, "drafts", id)
      if (row?.accountId === accountId) { this.requested.delete(id); controller.abort() }
    }
  }
  async dispose(): Promise<void> { this.requested.clear(); for (const c of this.controllers.values()) c.abort(); await this.settle() }
  async settle(): Promise<void> { while (this.running.size) await Promise.all(this.running.values()) }
  private async update(ctx: MailContext, id: string, patch: Partial<StoredDraft>): Promise<MailRecord<StoredDraft>> {
    const row = await this.drafts.stored(ctx, id)
    const saved = await this.repo.save(ctx, "drafts", id, row.accountId, { ...row.data, ...patch }, row.revision, row.sortKey)
    this.drafts.notify(ctx, id)
    return saved
  }
  private async folder(ctx: MailContext, accountId: string, id?: string): Promise<StoredFolder> {
    if (id) {
      const row = await this.repo.get<StoredFolder>(ctx, "folders", id)
      if (row.accountId !== accountId) throw new MailError("UNAVAILABLE", "草稿文件夹不可用")
      return row.data
    }
    let cursor: string | undefined
    const matches: StoredFolder[] = []
    do {
      const page = await this.repo.page<StoredFolder>(ctx, "folders", { accountId, cursor, limit: 100 })
      matches.push(...page.items.filter(r => r.data.folder.role === "drafts" && r.data.folder.selectable).map(r => r.data)); cursor = page.nextCursor ?? undefined
    } while (cursor)
    if (matches.length !== 1) throw new MailError("ROLE_MAPPING_REQUIRED", "请先配置草稿文件夹映射")
    return matches[0]
  }
  private async original(ctx: MailContext, session: MailImapSession, locator: MessageLocator): Promise<Buffer | null> {
    const folder = await this.folder(ctx, locator.accountId, locator.folderId)
    const selected = await session.select(folder.folder.path, ctx.signal)
    await assertRemoteGeneration(this.repo, ctx, locator.folderId, locator.uidValidity, selected.uidValidity)
    if (!(await session.searchUids(folder.folder.path, { uid: String(locator.uid) }, ctx.signal)).includes(locator.uid)) return null
    const stream = await session.fetchPart(folder.folder.path, locator.uid, undefined, ctx.signal, MAIL_MAX_ATTACHMENT_BYTES)
    const chunks: Buffer[] = []; let size = 0
    try {
      for await (const chunk of stream) {
        ctx.signal.throwIfAborted(); const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length
        if (size > MAIL_MAX_ATTACHMENT_BYTES) throw new MailError("LIMIT_EXCEEDED", "远端草稿超过大小上限")
        chunks.push(bytes)
      }
    } finally { stream.destroy() }
    return Buffer.concat(chunks, size)
  }
  private async conflict(ctx: MailContext, row: MailRecord<StoredDraft>, raw: Buffer | null): Promise<MailRecord<StoredDraft>> {
    if (raw && row.data.remoteLocator) await this.drafts.importRemoteLocked(ctx, { accountId: row.accountId, locator: row.data.remoteLocator, raw, conflict: true })
    return this.update(ctx, row.id, { state: "conflict", syncState: "conflict" })
  }
  private async reconcile(ctx: MailContext, session: MailImapSession, row: MailRecord<StoredDraft>, folder: StoredFolder, attempt: DraftAppend): Promise<MessageLocator | null> {
    const selected = await session.select(folder.folder.path, ctx.signal)
    const uids = (await session.searchUids(folder.folder.path, { all: true }, ctx.signal)).sort((a, b) => b - a).slice(0, 1000)
    const candidates: number[] = []
    for (let offset = 0; offset < uids.length; offset += 100) {
      const headers = await session.fetchHeaders(folder.folder.path, uids.slice(offset, offset + 100), ctx.signal)
      candidates.push(...headers.filter(header => header.messageId === attempt.messageId).map(header => header.uid))
    }
    if (candidates.length !== 1) return null
    const locator = { accountId: row.accountId, folderId: folder.folder.id, uidValidity: selected.uidValidity, uid: candidates[0] }
    const bytes = await this.original(ctx, session, locator)
    return bytes && hash(bytes) === attempt.rawHash ? locator : null
  }
  private async deleteExact(ctx: MailContext, session: MailImapSession, locator: MessageLocator, expectedHash: string | null): Promise<void> {
    const bytes = await this.original(ctx, session, locator)
    if (!bytes) return
    if (!expectedHash || hash(bytes) !== expectedHash) throw new MailError("DRAFT_CONFLICT", "远端草稿已变化，未删除任何新版本")
    if (!session.capabilities.has("UIDPLUS")) throw new MailError("UNSUPPORTED", "服务端不支持精确删除旧草稿")
    const folder = await this.folder(ctx, locator.accountId, locator.folderId)
    await session.storeFlags(folder.folder.path, [locator.uid], ["\\Deleted"], true, ctx.signal)
    await session.uidExpunge(folder.folder.path, [locator.uid], ctx.signal)
    if ((await session.searchUids(folder.folder.path, { uid: String(locator.uid) }, ctx.signal)).includes(locator.uid)) throw new MailError("DELETE_UNCONFIRMED", "旧草稿删除结果待核验")
  }
  async sync(ctx: MailContext, draftId: string): Promise<DraftSyncResult> {
    const snapshot = await this.drafts.get(ctx, draftId)
    return this.accounts.exclusive(ctx, snapshot.accountId, async () => {
      let row = await this.drafts.stored(ctx, draftId), session: MailImapSession | undefined
      if (row.data.state !== "editing" || !row.data.localSaved || row.data.syncState === "synced" && !row.data.pendingAppend) return result(row)
      if ((await this.accounts.get(ctx, row.accountId)).paused) return result(row)
      try {
        const { config, credential } = await this.accounts.credential(ctx, row.accountId)
        session = await this.accounts.protocols.imap(ctx, config, credential)
        const folder = await this.folder(ctx, row.accountId, row.data.pendingAppend?.targetFolderId)
        const selected = await session.select(folder.folder.path, ctx.signal)
        if (row.data.pendingAppend) await assertRemoteGeneration(this.repo, ctx, folder.folder.id, row.data.pendingAppend.targetUidValidity, selected.uidValidity)
        let attempt = row.data.pendingAppend
        if (attempt?.state === "prepared" && attempt.draftRevision !== row.data.contentRevision) {
          const rawId = attempt.rawAssetId
          row = await this.update(ctx, draftId, { pendingAppend: null, pinnedAssetIds: row.data.pinnedAssetIds.filter(id => id !== rawId) })
          await this.assets.pin(ctx, rawId, -1); attempt = null
        }
        if (!attempt) {
          if (row.data.remoteLocator) {
            const original = await this.original(ctx, session, row.data.remoteLocator)
            if (!original || !row.data.remoteHash || hash(original) !== row.data.remoteHash) return result(await this.conflict(ctx, row, original))
          }
          const draft = await this.drafts.get(ctx, draftId), messageId = `<${randomUUID()}@synapse.local>`
          const mime = await compileDraftMime(ctx, draft, this.assets, { from: config.email, date: draft.updatedAt, messageId, inReplyTo: row.data.headers.inReplyTo, references: row.data.headers.references, keepBcc: true })
          const raw = await this.assets.put(ctx, Readable.from([mime.raw]), { accountId: row.accountId, name: "draft.eml", mime: "message/rfc822", pinned: true }, MAIL_MAX_ATTACHMENT_BYTES)
          attempt = { draftRevision: row.data.contentRevision, messageId, rawAssetId: raw.id, rawHash: raw.sha256!, targetFolderId: folder.folder.id, targetUidValidity: selected.uidValidity, state: "prepared", newLocator: null, oldLocator: row.data.remoteLocator, oldHash: row.data.remoteHash }
          row = await this.update(ctx, draftId, { pendingAppend: attempt, pinnedAssetIds: [...new Set([...row.data.pinnedAssetIds, raw.id])], syncState: "pending" })
        }
        if (attempt.state === "submitting" || attempt.state === "unknown") {
          const locator = await this.reconcile(ctx, session, row, folder, attempt)
          if (!locator) return result(await this.update(ctx, draftId, { syncState: "unknown", pendingAppend: { ...attempt, state: "unknown" } }))
          attempt = { ...attempt, state: "accepted", newLocator: locator }
          row = await this.update(ctx, draftId, { pendingAppend: attempt })
        }
        if (attempt.state === "prepared") {
          const raw = await this.assets.read(ctx, attempt.rawAssetId)
          if (hash(raw) !== attempt.rawHash) throw new MailError("ASSET_CHANGED", "草稿快照已变化")
          attempt = { ...attempt, state: "submitting" }
          row = await this.update(ctx, draftId, { pendingAppend: attempt })
          const receipt = await session.append(folder.folder.path, raw, ["\\Draft", "\\Seen"], ctx.signal)
          if (!receipt || receipt.uidValidity !== selected.uidValidity) return result(await this.update(ctx, draftId, { pendingAppend: { ...attempt, state: "unknown" }, syncState: "unknown" }))
          attempt = { ...attempt, state: "accepted", newLocator: { accountId: row.accountId, folderId: folder.folder.id, uidValidity: receipt.uidValidity, uid: receipt.uid } }
          row = await this.update(ctx, draftId, { pendingAppend: attempt })
        }
        if (!attempt.newLocator) throw new MailError("OPERATION_UNKNOWN", "草稿位置待核验")
        const check = await session.select(folder.folder.path, ctx.signal)
        await assertRemoteGeneration(this.repo, ctx, folder.folder.id, attempt.newLocator.uidValidity, check.uidValidity)
        if (attempt.oldLocator) await this.deleteExact(ctx, session, attempt.oldLocator, attempt.oldHash)
        const refs = row.data.pinnedAssetIds.filter(id => id !== attempt!.rawAssetId)
        row = await this.update(ctx, draftId, { remoteLocator: attempt.newLocator, remoteHash: attempt.rawHash, remoteSourceId: null, pendingAppend: null, pinnedAssetIds: refs, syncState: row.data.contentRevision === attempt.draftRevision ? "synced" : "pending" })
        await this.assets.pin(ctx, attempt.rawAssetId, -1)
        return result(row)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        row = await this.drafts.stored(ctx, draftId)
        const code = normalizeProtocolError(error).code
        if (code === "AUTH_FAILED") {
          const account = await this.repo.get<StoredAccount>(ctx, "accounts", row.accountId)
          await this.repo.save(ctx, "accounts", account.id, account.id, { ...account.data, state: "auth_failed", errorCode: code }, account.revision)
        }
        if (code === "DRAFT_CONFLICT" || code === "STALE_TARGET") return result(await this.update(ctx, draftId, { state: "conflict", syncState: "conflict" }))
        const attempt = row.data.pendingAppend
        const unknown = !!attempt && attempt.state !== "prepared"
        row = await this.update(ctx, draftId, { syncState: unknown ? "unknown" : "failed", ...(attempt?.state === "submitting" ? { pendingAppend: { ...attempt, state: "unknown" } } : {}) })
        this.onError(code, draftId)
        return result(row)
      } finally { await session?.close() }
    })
  }
  /** Called by draft deletion under the account queue; never appends or sends. */
  async removeRemote(ctx: MailContext, row: MailRecord<StoredDraft>): Promise<void> {
    if (row.data.pendingAppend && ["unknown", "submitting"].includes(row.data.pendingAppend.state)) throw new MailError("OPERATION_UNKNOWN", "请先核验远端草稿位置")
    const { config, credential } = await this.accounts.credential(ctx, row.accountId), session = await this.accounts.protocols.imap(ctx, config, credential)
    try {
      if (row.data.pendingAppend?.newLocator) await this.deleteExact(ctx, session, row.data.pendingAppend.newLocator, row.data.pendingAppend.rawHash)
      if (row.data.remoteLocator) await this.deleteExact(ctx, session, row.data.remoteLocator, row.data.remoteHash)
    } finally { await session.close() }
  }
}
