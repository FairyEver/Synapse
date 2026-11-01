import { Injectable, Optional } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { Prisma, type CloudTable, type CloudTableRecord } from "@prisma/client"
import { PinoLogger } from "nestjs-pino"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { CloudAction, CloudField, CloudMember, CloudRange, CloudTableDto } from "@synapse/shared"
import { CloudTableMaintenance } from "./cloud-table-maintenance"
import { CloudTableDatabase } from "./cloud-table-database"
import { CloudTableScheduler } from "./cloud-table-scheduler"
import { authorize, assertJsonBudget, fail, normalizeValues, validateFields } from "./cloud-table-validation"
import { batchSchema, createTableSchema, permissionsSchema, querySchema, recordCreateSchema, recordUpdateSchema, tableChangeSchema, deleteRecordSchema, CLOUD_TABLE_SCHEMA_BYTES } from "./cloud-table-contract"
import { queryPlan, stableJson } from "./cloud-table-query"
import { OpenApiHttpError } from "../open-api/open-api.types"

export type CloudActor = { userId?: string; apiKeyId?: string; console: boolean }
export type CloudContext = { requestId: string; idempotencyKey?: string; signal?: AbortSignal }
type Tx = Prisma.TransactionClient
type Table = CloudTable & { fields: { key: string; definition: Prisma.JsonValue; archivedAt: Date | null; position: number }[] }
const retentionMs = 30 * 86400000
const json = (value: unknown) => value as Prisma.InputJsonValue
const parse = <T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, input: unknown): T => { const r = schema.safeParse(input); if (!r.success) fail("INVALID_REQUEST", "请求参数无效。"); return r.data! }
const selectRow = { id: true, tableId: true, values: true, creatorUserId: true, version: true, createdAt: true, updatedAt: true, deletedAt: true } as const

@Injectable()
export class CloudTableService {
  private readonly maintenance: CloudTableMaintenance
  readonly scheduler: CloudTableScheduler
  readonly authentication: CloudTableScheduler
  private readonly ownerCache = new Map<string, string>()
  private readonly ownerLookups = new Map<string, Promise<string>>()
  private readonly cursorSecret = process.env.USER_ACCESS_JWT_SECRET ?? randomBytes(32).toString("hex")
  constructor(readonly db: CloudTableDatabase, @Optional() private readonly logger?: PinoLogger) {
    this.scheduler = new CloudTableScheduler(db.config)
    this.authentication = new CloudTableScheduler({ ...db.config, concurrency: db.config.authConcurrency, ownerConcurrency: Math.min(db.config.ownerConcurrency, db.config.authConcurrency) })
    this.maintenance = new CloudTableMaintenance(db, this.scheduler, logger)
  }
  /** owner不可转让，只缓存路由归属；授权、状态和scope始终在执行事务中重读。 */
  routingOwner(tableId: string): string { return this.ownerCache.get(tableId) ?? `unresolved:${tableId}` }
  resolveOwner(tableId: string): Promise<string> {
    const cached = this.ownerCache.get(tableId)
    if (cached) return Promise.resolve(cached)
    const pending = this.ownerLookups.get(tableId)
    if (pending) return pending
    const lookup = this.authentication.run(`lookup:${tableId}`, 0, () => this.db.transaction(async tx => {
      const row = await tx.cloudTable.findUnique({ where: { id: tableId }, select: { ownerId: true } })
      if (!row) fail("NOT_FOUND", "数据表不存在。", 404)
      this.rememberOwner(tableId, row.ownerId); return row.ownerId
    })).finally(() => this.ownerLookups.delete(tableId))
    this.ownerLookups.set(tableId, lookup); return lookup
  }
  private rememberOwner(tableId: string, ownerId: string): void {
    if (this.ownerCache.size >= 2048) this.ownerCache.delete(this.ownerCache.keys().next().value!)
    this.ownerCache.set(tableId, ownerId)
  }
  async execute(actor: CloudActor, tableId: string | null, operation: string, input: unknown, context: CloudContext): Promise<unknown> {
    assertJsonBudget(input)
    const bytes = Buffer.byteLength(JSON.stringify(input ?? {}))
    if (bytes > 1048576) fail("REQUEST_TOO_LARGE", "请求不能超过1 MiB。", 413)
    const ownerId = tableId ? await this.resolveOwner(tableId) : actor.userId
    if (!ownerId) fail("INVALID_API_KEY", "此操作需要有效身份。", 401)
    const cost = operation === "records.batch" ? Math.ceil(((input as { operations?: unknown[] })?.operations?.length ?? 1) / 10) : 1
    return this.scheduler.run(ownerId, bytes, async () => {
      const started = Date.now(); let status = 200, loggedTableId = tableId
      try {
        const result = await this.db.transaction(tx => this.perform(tx, actor, tableId, operation, input ?? {}, context))
        if (operation === "table.create" && result && typeof result === "object" && "id" in result) { loggedTableId = String(result.id); this.rememberOwner(loggedTableId, ownerId) }
        return result
      }
      catch (e) { status = e instanceof OpenApiHttpError ? e.statusCode : 500; throw e }
      finally {
        try { await this.db.transaction(tx => tx.cloudTableOperationLog.create({ data: { ownerId, tableId: loggedTableId, actorId: actor.userId ?? null, apiKeyId: actor.apiKeyId ?? null, requestId: context.requestId, operation, status, durationMs: Date.now() - started } })) }
        catch (error) { this.logger?.warn({ requestId: context.requestId, errorName: error instanceof Error ? error.name : typeof error }, "Cloud table operation log failed") }
      }
    }, context.signal, cost)
  }
  private async identity(tx: Tx, actor: CloudActor) {
    if (!actor.userId) return null
    const users = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "User" WHERE "id" = ${actor.userId} FOR SHARE`
    if (users[0]?.status !== "active") fail("INVALID_API_KEY", "身份已失效。", 401)
    if (!actor.apiKeyId) { if (!actor.console) fail("INVALID_API_KEY", "缺少密钥。", 401); return null }
    const rows = await tx.$queryRaw<{ userId: string; scopes: string[]; revokedAt: Date | null; tableAccessMode: string; tableIds: string[] }[]>`SELECT "userId", "scopes", "revokedAt", "tableAccessMode", "tableIds" FROM "UserApiKey" WHERE "id" = ${actor.apiKeyId} FOR SHARE`
    const key = rows[0]
    if (!key || key.revokedAt || key.userId !== actor.userId) fail("INVALID_API_KEY", "密钥已失效。", 401)
    return key
  }
  private fields(table: Table): CloudField[] { return table.fields.map(f => ({ ...(f.definition as unknown as CloudField), archivedAt: f.archivedAt?.toISOString() ?? null })) }
  private access(table: Table) { return { ownerId: table.ownerId, anonymous: table.anonymous as Partial<Record<CloudAction, boolean>>, members: table.members as unknown as CloudMember[] } }
  private dto(table: Table, actor: CloudActor, scopes?: string[]): CloudTableDto {
    const permissions = {} as Record<CloudAction | "manage", CloudRange>
    for (const a of ["read", "create", "update", "delete", "manage"] as const) {
      try { permissions[a] = scopes && !scopes.includes(a === "manage" ? "tables.manage" : `tables.records.${a}`) ? "none" : authorize(this.access(table), actor.userId ?? null, a) } catch { permissions[a] = "none" }
    }
    return { id: table.id, ownerId: table.ownerId, ...(actor.userId ? { viewerId: actor.userId } : {}), name: table.name, schemaVersion: table.schemaVersion, fields: this.fields(table), anonymous: table.anonymous as Partial<Record<CloudAction, boolean>>, ...(actor.userId === table.ownerId ? { members: table.members as unknown as CloudMember[] } : {}), deletedAt: table.deletedAt?.toISOString() ?? null, createdAt: table.createdAt.toISOString(), permissions }
  }
  private async perform(tx: Tx, actor: CloudActor, tableId: string | null, op: string, input: unknown, ctx: CloudContext): Promise<unknown> {
    const key = await this.identity(tx, actor)
    const scope = (action: CloudAction | "manage") => {
      if (key && !key.scopes.includes(action === "manage" ? "tables.manage" : `tables.records.${action}`)) fail("INSUFFICIENT_SCOPE", "密钥缺少所需权限。", 403)
    }
    if (!tableId) {
      if (!actor.userId) fail("INVALID_API_KEY", "需要有效身份。", 401)
      if (op === "table.create") {
        scope("manage")
        if (key && key.tableAccessMode !== "all_owned") fail("INSUFFICIENT_SCOPE", "建表需要自己的全部表管理权限。", 403)
        const data = parse(createTableSchema, input); validateFields(data.fields)
        const namespace = `${actor.apiKeyId ?? actor.userId}:table.create`, fingerprint = createHash("sha256").update(stableJson(input)).digest("hex")
        const replay = await this.receipt(tx, namespace, ctx.idempotencyKey, fingerprint)
        if (replay !== undefined) return replay
        const table = await tx.cloudTable.create({ data: { ownerId: actor.userId, name: data.name, fields: { create: data.fields.map((f, i) => ({ key: f.key, definition: json(f), position: i })) } }, include: { fields: true } })
        const result = { id: table.id, schemaVersion: table.schemaVersion }
        if (ctx.idempotencyKey) await tx.cloudTableReceipt.create({ data: { tableId: table.id, namespace, key: ctx.idempotencyKey, fingerprint, result: json(result) } })
        return result
      }
      if (op !== "table.list" && op !== "table.trash") fail("INVALID_OPERATION", "操作不存在。", 404)
      if (key && !key.scopes.some(s => s.startsWith("tables."))) fail("INSUFFICIENT_SCOPE", "密钥缺少数据表权限。", 403)
      const cursor = typeof (input as { cursor?: unknown }).cursor === "string" ? (input as { cursor: string }).cursor : undefined
      const tables = await tx.cloudTable.findMany({ where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        deletedAt: op === "table.trash" ? { gte: new Date(Date.now() - retentionMs) } : null,
        OR: op === "table.trash" ? [{ ownerId: actor.userId }] : [{ ownerId: actor.userId }, { members: { array_contains: [{ userId: actor.userId }] } }],
        ...(key ? key.tableAccessMode === "all_owned" ? { ownerId: actor.userId } : { id: { ...(cursor ? { gt: cursor } : {}), in: key.tableIds } } : {}),
      }, orderBy: { id: "asc" }, take: 51 })
      return { data: tables.slice(0, 50).map(t => { const { fields: _fields, members: _members, anonymous: _anonymous, ...summary } = this.dto({ ...t, fields: [] }, actor, key?.scopes); return summary }), nextCursor: tables.length > 50 ? tables[49]!.id : null }
    }
    const exclusive = ["table.update", "permissions", "table.delete", "table.restore"].includes(op)
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CloudTable" WHERE "id" = ${tableId} ${Prisma.raw(exclusive ? "FOR UPDATE" : "FOR SHARE")}`)
    const storedTable = await tx.cloudTable.findUnique({ where: { id: tableId } })
    if (!storedTable || (storedTable.deletedAt && op !== "table.restore") || (storedTable.deletedAt && storedTable.deletedAt.getTime() < Date.now() - retentionMs)) fail("NOT_FOUND", "数据表不存在。", 404)
    const table: Table = { ...storedTable, fields: [] }
    const owner = await tx.user.findUnique({ where: { id: table.ownerId }, select: { status: true } })
    if (owner?.status !== "active") fail("NOT_FOUND", "数据表不可用。", 404)
    if (key && !(key.tableAccessMode === "all_owned" && table.ownerId === actor.userId) && !(key.tableAccessMode === "selected" && key.tableIds.includes(tableId))) fail("INSUFFICIENT_SCOPE", "密钥未授权此表。", 403)
    const permission = (action: CloudAction | "manage") => { scope(action); return authorize(this.access(table), actor.userId ?? null, action) }
    const describing = op === "table.get" || op === "schema"
    if (describing) {
      if (!actor.userId) { if (!Object.values(table.anonymous as object).some(Boolean)) fail("FORBIDDEN", "表未开放匿名操作。", 403) }
      else if (!["manage", "read", "create", "update", "delete"].some(a => { try { permission(a as CloudAction | "manage"); return true } catch { return false } })) fail("FORBIDDEN", "没有访问此表的权限。", 403)
    }
    const fieldActions: Partial<Record<string, CloudAction | "manage">> = { "table.update": "manage", "records.get": "read", "records.query": "read", "records.create": "create", "records.update": "update", "records.restore": "manage", "records.trash": "manage" }; const fieldAction = fieldActions[op]
    if (fieldAction) permission(fieldAction)
    if (op === "records.batch") for (const action of parse(batchSchema, input).operations) permission(action.action)
    if (describing || fieldAction || op === "records.batch") {
      const archived = (describing && actor.userId === table.ownerId) || op === "table.update"
      table.fields = await tx.cloudTableField.findMany({ where: { tableId, ...(archived ? {} : { archivedAt: null }) }, orderBy: { position: "asc" }, take: 100 })
    }
    const fields = this.fields(table)
    if (op === "member.search") {
      if (!actor.console) fail("FORBIDDEN", "用户搜索仅供登录后的控制台使用。", 403)
      permission("manage")
      const query = (input as { query?: unknown }).query
      if (typeof query !== "string" || !query.trim() || query.length > 320) fail("INVALID_REQUEST", "请输入邮箱、用户名或昵称，最多320个字符。")
      const term = query.trim().replace(/[\\%_]/gu, "\\$&")
      const users = await tx.user.findMany({
        where: { status: "active", id: { not: table.ownerId }, OR: ["email", "handle", "nickname"].map(field => ({ [field]: { contains: term, mode: "insensitive" as const } })) },
        select: { id: true, handle: true, nickname: true }, orderBy: [{ handle: "asc" }, { id: "asc" }], take: 21,
      })
      return { data: users.slice(0, 20), hasMore: users.length > 20 }
    }
    if (op === "member.resolve") {
      permission("manage")
      const handle = (input as { handle?: unknown }).handle
      if (typeof handle !== "string" || !handle.trim() || handle.length > 64) fail("INVALID_REQUEST", "请输入有效的SY用户名。")
      const user = await tx.user.findUnique({ where: { handle: handle.trim() }, select: { id: true, handle: true, status: true } })
      if (!user || user.status !== "active") fail("NOT_FOUND", "用户不存在。", 404)
      return { id: user.id, handle: user.handle }
    }
    if (op === "table.get" || op === "schema") {
      if (!actor.userId) {
        if (!Object.values(table.anonymous as object).some(Boolean)) fail("FORBIDDEN", "表未开放匿名操作。", 403)
        return { id: table.id, schemaVersion: table.schemaVersion, fields: fields.filter(f => !f.archivedAt).map(({ archivedAt: _a, ...f }) => f) }
      }
      const allowed = ["manage", "read", "create", "update", "delete"].some(a => { try { permission(a as CloudAction | "manage"); return true } catch { return false } })
      if (!allowed) fail("FORBIDDEN", "没有访问此表的权限。", 403)
      return this.dto(table, actor, key?.scopes)
    }
    if (op === "table.update") {
      permission("manage"); const change = parse(tableChangeSchema, input)
      if (table.schemaVersion !== change.version) fail("VERSION_CONFLICT", "表结构已变化，请刷新。", 409)
      if (change.fields) {
        validateFields(change.fields)
        if (fields.length + change.fields.filter(f => !fields.some(old => old.key === f.key)).length > 100) fail("INVALID_FIELDS", "每表含待清理的归档字段最多100个。")
        const retained = new Map(fields.map(({ archivedAt: _a, ...f }) => [f.key, f]))
        for (const f of change.fields) retained.set(f.key, f)
        if (Buffer.byteLength(JSON.stringify([...retained.values()])) > CLOUD_TABLE_SCHEMA_BYTES) fail("SCHEMA_TOO_LARGE", "含归档字段的定义总量不能超过1 MiB。")
        const hasRows = Boolean(await tx.cloudTableRecord.findFirst({ where: { tableId }, select: { id: true } }))
        for (const [position, next] of change.fields.entries()) {
          const prev = fields.find(f => f.key === next.key)
          if (prev?.archivedAt && Date.parse(prev.archivedAt) < Date.now() - retentionMs) fail("FIELD_EXPIRED", "字段已过恢复期，不能复用标识。", 409)
          if (!prev && next.required && hasRows) fail("INCOMPATIBLE_SCHEMA", "已有记录时请先添加可选字段。", 409)
          if (prev) {
            const removesOptions = prev.options?.some(o => !next.options?.some(n => n.key === o.key))
            if (prev.type !== next.type || removesOptions) {
              const used = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CloudTableRecord" WHERE "tableId" = ${tableId} AND "values" -> ${next.key} IS NOT NULL AND "values" -> ${next.key} <> 'null'::jsonb LIMIT 1`
              if (used.length) fail("INCOMPATIBLE_SCHEMA", "字段已有数据，不能改变类型或移除选项。", 409)
            }
            if (next.required && (!prev.required || Boolean(prev.archivedAt))) {
              const empty = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CloudTableRecord" WHERE "tableId" = ${tableId} AND ("values" -> ${next.key} IS NULL OR "values" -> ${next.key} = 'null'::jsonb) LIMIT 1`
              if (empty.length) fail("INCOMPATIBLE_SCHEMA", "已有记录为空，不能设为必填。", 409)
            }
          }
          await tx.cloudTableField.upsert({ where: { tableId_key: { tableId, key: next.key } }, create: { tableId, key: next.key, definition: json(next), position }, update: { definition: json(next), position, archivedAt: null } })
        }
        await tx.cloudTableField.updateMany({ where: { tableId, archivedAt: null, key: { notIn: change.fields.map(f => f.key) } }, data: { archivedAt: new Date() } })
      }
      await tx.cloudTable.update({ where: { id: tableId }, data: { name: change.name, schemaVersion: { increment: 1 } } })
      return this.dto((await tx.cloudTable.findUniqueOrThrow({ where: { id: tableId }, include: { fields: { orderBy: { position: "asc" } } } })), actor, key?.scopes)
    }
    if (op === "permissions") {
      permission("manage"); const change = parse(permissionsSchema, input)
      if (table.schemaVersion !== change.version) fail("VERSION_CONFLICT", "权限已变化，请刷新。", 409)
      if (new Set(change.members.map(m => m.userId)).size !== change.members.length || change.members.some(m => m.userId === table.ownerId)) fail("INVALID_MEMBERS", "协作者重复或包含表主。")
      const users = await tx.user.findMany({ where: { id: { in: change.members.map(m => m.userId) }, status: "active" }, select: { id: true, handle: true, nickname: true }, take: 100 })
      if (users.length !== change.members.length) fail("INVALID_MEMBERS", "协作者账号不存在或已停用。")
      const members = change.members.map(m => { const user = users.find(u => u.id === m.userId)!; return { ...m, handle: user.handle, nickname: user.nickname } })
      await tx.cloudTable.update({ where: { id: tableId }, data: { anonymous: change.anonymous, members, schemaVersion: { increment: 1 } } })
      return { schemaVersion: table.schemaVersion + 1 }
    }
    if (op === "table.delete" || op === "table.restore") {
      permission("manage")
      if (op === "table.delete" && parse(deleteRecordSchema, input).version !== table.schemaVersion) fail("VERSION_CONFLICT", "表已变化。", 409)
      await tx.cloudTable.update({ where: { id: tableId }, data: { deletedAt: op === "table.delete" ? new Date() : null, ...(op === "table.restore" ? { anonymous: {} } : {}), schemaVersion: { increment: 1 } } })
      return { id: tableId, schemaVersion: table.schemaVersion + 1 }
    }
    if (op === "logs") {
      permission("manage")
      const after = typeof (input as { cursor?: unknown }).cursor === "string" ? (input as { cursor: string }).cursor : undefined
      const rows = await tx.cloudTableOperationLog.findMany({ where: { ownerId: table.ownerId, tableId, ...(after ? { id: { lt: after } } : {}) }, orderBy: { id: "desc" }, take: 51 })
      return { data: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null }
    }
    const rowAccess = async (id: string, action: CloudAction, deleted = false) => {
      const range = permission(action)
      const row = await tx.cloudTableRecord.findFirst({ where: { tableId, id, ...(deleted ? {} : { deletedAt: null }), ...(range === "own" ? { creatorUserId: actor.userId ?? "__anonymous_never_owns__" } : {}) }, select: selectRow })
      if (!row) fail("NOT_FOUND", "记录不存在。", 404)
      return row
    }
    if (op === "records.get") return this.recordDto(await rowAccess((input as { id: string }).id, "read"), fields)
    if (op === "records.query") {
      const range = permission("read"), query = parse(querySchema, input)
      const plan = queryPlan(tableId, fields, query, `${actor.userId ?? "anonymous"}:${actor.apiKeyId ?? "console"}`, table.schemaVersion, this.cursorSecret)
      const rows = await tx.$queryRaw<(CloudTableRecord & { sortValues: unknown[] })[]>(Prisma.sql`SELECT r."id", r."tableId", r."values", r."creatorUserId", r."version", r."createdAt", r."updatedAt", r."deletedAt", ${plan.projection} FROM "CloudTableRecord" r WHERE r."tableId" = ${tableId} AND r."deletedAt" IS NULL AND ${range === "own" ? Prisma.sql`r."creatorUserId" = ${actor.userId}` : Prisma.sql`TRUE`} AND ${plan.filter} ORDER BY ${plan.order} LIMIT ${query.limit + 1}`)
      const data: unknown[] = []; let bytes = 0
      for (const row of rows.slice(0, query.limit)) {
        const dto = this.recordDto(row, fields), size = Buffer.byteLength(JSON.stringify(dto))
        if (data.length && bytes + size > 1048576) break
        data.push(dto); bytes += size
      }
      return { data, nextCursor: rows.length > data.length && data.length ? plan.encode(rows[data.length - 1]!.sortValues) : null }
    }
    if (op === "records.trash") {
      permission("manage")
      const cursor = (input as { cursor?: string }).cursor
      const rows = await tx.cloudTableRecord.findMany({ where: { tableId, deletedAt: { gte: new Date(Date.now() - retentionMs) }, ...(cursor ? { id: { gt: cursor } } : {}) }, select: selectRow, orderBy: { id: "asc" }, take: 51 })
      return { data: rows.slice(0, 50).map(r => this.recordDto(r, fields)), nextCursor: rows.length > 50 ? rows[49]!.id : null }
    }
    if (op === "records.restore") {
      permission("manage")
      const body = input as { id: string }, row = await tx.cloudTableRecord.findFirst({ where: { tableId, id: body.id, deletedAt: { gte: new Date(Date.now() - retentionMs) } }, select: selectRow })
      if (!row) fail("NOT_FOUND", "回收记录不存在或已过期。", 404)
      try { normalizeValues(fields, {}, row.values as Record<string, unknown>) } catch { fail("INCOMPATIBLE_SCHEMA", "记录与当前结构不兼容，请先恢复字段定义。", 409) }
      await tx.cloudTableRecord.update({ where: { id: row.id }, data: { deletedAt: null, version: { increment: 1 } } })
      return { id: row.id, version: row.version + 1 }
    }
    const operations = op === "records.batch" ? parse(batchSchema, input).operations : op === "records.create" ? [{ action: "create" as const, ...parse(recordCreateSchema, input) }] : op === "records.update" ? [{ action: "update" as const, id: (input as { id: string }).id, ...parse(recordUpdateSchema, this.withoutId(input)) }] : op === "records.delete" ? [{ action: "delete" as const, id: (input as { id: string }).id, ...parse(deleteRecordSchema, this.withoutId(input)) }] : fail("INVALID_OPERATION", "操作不存在。", 404)
    for (const operation of operations) { permission(operation.action); if (operation.action !== "create") await rowAccess(operation.id, operation.action, true) }
    const namespace = `${tableId}:${actor.apiKeyId ?? actor.userId ?? "anonymous"}:${op}`, fingerprint = createHash("sha256").update(stableJson(input)).digest("hex")
    const replay = await this.receipt(tx, namespace, ctx.idempotencyKey, fingerprint)
    if (replay !== undefined) return replay
    const results: { id: string; version: number }[] = []
    if (operations.every(operation => operation.action === "create")) {
      const data = operations.map(operation => ({ id: `ctr_${randomUUID().replaceAll("-", "")}`, tableId, values: json(normalizeValues(fields, operation.values)), creatorUserId: actor.userId ?? null, version: 1 }))
      await tx.cloudTableRecord.createMany({ data })
      results.push(...data.map(row => ({ id: row.id, version: row.version })))
    } else for (const operation of operations) {
      if (operation.action === "create") {
        const values = normalizeValues(fields, operation.values)
        const row = await tx.cloudTableRecord.create({ data: { tableId, values: json(values), creatorUserId: actor.userId ?? null }, select: { id: true, version: true } })
        results.push(row)
      } else {
        const row = await rowAccess(operation.id, operation.action)
        const values = operation.action === "update" ? normalizeValues(fields, operation.values, row.values as Record<string, unknown>) : undefined
        const changed = await tx.cloudTableRecord.updateMany({ where: { id: row.id, tableId, version: operation.version, deletedAt: null }, data: { ...(values ? { values: json(values) } : { deletedAt: new Date() }), version: { increment: 1 } } })
        if (!changed.count) fail("VERSION_CONFLICT", "记录已变化，请重新读取。", 409)
        results.push({ id: row.id, version: operation.version + 1 })
      }
    }
    const result = op === "records.batch" ? { data: results } : results[0]!
    if (ctx.idempotencyKey) await tx.cloudTableReceipt.create({ data: { tableId, namespace, key: ctx.idempotencyKey, fingerprint, result } })
    return result
  }
  private async receipt(tx: Tx, namespace: string, key: string | undefined, fingerprint: string): Promise<Prisma.JsonValue | undefined> {
    if (!key) return undefined
    if (!/^[A-Za-z0-9_-]{8,120}$/u.test(key)) fail("INVALID_IDEMPOTENCY_KEY", "幂等键格式无效。")
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`${namespace}:${key}`}, 0))`
    const receipt = await tx.cloudTableReceipt.findUnique({ where: { namespace_key: { namespace, key } } })
    if (receipt && receipt.createdAt.getTime() > Date.now() - 86400000) {
      if (receipt.fingerprint !== fingerprint) fail("IDEMPOTENCY_CONFLICT", "幂等键已用于不同请求。", 409)
      return receipt.result
    }
    if (receipt) await tx.cloudTableReceipt.delete({ where: { id: receipt.id } })
    return undefined
  }
  private withoutId(input: unknown) { const { id: _id, ...rest } = input as Record<string, unknown>; return rest }
  private recordDto(row: CloudTableRecord, fields: CloudField[]) {
    const stored = row.values as Record<string, unknown>
    return { id: row.id, values: Object.fromEntries(fields.filter(f => !f.archivedAt).map(f => [f.key, stored[f.key] ?? null])), creatorUserId: row.creatorUserId, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), deletedAt: row.deletedAt?.toISOString() ?? null }
  }
  @Cron("*/10 * * * * *")
  async cleanup(now = new Date()): Promise<void> { await this.maintenance.cleanup(now) }
  onModuleDestroy(): void { this.maintenance.close() }
}
