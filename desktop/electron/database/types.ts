import type { ColumnKind } from "./column-kind"

type Column = {
  name: string
  kind: ColumnKind
  choices?: string[]
  description?: string
  primaryKey?: true
  system?: true
}

type DatabaseTableInfo = {
  name: string
  description: string
  rowCount: number
  createdAt: string
  updatedAt: string
}

type DatabaseTableSchema = {
  name: string
  description: string
  columns: Column[]
  rowCount: number
  createdAt: string
  updatedAt: string
}

type DatabaseOverviewColumn = {
  name: string
  kind: ColumnKind
  description: string
  choices?: string[]
  system?: true
}

type DatabaseOverviewTable = {
  name: string
  description: string
  rowCount: number
  columns: DatabaseOverviewColumn[]
}

type DatabaseOverview = {
  tableCount: number
  tables: DatabaseOverviewTable[]
}

type DatabaseBulkMutationResult = {
  affected: number
  ids: number[]
  dryRun?: true
}

type DatabaseOperationSource = "api" | "mcp-stdio" | "mcp-http" | "workflow" | "ipc"

type DatabaseOperationLogEntry = {
  id: number
  source: DatabaseOperationSource
  action: string
  table: string | null
  affected: number | null
  dryRun: boolean
  createdAt: string
}

type DatabaseWhereCondition = {
  field: string
  op: "=" | "!=" | ">" | "<" | ">=" | "<=" | "LIKE" | "CONTAINS"
  value: unknown
}

type DatabaseWhereGroup = {
  combinator: "all" | "any"
  conditions: DatabaseWhereCondition[]
}

type DatabaseWhereClause = Record<string, unknown> | DatabaseWhereCondition[] | DatabaseWhereGroup

type DatabaseOrderBy = string | { field: string; dir: "asc" | "desc" }

type DatabaseQueryParams = {
  table: string
  where?: DatabaseWhereClause
  orderBy?: DatabaseOrderBy
  limit?: number
  offset?: number
}

type DatabaseQueryResult = {
  rows: Record<string, unknown>[]
  total: number
}

type DatabaseStatus = {
  port: number
  running: boolean
  dbSize: number
  tableCount: number
  dbDirectoryPath: string
}

type DatabaseTableImportInspection = {
  tableName: string
  exists: boolean
  sourcePath: string
  sourceDigest: string
}

type DatabaseServerInfo = {
  port: number
  token: string
  pid: number
  startedAt: string
}

export type {
  Column,
  ColumnKind,
  DatabaseBulkMutationResult,
  DatabaseOrderBy,
  DatabaseOperationLogEntry,
  DatabaseOperationSource,
  DatabaseOverview,
  DatabaseOverviewColumn,
  DatabaseOverviewTable,
  DatabaseQueryParams,
  DatabaseQueryResult,
  DatabaseServerInfo,
  DatabaseStatus,
  DatabaseTableImportInspection,
  DatabaseTableInfo,
  DatabaseTableSchema,
  DatabaseWhereClause,
  DatabaseWhereCondition,
  DatabaseWhereGroup,
}
