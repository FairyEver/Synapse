import { createHash } from "node:crypto"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { MailParser, type AttachmentStream, type MessageText, type AddressObject } from "mailparser"
import { externalAssetPath, openExternalAsset, exportExternalAsset, AssetSizeLimitError } from "../../../electron/runtime/data-repo/assets"
import { MAIL_BODY_CHUNK_BYTES, MAIL_MAX_ATTACHMENT_BYTES, MAIL_MAX_ATTACHMENTS, MAIL_MAX_BODY_BYTES } from "../shared/limits"
import { MAIL_INPUT_SCHEMAS, addressSchema } from "../shared/schema"
import { MailError, type MailAction, type MailAsset, type MailContext, type MailDetail, type MailInputs, type MailResults } from "../shared/types"
import { MailRepository } from "./repository"
import { MailAccounts } from "./accounts"
import { MailAssets, type MailAccess, type StoredMailAsset } from "./assets"
import { resolveMessage, messageSummary, assertRemoteGeneration, type StoredFolder, type StoredMessage } from "./sync"
import type { ReadSearchText } from "./search"
import type { MailBodyStructure, MailImapSession } from "./protocol/types"

interface ParsedAttachment { filename: string; mime: string; cid: string | null; part: string | null; size: number; sha256: string }
interface ParsedBody { html: string; text: string }
const cleanCid = (value?: string): string | null => value ? value.replace(/^<|>$/gu, "").trim() || null : null
const filename = (value?: string): string => path.basename(value ?? "attachment").replace(/[\x00-\x1f\x7f]/gu, "").slice(0, 255) || "attachment"
function limitStream(max: number): Transform {
  let size = 0
  return new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; callback(size > max ? new MailError("LIMIT_EXCEEDED", "邮件内容超过大小上限") : null, chunk) } })
}
export async function parseMailStream(source: Readable, options: { signal: AbortSignal; maxBytes?: number; attachment?: (metadata: Omit<ParsedAttachment, "size" | "sha256">, source: Readable) => Promise<void> }): Promise<ParsedBody & { subject: string; date: string | null; messageId: string | null; inReplyTo: string | null; references: string[]; from: MailDetail["from"]; to: MailDetail["to"]; cc: MailDetail["cc"]; bcc: MailDetail["to"]; attachments: ParsedAttachment[]; ambiguousCids: string[] }> {
  const parser = new MailParser({ skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: MAIL_MAX_BODY_BYTES, ignoreEmbedded: true, maxChildNodes: 1000, maxHeadSize: 64 * 1024 })
  const input = pipeline(source, limitStream(options.maxBytes ?? MAIL_MAX_ATTACHMENT_BYTES), parser, { signal: options.signal })
  // Both sides are observed immediately so a parser/input error cannot become an unhandled rejection.
  const safeInput = input.then(() => null, error => error as unknown)
  const attachments: ParsedAttachment[] = []
  let html = "", text = ""
  try {
    for await (const emitted of parser) {
      const item = emitted as AttachmentStream | MessageText
      if (item.type === "attachment") {
        if (attachments.length >= MAIL_MAX_ATTACHMENTS) throw new MailError("LIMIT_EXCEEDED", "邮件附件数量超限")
        const metadata = { filename: filename(item.filename), mime: item.contentType, cid: cleanCid(item.contentId), part: item.partId }
        let size = 0; const hash = createHash("sha256")
        const stream = item.content.pipe(new Transform({ transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length; hash.update(chunk); callback(size > MAIL_MAX_ATTACHMENT_BYTES ? new MailError("LIMIT_EXCEEDED", "附件超过大小上限") : null, chunk)
        } }))
        item.content.once("error", error => stream.destroy(error))
        try {
          if (options.attachment) await options.attachment(metadata, stream)
          for await (const _chunk of stream) { options.signal.throwIfAborted() }
          attachments.push({ ...metadata, size, sha256: hash.digest("hex") })
        } finally { stream.destroy(); item.content.destroy(); item.release?.() }
      } else {
        html = item.html || ""; text = item.text || ""
        if (Buffer.byteLength(html) + Buffer.byteLength(text) > MAIL_MAX_BODY_BYTES) throw new MailError("LIMIT_EXCEEDED", "邮件正文超过大小上限")
      }
    }
    const failed = await safeInput; if (failed) throw failed
    const rawDate = parser.headerLines && parser.headerLines.find(line => line.key === "date")?.line.replace(/^date:\s*/iu, "")
    const parsedDate = rawDate ? new Date(rawDate) : null
    const cids = attachments.flatMap(a => a.cid ? [a.cid] : [])
    const addresses = (value?: AddressObject | AddressObject[]) => (Array.isArray(value) ? value : value ? [value] : []).flatMap(group => group.value).flatMap(address => {
      const result = addressSchema.safeParse({ address: address.address, ...(address.name ? { name: address.name } : {}) })
      return result.success ? [result.data] : []
    })
    return { html, text, subject: parser.subject ?? "", date: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : null, messageId: parser.messageId ?? null, inReplyTo: parser.inReplyTo ?? null, references: typeof parser.references === "string" ? [parser.references] : parser.references ?? [], from: addresses(parser.from), to: addresses(parser.to), cc: addresses(parser.cc), bcc: addresses(parser.bcc), attachments, ambiguousCids: [...new Set(cids.filter((cid, i) => cids.indexOf(cid) !== i))] }
  } catch (error) {
    source.destroy(); parser.destroy(); await safeInput
    if (error instanceof MailError) throw error
    if (options.signal.aborted) throw new MailError("CANCELLED", "邮件解析已取消")
    throw new MailError("MIME_INVALID", "邮件格式无法解析")
  }
}
interface MimeParts { body: { part: string; mime: string }[]; attachments: { part: string; name: string; mime: string; cid: string | null; size: number }[] }
export function describeMimeParts(structure: MailBodyStructure): MimeParts {
  const result: MimeParts = { body: [], attachments: [] }, queue = [{ node: structure, depth: 0 }]
  let visited = 0
  while (queue.length) {
    const { node, depth } = queue.shift()!
    if (++visited > 1000 || depth > 30) throw new MailError("LIMIT_EXCEEDED", "邮件 MIME 层级超限")
    const mime = node.type.toLowerCase(), disposition = node.disposition?.toLowerCase()
    if (node.childNodes?.length && mime !== "message/rfc822") { queue.push(...node.childNodes.map(child => ({ node: child, depth: depth + 1 }))); continue }
    const part = node.part ?? "1"
    if (!/^\d+(?:\.\d+)*$/u.test(part)) throw new MailError("MIME_INVALID", "邮件 MIME part 无效")
    if (["text/html", "text/plain"].includes(mime) && disposition !== "attachment" && !node.dispositionParameters?.filename) result.body.push({ part, mime })
    else result.attachments.push({ part, mime, name: filename(node.dispositionParameters?.filename ?? node.parameters?.name), cid: cleanCid(node.id), size: Math.max(0, node.size ?? 0) })
  }
  if (result.attachments.length > MAIL_MAX_ATTACHMENTS) throw new MailError("LIMIT_EXCEEDED", "邮件附件数量超限")
  return result
}
async function collect(source: Readable, max: number, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0
  try { for await (const chunk of source) { signal.throwIfAborted(); const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > max) throw new MailError("LIMIT_EXCEEDED", "邮件内容超过大小上限"); chunks.push(bytes) } } finally { source.destroy() }
  return Buffer.concat(chunks, size)
}
function attachmentAssetId(messageId: string, part: string): string {
  const hash = createHash("sha256").update(`${messageId}:${part}`).digest("hex")
  return `mas_${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
type AttachmentAction = Extract<MailAction, `attachment.${string}`> | "message.extract_to_file"
export class MailContent {
  constructor(private readonly repo: MailRepository, private readonly accounts: MailAccounts, private readonly assets: MailAssets, private readonly access: MailAccess) {}
  private async withMessage<T>(ctx: MailContext, id: string, task: (row: Awaited<ReturnType<typeof resolveMessage>>, folder: StoredFolder, session: MailImapSession) => Promise<T>): Promise<T> {
    const target = await resolveMessage(this.repo, ctx, id)
    return this.accounts.exclusive(ctx, target.accountId, async () => {
      const row = await resolveMessage(this.repo, ctx, id), folder = await this.repo.get<StoredFolder>(ctx, "folders", row.data.summary.locator.folderId)
      const { config, credential } = await this.accounts.credential(ctx, row.accountId)
      const session = await this.accounts.protocols.imap(ctx, config, credential)
      try {
        const selected = await session.select(folder.data.folder.path, ctx.signal)
        await assertRemoteGeneration(this.repo, ctx, folder.id, row.data.summary.locator.uidValidity, selected.uidValidity)
        return await task(row, folder.data, session)
      } finally { await session.close() }
    })
  }
  async structure(ctx: MailContext, messageId: string): Promise<MailBodyStructure> {
    const row = await resolveMessage(this.repo, ctx, messageId)
    if (row.data.structure) return row.data.structure
    return this.withMessage(ctx, messageId, async (current, folder, session) => {
      const structure = current.data.structure ?? await session.fetchBodyStructure(folder.folder.path, current.data.summary.locator.uid, ctx.signal)
      if (!structure) throw new MailError("MIME_UNAVAILABLE", "邮件正文结构暂不可用")
      await this.repo.save(ctx, "messages", current.id, current.accountId, { ...current.data, structure }, current.revision, current.sortKey)
      return structure
    })
  }
  async attachments(ctx: MailContext, messageId: string): Promise<MailAsset[]> {
    const structure = await this.structure(ctx, messageId), message = await resolveMessage(this.repo, ctx, messageId)
    const attachments: MailAsset[] = []
    for (const part of describeMimeParts(structure).attachments) {
      const id = attachmentAssetId(messageId, part.part)
      let row = await this.repo.find<StoredMailAsset>(ctx, "assets", id)
      if (!row) {
        const asset: MailAsset = { id, accountId: message.accountId, name: part.name, mime: part.mime, size: part.size, cid: part.cid, sha256: null, state: "remote", attachmentId: part.part, messageId }
        try { row = await this.repo.save<StoredMailAsset>(ctx, "assets", id, message.accountId, { asset, key: null, pins: 0, cache: true, accessedAt: new Date().toISOString(), part: part.part }, 0) } catch (error) {
          if (!(error instanceof MailError && error.code === "VERSION_CONFLICT")) throw error
          row = await this.repo.get<StoredMailAsset>(ctx, "assets", id)
        }
      }
      attachments.push(row.data.asset)
    }
    return attachments
  }
  async detail(ctx: MailContext, messageId: string): Promise<MailDetail> {
    const attachments = await this.attachments(ctx, messageId), row = await resolveMessage(this.repo, ctx, messageId)
    return { ...messageSummary(row), attachments, bodyRef: row.data.bodyRef, headers: row.data.headers }
  }
  private async cachedBody(ctx: MailContext, id: string): Promise<{ body: ParsedBody; bodyRef: string } | null> {
    const row = await resolveMessage(this.repo, ctx, id)
    if (!row.data.bodyRef) return null
    try {
      const asset = await this.assets.info(ctx, row.data.bodyRef)
      if (asset.state !== "ready") return null
      const data = JSON.parse((await this.assets.read(ctx, asset.id, MAIL_MAX_BODY_BYTES)).toString("utf8")) as ParsedBody
      if (typeof data.html !== "string" || typeof data.text !== "string") throw new MailError("MIME_INVALID", "正文缓存不可用")
      return { body: data, bodyRef: asset.id }
    } catch (error) { if (error instanceof MailError && error.code === "UNAVAILABLE") return null; throw error }
  }
  async body(ctx: MailContext, messageId: string): Promise<{ body: ParsedBody; bodyRef: string }> {
    const cached = await this.cachedBody(ctx, messageId); if (cached) return cached
    const structure = await this.structure(ctx, messageId)
    return this.withMessage(ctx, messageId, async (row, folder, session) => {
      const already = await this.cachedBody(ctx, messageId); if (already) return already
      const parts = describeMimeParts(structure).body
      if (!parts.length) throw new MailError("BODY_UNAVAILABLE", "此邮件没有可读取的文字正文")
      let html = "", text = "", size = 0
      // Multipart/alternative contributes one preferred part per type, never attachment bytes.
      for (const mime of ["text/html", "text/plain"]) {
        const part = parts.find(p => p.mime === mime); if (!part) continue
        const bytes = await collect(await session.fetchPart(folder.folder.path, row.data.summary.locator.uid, part.part, ctx.signal, MAIL_MAX_BODY_BYTES - size), MAIL_MAX_BODY_BYTES - size, ctx.signal)
        size += bytes.length
        if (mime === "text/html") html = bytes.toString("utf8"); else text = bytes.toString("utf8")
      }
      if (!text && html) {
        const parsed = await parseMailStream(Readable.from([`Content-Type: text/html; charset=UTF-8\r\n\r\n${html}`]), { signal: ctx.signal, maxBytes: MAIL_MAX_BODY_BYTES + 1024 })
        text = parsed.text
      }
      const encoded = Buffer.from(JSON.stringify({ html, text }))
      if (encoded.length > MAIL_MAX_BODY_BYTES) throw new MailError("LIMIT_EXCEEDED", "邮件正文超过大小上限")
      const asset = await this.assets.put(ctx, Readable.from([encoded]), { accountId: row.accountId, messageId, name: "body.json", mime: "application/json", cache: true }, MAIL_MAX_BODY_BYTES)
      const current = await resolveMessage(this.repo, ctx, messageId)
      await this.repo.save<StoredMessage>(ctx, "messages", row.id, row.accountId, { ...current.data, bodyRef: asset.id, summary: { ...current.data.summary, bodyState: "cached", snippet: text.replace(/\s+/gu, " ").slice(0, 300) } }, current.revision, row.sortKey)
      await this.assets.trim(ctx)
      return { body: { html, text }, bodyRef: asset.id }
    })
  }
  readSearchText: ReadSearchText = async (ctx, id, options) => {
    const cached = await this.cachedBody(ctx, id)
    const row = await resolveMessage(this.repo, ctx, id)
    let text = cached?.body.text
    if (text === undefined && row.data.searchTextRef) {
      const asset = await this.assets.info(ctx, row.data.searchTextRef)
      if (asset.state === "ready") text = (await this.assets.read(ctx, asset.id, MAIL_MAX_BODY_BYTES)).toString("utf8")
    }
    if (text !== undefined) {
      let end = Math.min(text.length, options.maxBytes)
      while (Buffer.byteLength(text.slice(0, end)) > options.maxBytes) end = Math.floor(end * 0.9)
      if (end && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--
      return { text: text.slice(0, end), bytes: Buffer.byteLength(text.slice(0, end)), available: true, truncated: end < text.length }
    }
    if (options.cachedOnly) return { text: "", bytes: 0, available: false }
    const structure = await this.structure(ctx, id)
    return this.withMessage(ctx, id, async (message, folder, session) => {
      const parts = describeMimeParts(structure).body
      const part = parts.find(p => p.mime === "text/plain") ?? parts.find(p => p.mime === "text/html")
      if (!part) throw new MailError("BODY_UNAVAILABLE", "此邮件没有文字正文")
      const max = Math.min(options.maxBytes, MAIL_MAX_BODY_BYTES)
      const bytes = await collect(await session.fetchPart(folder.folder.path, message.data.summary.locator.uid, part.part, ctx.signal, max), max, ctx.signal)
      const parsed = part.mime === "text/plain" ? bytes.toString("utf8") : (await parseMailStream(Readable.from([`Content-Type: text/html; charset=UTF-8\r\n\r\n${bytes.toString("utf8")}`]), { signal: ctx.signal, maxBytes: max + 1024 })).text
      const asset = await this.assets.put(ctx, Readable.from([Buffer.from(parsed)]), { accountId: message.accountId, messageId: id, name: "search-text.txt", mime: "text/plain", cache: true }, MAIL_MAX_BODY_BYTES)
      const current = await resolveMessage(this.repo, ctx, id)
      await this.repo.save(ctx, "messages", id, message.accountId, { ...current.data, searchTextRef: asset.id }, current.revision, current.sortKey)
      await this.assets.trim(ctx)
      return { text: parsed, bytes: bytes.length, available: true }
    })
  }
  async readChunk(ctx: MailContext, input: MailInputs["body.read_chunk"]): Promise<MailResults["body.read_chunk"]> {
    const content = await this.body(ctx, input.messageId)
    if (input.bodyRef && content.bodyRef !== input.bodyRef) throw new MailError("CURSOR_EXPIRED", "正文缓存已变化，请重新读取")
    const scope = `${ctx.ownerId}:${ctx.generation}:${input.messageId}:${content.bodyRef}`
    let positions = { html: 0, text: 0 }
    if (input.cursor) {
      try {
        const cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString()) as typeof positions & { scope: string }
        if (cursor.scope !== scope || !Number.isSafeInteger(cursor.html) || !Number.isSafeInteger(cursor.text) || cursor.html < 0 || cursor.text < 0 || cursor.html > content.body.html.length || cursor.text > content.body.text.length) throw new Error("cursor")
        positions = cursor
      } catch { throw new MailError("CURSOR_EXPIRED", "正文读取位置已失效") }
    }
    const chunk: ParsedBody = { html: "", text: "" }
    for (const field of ["html", "text"] as const) {
      let end = Math.min(content.body[field].length, positions[field] + MAIL_BODY_CHUNK_BYTES / 6)
      if (end > positions[field] && /[\uD800-\uDBFF]/u.test(content.body[field][end - 1])) end--
      chunk[field] = content.body[field].slice(positions[field], end); positions[field] = end
    }
    const complete = positions.html === content.body.html.length && positions.text === content.body.text.length
    return { bodyRef: content.bodyRef, ...chunk, nextCursor: complete ? null : Buffer.from(JSON.stringify({ ...positions, scope })).toString("base64url"), complete, truncated: false }
  }
  async ensureAsset(ctx: MailContext, id: string, maxBytes = MAIL_MAX_ATTACHMENT_BYTES): Promise<MailAsset> {
    const asset = await this.assets.info(ctx, id)
    if (asset.state === "ready") return asset
    if (!asset.messageId || !asset.attachmentId) throw new MailError("UNAVAILABLE", "附件不可用")
    await this.attachments(ctx, asset.messageId)
    return this.withMessage(ctx, asset.messageId, async (message, folder, session) => {
      const current = await this.assets.info(ctx, id)
      if (current.state === "ready") return current
      const source = await session.fetchPart(folder.folder.path, message.data.summary.locator.uid, asset.attachmentId!, ctx.signal)
      return this.assets.materialize(ctx, id, source, maxBytes)
    })
  }
  private async assetReference(ctx: MailContext, input: { assetId: string } | { messageId: string; attachmentId: string }): Promise<MailAsset> {
    if ("assetId" in input) return this.assets.info(ctx, input.assetId)
    const asset = (await this.attachments(ctx, input.messageId)).find(a => a.attachmentId === input.attachmentId)
    if (!asset) throw new MailError("UNAVAILABLE", "附件不存在")
    return asset
  }
  async emlAsset(ctx: MailContext, messageId: string): Promise<MailAsset> {
    return this.withMessage(ctx, messageId, async (message, folder, session) => this.assets.put(ctx, await session.fetchPart(folder.folder.path, message.data.summary.locator.uid, undefined, ctx.signal), { accountId: message.accountId, messageId, name: "original.eml", mime: "message/rfc822", cache: true }))
  }
  private async export(ctx: MailContext, assetId: string, inputPath: string) {
    const outputPath = await externalAssetPath(inputPath)
    await this.access(ctx, "fs.write.outside-userdata", outputPath)
    const stream = await this.assets.open(ctx, assetId)
    try {
      const result = await exportExternalAsset(stream, outputPath, MAIL_MAX_ATTACHMENT_BYTES, ctx.signal)
      await this.assets.info(ctx, assetId)
      return { outputPath, ...result }
    } catch (error) {
      stream.destroy()
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new MailError("OUTPUT_EXISTS", "目标文件已存在，请选择其他路径")
      if (error instanceof AssetSizeLimitError) throw new MailError("LIMIT_EXCEEDED", "附件超过大小上限")
      throw error
    }
  }
  async executeAttachment<K extends AttachmentAction>(ctx: MailContext, action: K, input: MailInputs[K]): Promise<MailResults[K]> {
    let result: unknown
    if (action === "attachment.import_local") {
      const params = MAIL_INPUT_SCHEMAS["attachment.import_local"].parse(input)
      await this.repo.get(ctx, "accounts", params.accountId)
      const filePath = await externalAssetPath(params.filePath)
      await this.access(ctx, "fs.read.outside-userdata", filePath)
      const source = await openExternalAsset(filePath, MAIL_MAX_ATTACHMENT_BYTES, ctx.signal).catch(error => {
        if (error instanceof AssetSizeLimitError) throw new MailError("LIMIT_EXCEEDED", "附件超过大小上限")
        throw error
      })
      result = await this.assets.put(ctx, source, { accountId: params.accountId, name: filename(filePath), mime: "application/octet-stream" })
      await this.repo.get(ctx, "accounts", params.accountId)
    } else if (action === "attachment.list") {
      const params = MAIL_INPUT_SCHEMAS["attachment.list"].parse(input)
      if ("messageId" in params) {
        await this.attachments(ctx, params.messageId)
        const message = await resolveMessage(this.repo, ctx, params.messageId)
        let cursor = params.cursor; const items: MailAsset[] = []
        do {
          const page = await this.repo.page<StoredMailAsset>(ctx, "assets", { accountId: message.accountId, cursor, limit: params.limit - items.length, binding: params.messageId })
          for (const row of page.items) if (row.data.asset.messageId === params.messageId && row.data.asset.attachmentId) items.push(row.data.asset)
          cursor = page.nextCursor ?? undefined; if (!cursor) break
        } while (items.length < params.limit)
        result = { items, nextCursor: cursor ?? null }
      } else {
        const draft = await this.repo.get<{ assetIds: string[]; inlineImages: { assetId: string }[] }>(ctx, "drafts", params.draftId)
        const ids = new Set([...draft.data.assetIds, ...draft.data.inlineImages.map(i => i.assetId)])
        let cursor = params.cursor; const items: MailAsset[] = []
        do {
          const page = await this.repo.page<StoredMailAsset>(ctx, "assets", { accountId: draft.accountId, cursor, limit: params.limit - items.length, binding: params.draftId })
          for (const row of page.items) if (ids.has(row.id)) items.push(row.data.asset)
          cursor = page.nextCursor ?? undefined; if (!cursor) break
        } while (items.length < params.limit)
        result = { items, nextCursor: cursor ?? null }
      }
    } else if (action === "attachment.get") result = await this.assetReference(ctx, MAIL_INPUT_SCHEMAS["attachment.get"].parse(input))
    else if (action === "attachment.download_file") {
      const params = MAIL_INPUT_SCHEMAS["attachment.download_file"].parse(input), asset = await this.assetReference(ctx, params)
      await this.ensureAsset(ctx, asset.id); result = await this.export(ctx, asset.id, params.outputPath)
    } else if (action === "attachment.delete") {
      await this.assets.remove(ctx, MAIL_INPUT_SCHEMAS["attachment.delete"].parse(input).assetId); result = { success: true }
    } else {
      const params = MAIL_INPUT_SCHEMAS["message.extract_to_file"].parse(input), asset = await this.emlAsset(ctx, params.messageId)
      result = await this.export(ctx, asset.id, params.outputPath)
    }
    return result as MailResults[K]
  }
}
