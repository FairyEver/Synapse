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

type DataStoreOverviewColumn = {
  name: string
  kind: ColumnKind
  description: string
  choices?: string[]
  system?: true
}

type DataStoreOverviewTable = {
  name: string
  description: string
  rowCount: number
  columns: DataStoreOverviewColumn[]
}

type DataStoreOverview = {
  tableCount: number
  tables: DataStoreOverviewTable[]
}

type DataStoreBulkMutationResult = {
  affected: number
  ids: number[]
  dryRun?: true
}

type DataStoreOperationSource = "api" | "cli" | "mcp-stdio" | "mcp-http"

type DataStoreOperationLogEntry = {
  id: number
  source: DataStoreOperationSource
  action: string
  table: string | null
  affected: number | null
  dryRun: boolean
  createdAt: string
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
  dbDirectoryPath: string
}

type DataStoreTableImportInspection = {
  tableName: string
  exists: boolean
  sourcePath: string
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
  DataStoreBulkMutationResult,
  DataStoreOrderBy,
  DataStoreOperationLogEntry,
  DataStoreOperationSource,
  DataStoreOverview,
  DataStoreOverviewColumn,
  DataStoreOverviewTable,
  DataStoreQueryParams,
  DataStoreQueryResult,
  DataStoreServerInfo,
  DataStoreStatus,
  DataStoreTableImportInspection,
  DataStoreTableInfo,
  DataStoreTableSchema,
  DataStoreWhereClause,
  DataStoreWhereCondition,
  DataStoreWhereGroup,
}
