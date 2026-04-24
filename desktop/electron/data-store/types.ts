import type { ColumnKind } from "./column-kind"

type Column = {
  name: string
  kind: ColumnKind
  choices?: string[]
  description?: string
  primaryKey?: true
  system?: true
}

type DataStoreTableInfo = {
  name: string
  description: string
  rowCount: number
  createdAt: string
  updatedAt: string
}

type DataStoreTableSchema = {
  name: string
  description: string
  columns: Column[]
  rowCount: number
  createdAt: string
  updatedAt: string
}

type DataStoreWhereCondition = {
  field: string
  op: "=" | "!=" | ">" | "<" | ">=" | "<=" | "LIKE" | "CONTAINS"
  value: unknown
}

type DataStoreWhereGroup = {
  combinator: "all" | "any"
  conditions: DataStoreWhereCondition[]
}

type DataStoreWhereClause = Record<string, unknown> | DataStoreWhereCondition[] | DataStoreWhereGroup

type DataStoreOrderBy = string | { field: string; dir: "asc" | "desc" }

type DataStoreQueryParams = {
  table: string
  where?: DataStoreWhereClause
  orderBy?: DataStoreOrderBy
  limit?: number
  offset?: number
}

type DataStoreQueryResult = {
  rows: Record<string, unknown>[]
  total: number
}

type DataStoreStatus = {
  port: number
  running: boolean
  dbSize: number
  tableCount: number
}

type DataStoreServerInfo = {
  port: number
  token: string
  pid: number
  startedAt: string
}

export type {
  Column,
  ColumnKind,
  DataStoreOrderBy,
  DataStoreQueryParams,
  DataStoreQueryResult,
  DataStoreServerInfo,
  DataStoreStatus,
  DataStoreTableInfo,
  DataStoreTableSchema,
  DataStoreWhereClause,
  DataStoreWhereCondition,
  DataStoreWhereGroup,
}
