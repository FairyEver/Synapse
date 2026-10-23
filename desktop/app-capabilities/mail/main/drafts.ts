import { createHash, randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import type { MailRecord } from "../../../electron/runtime/data-repo/schemas/mail"
import { MAIL_MAX_BODY_BYTES, MAIL_MAX_IMAGE_BYTES } from "../shared/limits"
import { draftInputSchema, draftSchema, MAIL_INPUT_SCHEMAS } from "../shared/schema"
import { draftCommitSchema, type DraftCommit } from "../shared/private-schema"
import { MailError, type Address, type Draft, type DraftAction, type DraftInput, type MailContext, type MailInputs, type MailResults, type MessageLocator } from "../shared/types"
import { MailRepository } from "./repository"
import { MailAccounts, type StoredAccount } from "./accounts"
import { MailAssets, type StoredMailAsset } from "./assets"
import { MailContent, parseMailStream } from "./mime"
import { rasterMime } from "./body-resources"
import { resolveMessage, type StoredFolder, type StoredMessage } from "./sync"

export interface DraftAppend {
  draftRevision: number; messageId: string; rawAssetId: string; rawHash: string;
  targetFolderId: string; targetUidValidity: string;
  state: "prepared" | "submitting" | "unknown" | "accepted"; newLocator: MessageLocator | null; oldLocator: MessageLocator | null; oldHash: string | null
}
export interface StoredDraft extends Omit<Draft, "id" | "revision" | "html" | "text">, Record<string, unknown> {
  contentRevision: number; bodyRef: string | null; pinnedAssetIds: string[]; remoteHash: string | null; remoteSourceId: string | null;
  headers: { inReplyTo: string | null; references: string[] }; pendingAppend: DraftAppend | null
}
type DraftHooks = { schedule?: (ctx: MailContext, draftId: string) => void; changed?: (ctx: MailContext, draftId: string) => void; removeRemote?: (ctx: MailContext, draft: MailRecord<StoredDraft>) => Promise<void> }
const validId = (id: string | null): id is string => !!id && /^<[^<>\s\x00-\x1f]{1,900}>$/u.test(id)
const safeRefs = (refs: string[]) => [...new Set(refs.filter(validId))].slice(-100)
const escape = (text: string) => text.replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)
const sortKey = () => String(9_999_999_999_999 - Date.now()).padStart(13, "0")
const remoteDraftId = (source: string) => {
  const hash = createHash("sha256").update(source).digest("hex")
  return `md_${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
const sameLocator = (a: MessageLocator | null, b: MessageLocator) => a?.accountId === b.accountId && a.folderId === b.folderId && a.uidValidity === b.uidValidity && a.uid === b.uid

export class MailDrafts {
  constructor(private readonly repo: MailRepository, private readonly accounts: MailAccounts, private readonly assets: MailAssets, private readonly content: MailContent, private readonly hooks: DraftHooks = {}) {}
  stored(ctx: MailContext, id: string): Promise<MailRecord<StoredDraft>> { return this.repo.get(ctx, "drafts", id) }
  notify(ctx: MailContext, id: string): void { this.accounts.context.assertCurrent(ctx); this.hooks.changed?.(ctx, id) }
  private metadata(row: MailRecord<StoredDraft>, body = { html: "", text: "" }): Draft {
    const d = row.data
    return draftSchema.parse({ id: row.id, revision: d.contentRevision, accountId: row.accountId, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, ...body, assetIds: d.assetIds, inlineImages: d.inlineImages, state: d.state, sourceMessageId: d.sourceMessageId, mode: d.mode, remoteLocator: d.remoteLocator, localSaved: d.localSaved, syncState: d.syncState, updatedAt: d.updatedAt })
  }
  async get(ctx: MailContext, id: string): Promise<Draft> {
    let row = await this.stored(ctx, id)
    if (!row.data.bodyRef && row.data.remoteSourceId) {
      const raw = await this.content.emlAsset(ctx, row.data.remoteSourceId)
      const bytes = await this.assets.read(ctx, raw.id)
      await this.accounts.exclusive(ctx, row.accountId, async () => {
        const current = await this.stored(ctx, id)
        if (current.data.bodyRef) return
        if (current.revision !== row.revision) throw new MailError("VERSION_CONFLICT", "草稿状态已变化")
        await this.importRemoteLocked(ctx, { accountId: row.accountId, locator: row.data.remoteLocator!, raw: bytes, id, previous: current, sourceId: row.data.remoteSourceId })
      })
      row = await this.stored(ctx, id)
    }
    if (!row.data.bodyRef) return this.metadata(row)
    const body = JSON.parse((await this.assets.read(ctx, row.data.bodyRef, MAIL_MAX_BODY_BYTES)).toString("utf8")) as { html: string; text: string }
    if (typeof body.html !== "string" || typeof body.text !== "string") throw new MailError("ASSET_UNAVAILABLE", "本机草稿正文不可用")
    return this.metadata(row, body)
  }
  private async persist(ctx: MailContext, id: string, input: DraftInput, extra: Partial<StoredDraft>, previous?: MailRecord<StoredDraft>): Promise<Draft> {
    const parsed = draftInputSchema.parse(input)
    const ids = [...new Set([...parsed.assetIds, ...parsed.inlineImages.map(image => image.assetId)])]
    if (new Set(parsed.inlineImages.map(image => image.cid)).size !== parsed.inlineImages.length || new Set(parsed.inlineImages.map(image => image.assetId)).size !== parsed.inlineImages.length) throw new MailError("INVALID_INPUT", "内嵌图片标识不能重复")
    for (const id of ids) {
      const asset = await this.assets.info(ctx, id)
      if (asset.accountId !== parsed.accountId || asset.state !== "ready") throw new MailError("UNAVAILABLE", "草稿附件不可用或不属于此邮箱")
      const image = parsed.inlineImages.find(image => image.assetId === id)
      if (image && (!/^[a-zA-Z0-9._@-]{1,200}$/u.test(image.cid) || asset.size > MAIL_MAX_IMAGE_BYTES || !rasterMime(await this.assets.read(ctx, id, MAIL_MAX_IMAGE_BYTES)))) throw new MailError("IMAGE_BLOCKED", "内嵌图片必须来自本机受控图片资产")
    }
    const bytes = Buffer.from(JSON.stringify({ html: parsed.html, text: parsed.text }))
    if (bytes.length > MAIL_MAX_BODY_BYTES) throw new MailError("LIMIT_EXCEEDED", "草稿正文超过大小上限")
    const body = await this.assets.put(ctx, Readable.from([bytes]), { accountId: parsed.accountId, name: "draft-body.json", mime: "application/json", pinned: true }, MAIL_MAX_BODY_BYTES)
    const old = new Set(previous?.data.pinnedAssetIds ?? [])
    const refs = [...new Set([...ids, body.id, ...(previous?.data.pendingAppend ? [previous.data.pendingAppend.rawAssetId] : [])])]
    const added = [body.id]
    let saved: MailRecord<StoredDraft>
    try {
      for (const id of refs) if (id !== body.id && !old.has(id)) { await this.assets.pin(ctx, id, 1); added.push(id) }
      const { html: _html, text: _text, ...metadata } = parsed
      const data: StoredDraft = { ...metadata, state: "editing", sourceMessageId: null, mode: "new", remoteLocator: null, syncState: "pending", remoteHash: null, remoteSourceId: null, headers: { inReplyTo: null, references: [] }, pendingAppend: null, ...previous?.data, ...metadata, ...extra, bodyRef: body.id, pinnedAssetIds: refs, localSaved: true, updatedAt: new Date().toISOString(), contentRevision: (previous?.data.contentRevision ?? 0) + 1 }
      if (data.pendingAppend?.state === "unknown" || data.pendingAppend?.state === "submitting") data.syncState = "unknown"
      else if (data.state !== "conflict") data.syncState = data.remoteLocator && extra.syncState === "synced" ? "synced" : "pending"
      saved = await this.repo.save(ctx, "drafts", id, parsed.accountId, data, previous?.revision ?? 0, sortKey())
    } catch (error) {
      if (!ctx.signal.aborted) for (const id of added) await this.assets.pin(ctx, id, -1)
      throw error
    }
    for (const id of old) if (!refs.includes(id)) await this.assets.pin(ctx, id, -1)
    this.notify(ctx, id)
    return this.metadata(saved, { html: parsed.html, text: parsed.text })
  }
  private async prepareSource(ctx: MailContext, input: Extract<MailInputs["draft.create"], { sourceMessageId: string }>): Promise<{ input: DraftInput; extra: Partial<StoredDraft> }> {
    const source = await resolveMessage(this.repo, ctx, input.sourceMessageId)
    if (source.accountId !== input.accountId) throw new MailError("UNAVAILABLE", "源邮件不属于此邮箱")
    if (source.data.summary.metadataTruncated) throw new MailError("METADATA_INCOMPLETE", "源邮件头不完整，请先核对原文")
    const account = await this.accounts.get(ctx, input.accountId), content = await this.content.body(ctx, source.id)
    const own = new Set([account.email, ...account.aliases].map(address => address.toLowerCase()))
    const seen = new Set<string>()
    const unique = (addresses: Address[]) => addresses.filter(address => { const key = address.address.toLowerCase(); if (own.has(key) || seen.has(key)) return false; seen.add(key); return true })
    const preferred = source.data.headers.replyTo.length ? source.data.headers.replyTo : source.data.summary.from
    const to = input.mode === "forward" ? [] : unique(input.mode === "reply_all" ? [...preferred, ...source.data.summary.to] : preferred)
    const cc = input.mode === "reply_all" ? unique(source.data.summary.cc) : []
    const author = source.data.summary.from.map(a => a.name ? `${a.name} <${a.address}>` : a.address).join(", ")
    const quoted = `${source.data.summary.date ?? ""} ${author}\n${content.body.text}`
    let html = `<p></p><blockquote>${escape(quoted).replace(/\n/gu, "<br>")}</blockquote>`
    const assetIds: string[] = [], inlineImages: Draft["inlineImages"] = []
    if (input.mode === "forward") {
      if (input.forwardMode === "eml") assetIds.push((await this.content.emlAsset(ctx, source.id)).id)
      else {
        const attachments = await this.content.attachments(ctx, source.id)
        for (const asset of attachments) {
          const ready = await this.content.ensureAsset(ctx, asset.id)
          if (ready.cid && attachments.filter(a => a.cid === ready.cid).length === 1 && ready.size <= MAIL_MAX_IMAGE_BYTES && rasterMime(await this.assets.read(ctx, ready.id, MAIL_MAX_IMAGE_BYTES))) {
            const cid = `${ready.id}@synapse.local`; inlineImages.push({ assetId: ready.id, cid }); html += `<p><img src="cid:${cid}"></p>`
          } else assetIds.push(ready.id)
        }
      }
    }
    const messageId = source.data.headers.messageId
    const subject = source.data.summary.subject
    return { input: draftInputSchema.parse({ accountId: input.accountId, to, cc, bcc: [], subject: input.mode === "forward" ? /^(?:fw|fwd):/iu.test(subject) ? subject : `Fwd: ${subject}` : /^re:/iu.test(subject) ? subject : `Re: ${subject}`, html, text: `\n\n${quoted.split("\n").map(line => `> ${line}`).join("\n")}`, assetIds, inlineImages }), extra: { sourceMessageId: source.id, mode: input.mode, headers: { inReplyTo: input.mode !== "forward" && validId(messageId) ? messageId : null, references: input.mode === "forward" ? [] : safeRefs([...source.data.headers.references, ...(validId(messageId) ? [messageId] : [])]) } } }
  }
  /** Prepare UI editing content without writing or synchronizing a draft. */
  async prepare(ctx: MailContext, input: MailInputs["draft.create"]): Promise<Draft> {
    const params = MAIL_INPUT_SCHEMAS["draft.create"].parse(input)
    await this.accounts.get(ctx, params.accountId)
    const prepared = "sourceMessageId" in params ? await this.prepareSource(ctx, params) : { input: params, extra: {} }
    this.accounts.context.assertCurrent(ctx)
    return draftSchema.parse({ ...prepared.input, id: `md_${randomUUID()}`, revision: 1, state: "editing", sourceMessageId: "sourceMessageId" in params ? params.sourceMessageId : null, mode: "mode" in params ? params.mode : "new", remoteLocator: null, localSaved: false, syncState: "pending", updatedAt: new Date().toISOString() })
  }
  /** First explicit UI save: preserve the edited body, deriving threading only from owned metadata. */
  async commit(ctx: MailContext, input: DraftCommit): Promise<Draft> {
    const { content, source } = draftCommitSchema.parse(input)
    await this.accounts.get(ctx, content.accountId)
    let extra: Partial<StoredDraft> = {}
    if (source) {
      const message = await resolveMessage(this.repo, ctx, source.messageId)
      if (message.accountId !== content.accountId) throw new MailError("UNAVAILABLE", "源邮件不属于此邮箱")
      if (message.data.summary.metadataTruncated) throw new MailError("METADATA_INCOMPLETE", "源邮件头不完整")
      const id = message.data.headers.messageId
      extra = { sourceMessageId: source.messageId, mode: source.mode, headers: { inReplyTo: source.mode !== "forward" && validId(id) ? id : null, references: source.mode === "forward" ? [] : safeRefs([...message.data.headers.references, ...(validId(id) ? [id] : [])]) } }
    }
    const result = await this.accounts.exclusive(ctx, content.accountId, () => this.persist(ctx, `md_${randomUUID()}`, content, extra))
    this.hooks.schedule?.(ctx, result.id)
    return result
  }
  /** Called by metadata sync while it already holds the account queue. Never fetches a body. */
  async indexRemote(ctx: MailContext, messageId: string): Promise<string | null> {
    const source = await resolveMessage(this.repo, ctx, messageId), folder = await this.repo.get<StoredFolder>(ctx, "folders", source.data.summary.locator.folderId)
    if (folder.data.folder.role !== "drafts") return null
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredDraft>(ctx, "drafts", { accountId: source.accountId, cursor, limit: 100 })
      const known = page.items.find(d => sameLocator(d.data.remoteLocator, source.data.summary.locator) || sameLocator(d.data.pendingAppend?.newLocator ?? null, source.data.summary.locator))
      if (known) return known.id
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    const id = remoteDraftId(messageId)
    if (await this.repo.find(ctx, "drafts", id)) return id
    const data: StoredDraft = { accountId: source.accountId, to: source.data.summary.to, cc: source.data.summary.cc, bcc: [], subject: source.data.summary.subject, assetIds: [], inlineImages: [], state: "editing", sourceMessageId: null, mode: "new", remoteLocator: source.data.summary.locator, localSaved: false, syncState: "synced", updatedAt: source.data.summary.date ?? new Date().toISOString(), contentRevision: 1, bodyRef: null, pinnedAssetIds: [], remoteHash: null, remoteSourceId: messageId, headers: { inReplyTo: null, references: [] }, pendingAppend: null }
    await this.repo.save(ctx, "drafts", id, source.accountId, data, 0, sortKey())
    this.notify(ctx, id)
    return id
  }
  /** Account queue must already be held. Used by lazy hydration and conflict preservation. */
  async importRemoteLocked(ctx: MailContext, input: { accountId: string; locator: MessageLocator; raw: Buffer; id?: string; previous?: MailRecord<StoredDraft>; sourceId?: string | null; conflict?: boolean }): Promise<Draft> {
    const assets: Awaited<ReturnType<MailAssets["put"]>>[] = []
    const parsed = await parseMailStream(Readable.from([input.raw]), { signal: ctx.signal, attachment: async (metadata, source) => { assets.push(await this.assets.put(ctx, source, { accountId: input.accountId, name: metadata.filename, mime: metadata.mime, ...(metadata.cid ? { cid: metadata.cid } : {}) })) } })
    const inlineImages: Draft["inlineImages"] = [], assetIds: string[] = []
    for (const asset of assets) {
      if (asset.cid && !parsed.ambiguousCids.includes(asset.cid) && /^[a-zA-Z0-9._@-]{1,200}$/u.test(asset.cid) && asset.size <= MAIL_MAX_IMAGE_BYTES && rasterMime(await this.assets.read(ctx, asset.id, MAIL_MAX_IMAGE_BYTES))) inlineImages.push({ assetId: asset.id, cid: asset.cid })
      else assetIds.push(asset.id)
    }
    return this.persist(ctx, input.id ?? `md_${randomUUID()}`, draftInputSchema.parse({ accountId: input.accountId, to: parsed.to, cc: parsed.cc, bcc: parsed.bcc, subject: parsed.subject.replace(/[\r\n\x00]/gu, " ").slice(0, 998), html: parsed.html, text: parsed.text, assetIds, inlineImages }), { state: input.conflict ? "conflict" : "editing", syncState: input.conflict ? "conflict" : "synced", remoteLocator: input.locator, remoteHash: createHash("sha256").update(input.raw).digest("hex"), remoteSourceId: input.sourceId ?? null, headers: { inReplyTo: validId(parsed.inReplyTo) ? parsed.inReplyTo : null, references: safeRefs(parsed.references) } }, input.previous)
  }
  async recover(ctx: MailContext): Promise<void> {
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredAccount>(ctx, "accounts", { cursor, limit: 100 })
      for (const account of page.items) await this.accounts.exclusive(ctx, account.id, async () => {
        await this.assets.rebuildPins(ctx, account.id)
        const remoteFolders = new Set<string>()
        let folderCursor: string | undefined
        do {
          const folders = await this.repo.page<StoredFolder>(ctx, "folders", { accountId: account.id, cursor: folderCursor, limit: 100 })
          for (const folder of folders.items) if (folder.data.folder.role === "drafts") remoteFolders.add(folder.id)
          folderCursor = folders.nextCursor ?? undefined
        } while (folderCursor)
        let messageCursor: string | undefined
        do {
          const messages = await this.repo.page<StoredMessage>(ctx, "messages", { accountId: account.id, cursor: messageCursor, limit: 100 })
          for (const message of messages.items) if (!message.data.summary.stale && remoteFolders.has(message.data.summary.locator.folderId)) await this.indexRemote(ctx, message.id)
          messageCursor = messages.nextCursor ?? undefined
        } while (messageCursor)
        let draftCursor: string | undefined
        do {
          const drafts = await this.repo.page<StoredDraft>(ctx, "drafts", { accountId: account.id, cursor: draftCursor, limit: 100 })
          for (const row of drafts.items) if (row.data.pendingAppend?.state === "submitting") await this.repo.save(ctx, "drafts", row.id, account.id, { ...row.data, syncState: "unknown", pendingAppend: { ...row.data.pendingAppend, state: "unknown" } }, row.revision, row.sortKey)
          draftCursor = drafts.nextCursor ?? undefined
        } while (draftCursor)
      })
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }
  async execute<K extends DraftAction>(ctx: MailContext, action: K, input: MailInputs[K]): Promise<MailResults[K]> {
    let result: unknown
    if (action === "draft.create") {
      const params = MAIL_INPUT_SCHEMAS["draft.create"].parse(input)
      await this.repo.get(ctx, "accounts", params.accountId)
      const prepared = "sourceMessageId" in params ? await this.prepareSource(ctx, params) : { input: params, extra: {} }
      result = await this.accounts.exclusive(ctx, params.accountId, () => this.persist(ctx, `md_${randomUUID()}`, prepared.input, prepared.extra))
      this.hooks.schedule?.(ctx, (result as Draft).id)
    } else if (action === "draft.get") result = await this.get(ctx, MAIL_INPUT_SCHEMAS["draft.get"].parse(input).draftId)
    else if (action === "draft.list") {
      const params = MAIL_INPUT_SCHEMAS["draft.list"].parse(input)
      await this.repo.get(ctx, "accounts", params.accountId)
      const page = await this.repo.page<StoredDraft>(ctx, "drafts", params)
      result = { items: page.items.map(row => { const { html: _html, text: _text, ...metadata } = this.metadata(row); return metadata }), nextCursor: page.nextCursor }
    } else {
      const params = action === "draft.update" ? MAIL_INPUT_SCHEMAS["draft.update"].parse(input) : MAIL_INPUT_SCHEMAS["draft.delete"].parse(input)
      const current = await this.get(ctx, params.draftId)
      result = await this.accounts.exclusive(ctx, current.accountId, async () => {
        const row = await this.stored(ctx, params.draftId)
        if (row.data.contentRevision !== params.expectedRevision) throw new MailError("VERSION_CONFLICT", "草稿已被修改，请重新读取")
        if (action === "draft.delete") {
          if (row.data.remoteLocator) {
            if (!this.hooks.removeRemote) throw new MailError("UNAVAILABLE", "远端草稿删除暂不可用")
            await this.hooks.removeRemote(ctx, row)
          }
          await this.repo.remove(ctx, "drafts", row.id, row.revision)
          for (const id of row.data.pinnedAssetIds) await this.assets.pin(ctx, id, -1)
          this.notify(ctx, row.id)
          return { success: true }
        }
        if (row.data.state !== "editing") throw new MailError(row.data.state === "consumed" ? "DRAFT_CONSUMED" : "DRAFT_CONFLICT", "请从所选内容新建草稿副本")
        const patch = MAIL_INPUT_SCHEMAS["draft.update"].parse(params).patch
        return this.persist(ctx, row.id, draftInputSchema.parse({ accountId: current.accountId, to: current.to, cc: current.cc, bcc: current.bcc, subject: current.subject, html: current.html, text: current.text, assetIds: current.assetIds, inlineImages: current.inlineImages, ...patch }), {}, row)
      })
      if (action === "draft.update") this.hooks.schedule?.(ctx, params.draftId)
    }
    return result as MailResults[K]
  }
}
