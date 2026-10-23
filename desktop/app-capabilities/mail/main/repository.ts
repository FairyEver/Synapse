import { createHash } from "node:crypto"
import type { DataRepository } from "../../../electron/runtime/data-repo"
import type { MailEntity, MailRecord } from "../../../electron/runtime/data-repo/schemas/mail"
import { MailError, type MailContext, type Page } from "../shared/types"
import { MAIL_SEARCH_TTL_MS } from "../shared/limits"

export class MailRepository {
  constructor(readonly storage: DataRepository, private readonly assertCurrent: (ctx: MailContext) => void) {}
  private current(ctx: MailContext): void { ctx.signal.throwIfAborted(); this.assertCurrent(ctx) }
  private namespace(entity: MailEntity) { return this.storage.namespace<MailRecord>(`app.mail.${entity}`) }

  async get<T extends Record<string, unknown>>(ctx: MailContext, entity: MailEntity, id: string): Promise<MailRecord<T>> {
    this.current(ctx)
    const row = await this.namespace(entity).get(id)
    this.current(ctx)
    if (!row || row.ownerId !== ctx.ownerId) throw new MailError("UNAVAILABLE", "目标不存在或无法访问")
    return row as MailRecord<T>
  }

  async find<T extends Record<string, unknown>>(ctx: MailContext, entity: MailEntity, id: string): Promise<MailRecord<T> | null> {
    try { return await this.get<T>(ctx, entity, id) } catch (error) {
      if (error instanceof MailError && error.code === "UNAVAILABLE") return null
      throw error
    }
  }

  async save<T extends Record<string, unknown>>(ctx: MailContext, entity: MailEntity, id: string, accountId: string, data: T, expectedRevision: number, sortKey = id): Promise<MailRecord<T>> {
    this.current(ctx)
    const current = await this.namespace(entity).get(id)
    this.current(ctx)
    if (current && current.ownerId !== ctx.ownerId) throw new MailError("UNAVAILABLE", "目标不存在或无法访问")
    if ((current?.revision ?? 0) !== expectedRevision) throw new MailError("VERSION_CONFLICT", "内容已被修改，请重新读取")
    const row: MailRecord<T> = { id, schemaVersion: 1, ownerId: ctx.ownerId, accountId, revision: expectedRevision + 1, sortKey: sortKey.endsWith(id) ? sortKey : `${sortKey}:${id}`, data }
    if (entity === "credentials") {
      // Account lifecycle serializes encrypted credential writes; no database transaction crosses secret IO.
      await this.namespace(entity).upsert(row)
    } else {
      const { id: _id, ...patch } = row
      const result = await this.storage.commitBatch!({
        guards: current ? [{ namespace: `app.mail.${entity}`, id, expected: { ownerId: ctx.ownerId, revision: expectedRevision } }] : [],
        operations: [current ? { kind: "patch", namespace: `app.mail.${entity}`, id, patch } : { kind: "insert", namespace: `app.mail.${entity}`, id, value: row }],
      })
      if (!result.committed) throw new MailError("VERSION_CONFLICT", "内容已被修改，请重新读取")
    }
    this.current(ctx)
    return row
  }

  async remove(ctx: MailContext, entity: MailEntity, id: string, expectedRevision?: number): Promise<void> {
    const row = await this.get(ctx, entity, id)
    if (expectedRevision !== undefined && row.revision !== expectedRevision) throw new MailError("VERSION_CONFLICT", "内容已被修改")
    this.current(ctx)
    if (entity === "credentials") await this.namespace(entity).remove(id)
    else {
      const result = await this.storage.commitBatch!({ guards: [{ namespace: `app.mail.${entity}`, id, expected: { ownerId: ctx.ownerId, revision: row.revision } }], operations: [{ kind: "remove", namespace: `app.mail.${entity}`, id }] })
      if (!result.committed) throw new MailError("VERSION_CONFLICT", "内容已被修改")
    }
  }

  async page<T extends Record<string, unknown>>(ctx: MailContext, entity: MailEntity, input: { accountId?: string; cursor?: string; limit?: number; binding?: string }): Promise<Page<MailRecord<T>>> {
    this.current(ctx)
    const limit = Math.min(100, input.limit ?? 50)
    const scope = createHash("sha256").update(JSON.stringify([ctx.ownerId, ctx.generation, entity, input.accountId, input.binding])).digest("hex")
    let after: string | undefined
    let expiresAt = Date.now() + MAIL_SEARCH_TTL_MS
    if (input.cursor) {
      try {
        const cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString()) as { scope: string; after: string; expiresAt: number }
        if (cursor.scope !== scope || typeof cursor.after !== "string" || !Number.isFinite(cursor.expiresAt) || cursor.expiresAt <= Date.now()) throw new Error("scope")
        after = cursor.after
        expiresAt = cursor.expiresAt
      } catch { throw new MailError("CURSOR_EXPIRED", "查询条件已变化，请重新查询") }
    }
    const query = this.namespace(entity).queryRange
    if (!query) throw new MailError("UNSUPPORTED", "此存储不支持分页")
    const rows = await query.call(this.namespace(entity), { index: input.accountId ? "owner_account_sort" : "owner_sort", equal: { ownerId: ctx.ownerId, ...(input.accountId ? { accountId: input.accountId } : {}) }, ...(after ? { range: { field: "sortKey", gt: after } } : {}), direction: "asc", limit })
    this.current(ctx)
    return { items: rows as MailRecord<T>[], nextCursor: rows.length === limit ? Buffer.from(JSON.stringify({ scope, after: rows.at(-1)!.sortKey, expiresAt })).toString("base64url") : null }
  }
}
