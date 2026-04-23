type DataStoreColumnType = "TEXT" | "INTEGER" | "REAL" | "BLOB" | "JSON" | "DATE" | "DATETIME" | "BOOLEAN" | "ENUM" | "MULTI_ENUM"

type DataStoreColumnDef = {
  name: string
  type: DataStoreColumnType
  description?: string
  enumValues?: string[]
}

type DataStoreColumnInfo = {
  name: string
  type: string
  primaryKey: boolean
  system?: boolean
  description: string
  enumValues?: string[]
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
  columns: DataStoreColumnInfo[]
  rowCount: number
  createdAt: string
  updatedAt: string
}

type DataStoreWhereCondition = {
  field: string
  op: "=" | "!=" | ">" | "<" | ">=" | "<=" | "LIKE"
  value: unknown
}

type DataStoreWhereClause = Record<string, unknown> | DataStoreWhereCondition[]

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
  DataStoreColumnDef,
  DataStoreColumnInfo,
  DataStoreColumnType,
  DataStoreOrderBy,
  DataStoreQueryParams,
  DataStoreQueryResult,
  DataStoreServerInfo,
  DataStoreStatus,
  DataStoreTableInfo,
  DataStoreTableSchema,
  DataStoreWhereClause,
  DataStoreWhereCondition,
}
