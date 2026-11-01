import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { Prisma } from "@prisma/client"
import type { CloudField } from "@synapse/shared"
import type { CloudQuery } from "./cloud-table-contract"
import { fail, validateValue } from "./cloud-table-validation"

type Sort = { expression: Prisma.Sql; direction: "asc" | "desc"; timestamp: boolean }
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(",")}}`
  return JSON.stringify(value)
}
export function queryPlan(tableId: string, fields: CloudField[], query: CloudQuery, identity: string, schemaVersion: number, secret: string) {
  const active = fields.filter(f => !f.archivedAt)
  function column(key: string): { expression: Prisma.Sql; field: CloudField; timestamp: boolean } {
    if (["$id", "$createdAt", "$updatedAt", "$creatorUserId"].includes(key)) {
      const name = key.slice(1)
      return { expression: Prisma.sql`r.${Prisma.raw(`"${name}"`)}`, field: { key, name, type: "text" }, timestamp: name.endsWith("At") }
    }
    const field = active.find(f => f.key === key)
    if (!field || field.type === "json" || field.type === "multiSelect") fail("INVALID_QUERY", "不支持该字段的筛选或排序。")
    const raw = Prisma.sql`(r."values" ->> ${key})`
    const expression = ["integer", "number"].includes(field.type) ? Prisma.sql`(${raw})::numeric` : field.type === "boolean" ? Prisma.sql`(${raw})::boolean` : Prisma.sql`${raw} COLLATE "C"`
    return { expression, field, timestamp: false }
  }
  const filters = query.filters.map(filter => {
    const c = column(filter.field), x = c.expression
    const scalar = (value: unknown) => {
      if (c.timestamp) { if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail("INVALID_QUERY", "时间筛选无效。"); return Prisma.sql`${value}::timestamp` }
      validateValue({ ...c.field, required: false }, value)
      if (c.field.type === "datetime" && typeof value === "string") return Prisma.sql`${new Date(value).toISOString()}`
      return Prisma.sql`${value}`
    }
    if (filter.op === "in") {
      if (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > 100) fail("INVALID_QUERY", "集合筛选需要1至100个值。")
      return Prisma.sql`(${Prisma.join(filter.value.map(v => Prisma.sql`${x} IS NOT DISTINCT FROM ${scalar(v)}`), " OR ")})`
    }
    const value = scalar(filter.value)
    if (filter.op === "eq" && filter.value !== null && !filter.field.startsWith("$")) {
      const normalized = c.field.type === "datetime" && typeof filter.value === "string" ? new Date(filter.value).toISOString() : filter.value
      return Prisma.sql`r."values" @> ${JSON.stringify({ [filter.field]: normalized })}::jsonb`
    }
    if (filter.op === "eq" || filter.op === "ne") return Prisma.sql`${x} IS ${Prisma.raw(filter.op === "ne" ? "DISTINCT" : "NOT DISTINCT")} FROM ${value}`
    if (filter.value === null) fail("INVALID_QUERY", "范围或文本筛选不能使用空值。")
    if (filter.op === "contains") {
      if (c.timestamp || !["text", "url"].includes(c.field.type) || typeof filter.value !== "string") fail("INVALID_QUERY", "仅文本字段支持包含筛选。")
      return Prisma.sql`position(${filter.value} in ${x}) > 0`
    }
    if (c.field.type === "boolean" || c.field.type === "singleSelect") fail("INVALID_QUERY", "该字段不支持范围筛选。")
    const operator = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[filter.op]
    return Prisma.sql`${x} ${Prisma.raw(operator)} ${value}`
  })
  const sortInput = query.sort.length ? query.sort : [{ field: "$createdAt", direction: "asc" as const }]
  if (new Set(sortInput.map(s => s.field)).size !== sortInput.length) fail("INVALID_QUERY", "排序字段不能重复。")
  const sorts: Sort[] = sortInput.filter(s => s.field !== "$id").map(s => ({ ...column(s.field), direction: s.direction }))
  sorts.push({ ...column("$id"), direction: sortInput.find(s => s.field === "$id")?.direction ?? "asc" })
  const binding = createHash("sha256").update(stableJson({ tableId, identity, schemaVersion, filters: query.filters, sort: sortInput })).digest("hex")
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
    filter: Prisma.sql`${Prisma.join([...filters, cursorCondition], " AND ")}`,
    order: Prisma.join(sorts.map(s => Prisma.sql`${s.expression} ${Prisma.raw(s.direction.toUpperCase())} NULLS LAST`)),
    projection: Prisma.sql`jsonb_build_array(${Prisma.join(sorts.map(s => s.expression))}) AS "sortValues"`, encode,
  }
}
