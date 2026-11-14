import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import type { CloudField } from "@synapse/shared"
import type { CloudFilter, CloudQuery } from "./cloud-table-contract"
import { fail, validateValue } from "./cloud-table-validation"

type Sort = { expression: Prisma.Sql; direction: "asc" | "desc"; timestamp: boolean }
const systemTimestamp = z.iso.datetime({ offset: true }).refine(value => !value.startsWith("0000-") && !/\.\d{4}/u.test(value))
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(",")}}`
  return JSON.stringify(value)
}
function column(fields: CloudField[], key: string): { expression: Prisma.Sql; field: CloudField; timestamp: boolean } {
  if (["$id", "$createdAt", "$updatedAt", "$creatorUserId"].includes(key)) {
    const name = key.slice(1)
    return { expression: Prisma.sql`r.${Prisma.raw(`"${name}"`)}`, field: { key, name, type: "text" }, timestamp: name.endsWith("At") }
  }
  const field = fields.find(f => !f.archivedAt && f.key === key)
  if (!field || field.type === "json" || field.type === "multiSelect") fail("INVALID_QUERY", "不支持该字段的筛选或排序。")
  const raw = Prisma.sql`(r."values" ->> ${key})`
  const expression = ["integer", "number"].includes(field.type) ? Prisma.sql`(${raw})::numeric` : field.type === "boolean" ? Prisma.sql`(${raw})::boolean` : Prisma.sql`${raw} COLLATE "C"`
  return { expression, field, timestamp: false }
}
export function filterPlan(fields: CloudField[], query: CloudFilter): Prisma.Sql {
  const filters = query.filters.map(filter => {
    const c = column(fields, filter.field), x = c.expression
    const scalar = (value: unknown) => {
      if (c.timestamp) { const parsed = systemTimestamp.safeParse(value); if (!parsed.success) fail("INVALID_QUERY", "系统时间筛选需要有效的ISO时间及UTC或时区偏移。"); return Prisma.sql`${new Date(parsed.data).toISOString()}::timestamp` }
      validateValue({ ...c.field, required: false }, value)
      if (c.field.type === "datetime" && typeof value === "string") return Prisma.sql`${new Date(value).toISOString()}`
      return Prisma.sql`${value}`
    }
    const equal = (candidate: unknown) => {
      const value = scalar(candidate)
      if (candidate !== null && !filter.field.startsWith("$")) {
        const normalized = c.field.type === "datetime" && typeof candidate === "string" ? new Date(candidate).toISOString() : candidate
        return Prisma.sql`r."values" @> ${JSON.stringify({ [filter.field]: normalized })}::jsonb`
      }
      return Prisma.sql`${x} IS NOT DISTINCT FROM ${value}`
    }
    if (filter.op === "in") {
      if (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > 100) fail("INVALID_QUERY", "集合筛选需要1至100个值。")
      return Prisma.sql`(${Prisma.join(filter.value.map(equal), " OR ")})`
    }
    if (filter.op === "contains") {
      if (c.timestamp || !["text", "url"].includes(c.field.type) || typeof filter.value !== "string") fail("INVALID_QUERY", "仅文本字段支持包含筛选。")
      return Prisma.sql`position(${filter.value} in (${x})) > 0`
    }
    if (filter.op === "eq") return equal(filter.value)
    const value = scalar(filter.value)
    if (filter.op === "ne") return Prisma.sql`${x} IS DISTINCT FROM ${value}`
    if (filter.value === null) fail("INVALID_QUERY", "范围或文本筛选不能使用空值。")
    if (c.field.type === "boolean" || c.field.type === "singleSelect") fail("INVALID_QUERY", "该字段不支持范围筛选。")
    const operator = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[filter.op]
    return Prisma.sql`${x} ${Prisma.raw(operator)} ${value}`
  })
  return filters.length ? Prisma.sql`(${Prisma.join(filters, query.filterMode === "any" ? " OR " : " AND ")})` : Prisma.sql`TRUE`
}
export function queryPlan(tableId: string, fields: CloudField[], query: CloudQuery, identity: string, schemaVersion: number, secret: string) {
  const filter = filterPlan(fields, query)
  if (query.fields?.some(key => !fields.some(f => !f.archivedAt && f.key === key))) fail("INVALID_QUERY", "返回字段必须是活动业务字段。")
  const values = query.fields === undefined ? Prisma.sql`r."values"` : query.fields.length === 0 ? Prisma.sql`'{}'::jsonb` : Prisma.sql`(SELECT jsonb_object_agg(k, r."values" -> k) FROM unnest(ARRAY[${Prisma.join(query.fields)}]::text[]) AS selected(k))`
  const sortInput = query.sort.length ? query.sort : [{ field: "$createdAt", direction: "asc" as const }]
  if (new Set(sortInput.map(s => s.field)).size !== sortInput.length) fail("INVALID_QUERY", "排序字段不能重复。")
  const sorts: Sort[] = sortInput.map(s => ({ ...column(fields, s.field), direction: s.direction }))
  const idIndex = sortInput.findIndex(s => s.field === "$id")
  if (idIndex < 0) sorts.push({ ...column(fields, "$id"), direction: "asc" })
  const binding = createHash("sha256").update(stableJson({ tableId, identity, schemaVersion, filters: query.filters, sort: sortInput, ...(idIndex >= 0 && idIndex < sortInput.length - 1 ? { sortVersion: 2 } : {}), ...(query.filterMode === "any" ? { filterMode: "any" } : {}), ...(query.fields === undefined ? {} : { fields: query.fields }) })).digest("hex")
  function encode(values: unknown[]): string {
    const data = Buffer.from(JSON.stringify({ binding, values })).toString("base64url")
    return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`
  }
  let cursorCondition = Prisma.sql`TRUE`
  if (query.cursor) {
    try {
      const [data, signature, extra] = query.cursor.split(".")
      if (!data || !signature || extra) throw new Error("cursor")
      const expected = createHmac("sha256", secret).update(data).digest()
      const actual = Buffer.from(signature, "base64url")
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("cursor")
      const parsed = JSON.parse(Buffer.from(data, "base64url").toString()) as { binding: string; values: unknown[] }
      if (parsed.binding !== binding || !Array.isArray(parsed.values) || parsed.values.length !== sorts.length) throw new Error("cursor")
      const terms = sorts.map((sort, index) => {
        const value = parsed.values[index], x = sort.expression
        const param = sort.timestamp ? Prisma.sql`${value}::timestamp` : Prisma.sql`${value}`
        const equalPrefix = sorts.slice(0, index).map((prev, i) => Prisma.sql`${prev.expression} IS NOT DISTINCT FROM ${prev.timestamp ? Prisma.sql`${parsed.values[i]}::timestamp` : Prisma.sql`${parsed.values[i]}`}`)
        const advance = value === null ? Prisma.sql`FALSE` : Prisma.sql`(${x} ${Prisma.raw(sort.direction === "asc" ? ">" : "<")} ${param} OR ${x} IS NULL)`
        return Prisma.sql`(${Prisma.join([...equalPrefix, advance], " AND ")})`
      })
      cursorCondition = Prisma.sql`(${Prisma.join(terms, " OR ")})`
    } catch { fail("INVALID_CURSOR", "游标无效或查询条件已变化。") }
  }
  return {
    filter: Prisma.sql`${filter} AND ${cursorCondition}`,
    values: Prisma.sql`${values} AS "values"`,
    order: Prisma.join(sorts.map(s => Prisma.sql`${s.expression} ${Prisma.raw(s.direction.toUpperCase())} NULLS LAST`)),
    projection: Prisma.sql`jsonb_build_array(${Prisma.join(sorts.map(s => s.expression))}) AS "sortValues"`, encode,
  }
}
