import { DATA_REPO_ATOMIC_MAX_BYTES, DATA_REPO_RANGE_MAX_ROWS } from "../../../../config"
import { InvalidNamespaceDataError } from "../errors"
import type { DataAtomicScalar, DataRangeQuery, DataSqliteSchema } from "../types"

export function fieldSql(namespace: string, field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) throw new InvalidNamespaceDataError(namespace, "invalid indexed field")
  return field === "id" ? "id" : `json_extract(value, '$.${field}')`
}

export function indexSqlName(namespace: string, table: string, name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new InvalidNamespaceDataError(namespace, "invalid index name")
  return `idx_${table}_${name}`
}

export function scalarParam(namespace: string, value: unknown): string | number | null {
  if (value === null || typeof value === "string") return value
  if (typeof value === "boolean") return Number(value)
  if (typeof value === "number" && Number.isFinite(value)) return value
  throw new InvalidNamespaceDataError(namespace, "invalid scalar value")
}

export function validateSqliteSchema<T>(namespace: string, schema: DataSqliteSchema<T>): void {
  if (!Number.isSafeInteger(schema.maxRecordBytes) || schema.maxRecordBytes < 1 || schema.maxRecordBytes > DATA_REPO_ATOMIC_MAX_BYTES
    || !schema.fields.includes("id" as Extract<keyof T, string>) || new Set(schema.fields).size !== schema.fields.length) {
    throw new InvalidNamespaceDataError(namespace, "invalid bounded SQLite schema")
  }
  for (const field of schema.fields) fieldSql(namespace, field)
  const names = new Set<string>()
  for (const index of schema.indexes) {
    indexSqlName(namespace, "table", index.name)
    if (names.has(index.name) || index.fields.length === 0 || index.fields.length > 8
      || new Set(index.fields).size !== index.fields.length || index.fields.some((field) => !schema.fields.includes(field))) {
      throw new InvalidNamespaceDataError(namespace, "invalid SQLite index declaration")
    }
    names.add(index.name)
  }
}

export function buildRangeQuery<T>(namespace: string, table: string, schema: DataSqliteSchema<T>, query: DataRangeQuery<T>) {
  const index = schema.indexes.find((entry) => entry.name === query.index)
  if (!index || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > DATA_REPO_RANGE_MAX_ROWS
    || (query.direction !== "asc" && query.direction !== "desc")) {
    throw new InvalidNamespaceDataError(namespace, "invalid indexed range query")
  }
  const equals = Object.entries(query.equal) as Array<[Extract<keyof T, string>, DataAtomicScalar]>
  // Equality must be a full leading prefix. A range may only use the next indexed field.
  if (equals.some(([field]) => !index.fields.slice(0, equals.length).includes(field))
    || (query.range && index.fields[equals.length] !== query.range.field)) {
    throw new InvalidNamespaceDataError(namespace, "range query must follow the declared index prefix")
  }
  const clauses: string[] = []
  const params: Array<string | number | null> = []
  for (const [field, value] of equals) {
    clauses.push(`${fieldSql(namespace, field)} IS ?`)
    params.push(scalarParam(namespace, value))
  }
  const range = query.range
  if (range) {
    if ((range.gt !== undefined && range.gte !== undefined) || (range.lt !== undefined && range.lte !== undefined)) {
      throw new InvalidNamespaceDataError(namespace, "ambiguous range bounds")
    }
    for (const [key, operator] of [["gt", ">"], ["gte", ">="], ["lt", "<"], ["lte", "<="]] as const) {
      if (range[key] !== undefined) {
        clauses.push(`${fieldSql(namespace, range.field)} ${operator} ?`)
        params.push(scalarParam(namespace, range[key]))
      }
    }
  }
  const direction = query.direction === "asc" ? "ASC" : "DESC"
  const order = index.fields.slice(equals.length).map((field) => `${fieldSql(namespace, field)} ${direction}`)
  // SQLite secondary indexes include the primary rowid, but deterministic ties use the public ID.
  if (!index.fields.includes("id" as Extract<keyof T, string>)) order.push(`id ${direction}`)
  return {
    sql: `SELECT value FROM ${table} INDEXED BY ${indexSqlName(namespace, table, index.name)}
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ${order.length ? `ORDER BY ${order.join(", ")}` : ""} LIMIT ?`,
    params: [...params, query.limit],
  }
}
