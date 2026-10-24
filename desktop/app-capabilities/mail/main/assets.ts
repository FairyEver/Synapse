import { randomUUID } from "node:crypto"
import type { Readable } from "node:stream"
import type { PermissionAction } from "../../../electron/runtime/security"
import type { MailRecord } from "../../../electron/runtime/data-repo/schemas/mail"
import { ManagedAssetStore, AssetSizeLimitError } from "../../../electron/runtime/data-repo/assets"
import { MAIL_CACHE_BYTES, MAIL_MAX_ATTACHMENT_BYTES } from "../shared/limits"
import { MailError, type MailAsset, type MailContext, type Page } from "../shared/types"
import { MailRepository } from "./repository"

export type MailAccess = (ctx: MailContext, action: PermissionAction, resource: string) => Promise<void>
export interface StoredMailAsset extends Record<string, unknown> {
  asset: MailAsset
  key: string | null
  pins: number
  cache: boolean
  accessedAt: string
  part?: string
}

export class MailAssets {
  private readonly leases = new Map<string, { ownerId: string; ids: Set<string> }>()
  private mutations: Promise<unknown> = Promise.resolve()
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.mutations.then(operation)
    this.mutations = task.catch(() => undefined)
    return task
  }

  hold(ctx: MailContext, key: string, accountId: string, ids: string[]): Promise<void> {
    return this.serialize(async () => {
      for (const id of ids) {
        const asset = await this.info(ctx, id)
        if (asset.accountId !== accountId || asset.state !== "ready") throw new MailError("ASSET_UNAVAILABLE", "写信附件不可用")
      }
      ctx.signal.throwIfAborted()
      this.leases.set(key, { ownerId: ctx.ownerId, ids: new Set([...(this.leases.get(key)?.ids ?? []), ...ids]) })
    })
  }
  release(key: string): void { this.leases.delete(key) }
  private leased(ctx: MailContext, id: string): boolean { return [...this.leases.values()].some(lease => lease.ownerId === ctx.ownerId && lease.ids.has(id)) }

  constructor(private readonly repo: MailRepository, private readonly files: ManagedAssetStore, private readonly access: MailAccess,
    private readonly diagnostic?: (code: string, accountId: string) => void) {}

  async put(ctx: MailContext, source: Readable, metadata: {
    accountId: string; name: string; mime: string; cid?: string; messageId?: string; attachmentId?: string; cache?: boolean; pinned?: boolean
  }, maxBytes = MAIL_MAX_ATTACHMENT_BYTES): Promise<MailAsset> {
    await this.repo.get(ctx, "accounts", metadata.accountId)
    const id = `mas_${randomUUID()}`
    await this.access(ctx, "fs.write", id)
    const asset: MailAsset = { id, accountId: metadata.accountId, name: metadata.name, mime: metadata.mime, size: 0, sha256: null, cid: metadata.cid ?? null, state: "staged", attachmentId: metadata.attachmentId ?? null, messageId: metadata.messageId ?? null }
    const data: StoredMailAsset = { asset, key: id.slice(4), pins: 0, cache: metadata.cache ?? false, accessedAt: new Date().toISOString() }
    await this.repo.save(ctx, "assets", id, metadata.accountId, data, 0)
    const stored = await this.files.put(source, maxBytes, ctx.signal, data.key!).catch(error => {
      if (error instanceof AssetSizeLimitError) throw new MailError("LIMIT_EXCEEDED", "附件超过大小上限")
      throw error
    })
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

  async materialize(ctx: MailContext, id: string, source: Readable, maxBytes = MAIL_MAX_ATTACHMENT_BYTES): Promise<MailAsset> {
    const row = await this.repo.get<StoredMailAsset>(ctx, "assets", id)
    if (row.data.asset.state === "ready") { source.destroy(); return row.data.asset }
    if (row.data.asset.state !== "remote") { source.destroy(); throw new MailError("ASSET_BUSY", "附件正在处理，请稍后重试") }
    await this.access(ctx, "fs.write", id)
    const key = randomUUID()
    const staged = await this.repo.save(ctx, "assets", id, row.accountId, { ...row.data, key, cache: true, asset: { ...row.data.asset, state: "staged" as const } }, row.revision, row.sortKey)
    let stored: Awaited<ReturnType<ManagedAssetStore["put"]>>
    try { stored = await this.files.put(source, maxBytes, ctx.signal, key) } catch (error) {
      if (!ctx.signal.aborted) {
        try { await this.repo.save(ctx, "assets", id, row.accountId, row.data, staged.revision, row.sortKey) } catch (rollback) { throw new AggregateError([error, rollback], "Attachment download and recovery failed") }
      }
      if (error instanceof AssetSizeLimitError) throw new MailError("LIMIT_EXCEEDED", "附件超过大小上限")
      throw error
    }
    const asset = { ...row.data.asset, state: "ready" as const, size: stored.size, sha256: stored.sha256 }
    try { await this.repo.save(ctx, "assets", id, row.accountId, { ...staged.data, asset }, staged.revision, row.sortKey) } catch (error) { await this.files.remove(key); throw error }
    return asset
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

  pin(ctx: MailContext, id: string, delta: number): Promise<void> {
    return this.serialize(async () => {
      const row = await this.repo.get<StoredMailAsset>(ctx, "assets", id)
      if (row.data.asset.state === "delete-pending") throw new MailError("ASSET_IN_USE", "附件正在清理")
      if (delta > 0 && (row.data.asset.state !== "ready" || !row.data.key)) throw new MailError("ASSET_UNAVAILABLE", "附件尚未下载或缓存已清理")
      const pins = row.data.pins + delta
      if (pins < 0) throw new MailError("VERSION_CONFLICT", "附件引用状态已变化")
      await this.repo.save(ctx, "assets", id, row.accountId, { ...row.data, pins }, row.revision, row.sortKey)
    })
  }

  /** Call under the account queue before cache maintenance or resuming jobs. */
  async rebuildPins(ctx: MailContext, accountId: string): Promise<void> {
    const counts = new Map<string, number>()
    for (const entity of ["drafts", "previews", "operations"] as const) {
      let cursor: string | undefined
      do {
        const page = await this.repo.page(ctx, entity, { accountId, cursor, limit: 100 })
        for (const row of page.items) if (Array.isArray(row.data.pinnedAssetIds)) {
          for (const id of new Set(row.data.pinnedAssetIds.filter((id): id is string => typeof id === "string"))) counts.set(id, (counts.get(id) ?? 0) + 1)
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor)
    }
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredMailAsset>(ctx, "assets", { accountId, cursor, limit: 100 })
      for (const row of page.items) {
        const pins = counts.get(row.id) ?? 0
        if (row.data.pins !== pins) await this.repo.save(ctx, "assets", row.id, accountId, { ...row.data, pins }, row.revision, row.sortKey)
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }

  remove(ctx: MailContext, id: string, eviction = false): Promise<void> {
    return this.serialize(() => this.removeNow(ctx, id, eviction))
  }

  private async removeNow(ctx: MailContext, id: string, eviction: boolean): Promise<void> {
    const row = await this.repo.get<StoredMailAsset>(ctx, "assets", id)
    if (!eviction && row.data.asset.messageId) throw new MailError("ASSET_IN_USE", "服务端邮件附件只能清理缓存")
    if (this.leased(ctx, id) || row.data.pins > 0 || (eviction && !row.data.cache)) throw new MailError("ASSET_IN_USE", "附件仍被草稿或发送操作使用")
    await this.access(ctx, "fs.write", id)
    const pending = await this.repo.save(ctx, "assets", id, row.accountId, { ...row.data, asset: { ...row.data.asset, state: "delete-pending" as const } }, row.revision, row.sortKey)
    if (row.data.key) await this.files.remove(row.data.key)
    if (row.data.key) await this.files.remove(row.data.key, true)
    if (eviction && row.data.asset.messageId) {
      await this.repo.save(ctx, "assets", id, row.accountId, { ...pending.data, key: null, asset: { ...row.data.asset, state: "remote" as const } }, pending.revision, row.sortKey)
    } else await this.repo.remove(ctx, "assets", id, pending.revision)
  }

  async removeAccount(ctx: MailContext, accountId: string): Promise<void> {
    await this.repo.get(ctx, "accounts", accountId)
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredMailAsset>(ctx, "assets", { accountId, cursor, limit: 100 })
      for (const row of page.items) {
        await this.access(ctx, "fs.write", row.id)
        if (row.data.key) { await this.files.remove(row.data.key); await this.files.remove(row.data.key, true) }
        await this.repo.remove(ctx, "assets", row.id, row.revision)
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }
  clearCache(ctx: MailContext, accountId?: string, budget = 0): Promise<{ removed: number; bytes: number }> {
    return this.serialize(() => this.clearCacheNow(ctx, accountId, budget))
  }

  private async clearCacheNow(ctx: MailContext, accountId: string | undefined, budget: number): Promise<{ removed: number; bytes: number }> {
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
      const page: Page<MailRecord<StoredMailAsset>> = await this.repo.page<StoredMailAsset>(ctx, "assets", { accountId, cursor, limit: 100 })
      for (const row of page.items) {
        if (remaining <= budget) break
        if (this.leased(ctx, row.id) || !row.data.cache || row.data.pins > 0 || row.data.asset.state !== "ready") continue
        await this.removeNow(ctx, row.id, true)
        remaining -= row.data.asset.size
        bytes += row.data.asset.size
        removed++
      }
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    return { removed, bytes }
  }

  async trim(ctx: MailContext): Promise<{ removed: number; bytes: number }> {
    try { return await this.clearCache(ctx, undefined, MAIL_CACHE_BYTES) }
    catch (error) {
      if (ctx.signal.aborted || !this.diagnostic) throw error
      this.diagnostic("MAIL_CACHE_CLEANUP_FAILED", "mail")
      return { removed: 0, bytes: 0 }
    }
  }

  /** One bounded maintenance batch, scheduled after window creation, never on its critical path. */
  async recover(ctx: MailContext, cursor?: string): Promise<{ removed: number; nextCursor: string | null }> {
    const page = await this.repo.page<StoredMailAsset>(ctx, "assets", { cursor, limit: 100 })
    let removed = 0
    for (const row of page.items) {
      const staleStaging = (row.data.asset.state === "staged" || (!row.data.cache && row.data.asset.state === "ready"))
        && Date.now() - Date.parse(row.data.accessedAt) > 24 * 60 * 60_000
      if (!this.leased(ctx, row.id) && row.data.pins === 0 && (staleStaging || row.data.asset.state === "delete-pending")) {
        await this.remove(ctx, row.id, row.data.cache)
        removed++
      }
    }
    return { removed, nextCursor: page.nextCursor }
  }
}
