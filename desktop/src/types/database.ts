type ColumnKind =
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "timestamp"
  | "single_choice"
  | "multi_choice"
  | "json"
  | "binary"

type Column = {
  name: string
  kind: ColumnKind
  choices?: string[]
  system?: boolean
  description?: string
  primaryKey?: true
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

type DatabaseFolder = {
  id: number
  name: string
  sortOrder: number
  members: { tableName: string; sortOrder: number }[]
}

type DatabaseTableImportInspection = {
  tableName: string
  exists: boolean
  sourcePath: string
  sourceDigest: string
}

type DatabaseChangeEvent = {
  action: string
  table?: string
}

export type {
  DatabaseChangeEvent,
  DatabaseFolder,
  Column,
  ColumnKind,
  DatabaseOrderBy,
  DatabaseOverview,
  DatabaseOverviewColumn,
  DatabaseOverviewTable,
  DatabaseQueryParams,
  DatabaseQueryResult,
  DatabaseStatus,
  DatabaseTableImportInspection,
  DatabaseTableInfo,
  DatabaseTableSchema,
  DatabaseWhereClause,
  DatabaseWhereCondition,
  DatabaseWhereGroup,
}
