import { randomUUID } from "node:crypto"
import type { Readable } from "node:stream"
import type { PermissionAction } from "../../../electron/runtime/security"
import { ManagedAssetStore } from "../../../electron/runtime/data-repo/assets"
import { MAIL_CACHE_BYTES, MAIL_MAX_ATTACHMENT_BYTES } from "../shared/limits"
import { MailError, type MailAsset, type MailContext } from "../shared/types"
import { MailRepository } from "./repository"

export type MailAccess = (ctx: MailContext, action: PermissionAction, resource: string) => Promise<void>
export interface StoredMailAsset extends Record<string, unknown> {
  asset: MailAsset
  key: string | null
  pins: number
  cache: boolean
  accessedAt: string
}

export class MailAssets {
  constructor(private readonly repo: MailRepository, private readonly files: ManagedAssetStore, private readonly access: MailAccess) {}

  async put(ctx: MailContext, source: Readable, metadata: {
    accountId: string; name: string; mime: string; cid?: string; messageId?: string; attachmentId?: string; cache?: boolean; pinned?: boolean
  }, maxBytes = MAIL_MAX_ATTACHMENT_BYTES): Promise<MailAsset> {
    await this.repo.get(ctx, "accounts", metadata.accountId)
    const id = `mas_${randomUUID()}`
    await this.access(ctx, "fs.write", id)
    const asset: MailAsset = { id, accountId: metadata.accountId, name: metadata.name, mime: metadata.mime, size: 0, sha256: null, cid: metadata.cid ?? null, state: "staged", attachmentId: metadata.attachmentId ?? null, messageId: metadata.messageId ?? null }
    const data: StoredMailAsset = { asset, key: id.slice(4), pins: 0, cache: metadata.cache ?? false, accessedAt: new Date().toISOString() }
    await this.repo.save(ctx, "assets", id, metadata.accountId, data, 0)
    const stored = await this.files.put(source, maxBytes, ctx.signal, data.key!)
    // Keep the staged row recoverable if identity changes or committing metadata fails.
    // The immutable key equals the generated file key and is never supplied by a caller.
    data.key = stored.key
    data.pins = metadata.pinned ? 1 : 0
    data.asset = { ...asset, size: stored.size, sha256: stored.sha256, state: "ready" }
    try {
      await this.repo.save(ctx, "assets", id, metadata.accountId, data, 1, `${data.accessedAt}:${id}`)
    } catch (error) {
      await this.files.remove(stored.key)
      throw error
    }
    return data.asset
  }

  async info(ctx: MailContext, id: string): Promise<MailAsset> {
    return (await this.repo.get<StoredMailAsset>(ctx, "assets", id)).data.asset
  }

  async read(ctx: MailContext, id: string, maxBytes = MAIL_MAX_ATTACHMENT_BYTES): Promise<Buffer> {
    const row = await this.touch(ctx, id)
    if (row.data.asset.state !== "ready" || !row.data.key) throw new MailError("UNAVAILABLE", "附件尚未下载或缓存已清理")
    await this.access(ctx, "content.read", id)
    const bytes = await this.files.read(row.data.key, maxBytes)
    await this.repo.get(ctx, "assets", id)
    return bytes
  }

  async open(ctx: MailContext, id: string): Promise<Readable> {
    const row = await this.touch(ctx, id)
    if (!row.data.key || row.data.asset.state !== "ready") throw new MailError("UNAVAILABLE", "附件尚未下载或缓存已清理")
    await this.access(ctx, "content.read", id)
    const stream = await this.files.open(row.data.key)
    try { await this.repo.get(ctx, "assets", id) } catch (error) { stream.destroy(); throw error }
    const abort = () => stream.destroy(new MailError("IDENTITY_CHANGED", "邮箱身份已变化"))
    ctx.signal.addEventListener("abort", abort, { once: true })
    stream.once("close", () => ctx.signal.removeEventListener("abort", abort))
    return stream
  }

  private async touch(ctx: MailContext, id: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await this.repo.get<StoredMailAsset>(ctx, "assets", id)
      const accessedAt = new Date().toISOString()
      try { return await this.repo.save(ctx, "assets", id, row.accountId, { ...row.data, accessedAt }, row.revision, `${accessedAt}:${id}`) } catch (error) {
        if (!(error instanceof MailError && error.code === "VERSION_CONFLICT")) throw error
      }
    }
    throw new MailError("VERSION_CONFLICT", "附件状态正在变化，请重试")
  }

  async pin(ctx: MailContext, id: string, delta: number): Promise<void> {
    const row = await this.repo.get<StoredMailAsset>(ctx, "assets", id)
    if (row.data.asset.state === "delete-pending") throw new MailError("ASSET_IN_USE", "附件正在清理")
    const pins = row.data.pins + delta
    if (pins < 0) throw new MailError("VERSION_CONFLICT", "附件引用状态已变化")
    await this.repo.save(ctx, "assets", id, row.accountId, { ...row.data, pins }, row.revision, row.sortKey)
  }

  async remove(ctx: MailContext, id: string, eviction = false): Promise<void> {
    const row = await this.repo.get<StoredMailAsset>(ctx, "assets", id)
    if (!eviction && row.data.asset.messageId) throw new MailError("ASSET_IN_USE", "服务端邮件附件只能清理缓存")
    if (row.data.pins > 0 || (eviction && !row.data.cache)) throw new MailError("ASSET_IN_USE", "附件仍被草稿或发送操作使用")
    await this.access(ctx, "fs.write", id)
    const pending = await this.repo.save(ctx, "assets", id, row.accountId, { ...row.data, asset: { ...row.data.asset, state: "delete-pending" as const } }, row.revision, row.sortKey)
    if (row.data.key) await this.files.remove(row.data.key)
    if (row.data.key) await this.files.remove(row.data.key, true)
    if (eviction && row.data.asset.messageId) {
      await this.repo.save(ctx, "assets", id, row.accountId, { ...pending.data, key: null, asset: { ...row.data.asset, state: "remote" as const } }, pending.revision, row.sortKey)
    } else await this.repo.remove(ctx, "assets", id, pending.revision)
  }

  async clearCache(ctx: MailContext, accountId?: string, budget = 0): Promise<{ removed: number; bytes: number }> {
    let remaining = 0
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredMailAsset>(ctx, "assets", { accountId, cursor, limit: 100 })
      remaining += page.items.filter(r => r.data.cache && r.data.pins === 0 && r.data.asset.state === "ready").reduce((n, r) => n + r.data.asset.size, 0)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    let removed = 0, bytes = 0
    cursor = undefined
    while (remaining > budget) {
      const page = await this.repo.page<StoredMailAsset>(ctx, "assets", { accountId, cursor, limit: 100 })
      for (const row of page.items) {
        if (remaining <= budget) break
        if (!row.data.cache || row.data.pins > 0 || row.data.asset.state !== "ready") continue
        await this.remove(ctx, row.id, true)
        remaining -= row.data.asset.size
        bytes += row.data.asset.size
        removed++
      }
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    return { removed, bytes }
  }

  trim(ctx: MailContext): Promise<{ removed: number; bytes: number }> {
    return this.clearCache(ctx, undefined, MAIL_CACHE_BYTES)
  }

  /** One bounded maintenance batch, scheduled after window creation, never on its critical path. */
  async recover(ctx: MailContext, cursor?: string): Promise<{ removed: number; nextCursor: string | null }> {
    const page = await this.repo.page<StoredMailAsset>(ctx, "assets", { cursor, limit: 100 })
    let removed = 0
    for (const row of page.items) {
      const staleStaging = (row.data.asset.state === "staged" || (!row.data.cache && row.data.asset.state === "ready"))
        && Date.now() - Date.parse(row.data.accessedAt) > 24 * 60 * 60_000
      if (row.data.pins === 0 && (staleStaging || row.data.asset.state === "delete-pending")) {
        await this.remove(ctx, row.id, row.data.cache)
        removed++
      }
    }
    return { removed, nextCursor: page.nextCursor }
  }
}
