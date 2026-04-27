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
  dbDirectoryPath: string
}

type DataStoreTableImportInspection = {
  tableName: string
  exists: boolean
  sourcePath: string
}

type DataStoreCliStatus = {
  installed: boolean
  path: string
  executable: boolean
  pathInShell: boolean
  runtimeExists: boolean
  bundledScriptExists: boolean
  shimCurrent: boolean
  available: boolean
}

type DataStoreCliDebugInfo = {
  checkedAt: string
  platform: string
  shell: string
  isPackaged: boolean
  processExecPath: string
  runtimePath: string
  bundledScriptPath: string
  cliBinName: string
  testCommand: string
  installedPath: string | null
  preferredInstallPath: string
  knownInstallDirs: string[]
  installPathCandidates: string[]
  processPathEntries: string[]
  shellPathEntries: string[]
  combinedPathEntries: string[]
  environment: {
    home: string
    processPath: string
    shellPath: string
    localAppData: string
    appData: string
    userProfile: string
  }
  status: DataStoreCliStatus
}

type DataStoreMcpStatus = Record<string, boolean>

type DataStoreMcpTarget = string & { readonly __brand?: "DataStoreMcpTarget" }

type DataStoreMcpServerInfo = {
  target: DataStoreMcpTarget
  settingsPath: string
  settingsFileExists: boolean
  registered: boolean
  mode: "http" | "stdio" | null
  url: string | null
}

type DataStoreMcpHttpStatus = {
  running: boolean
  port: number
  url: string
}

type DataStoreChangeEvent = {
  action: string
  table?: string
}

export type {
  DataStoreChangeEvent,
  DataStoreCliDebugInfo,
  DataStoreCliStatus,
  DataStoreMcpHttpStatus,
  DataStoreMcpServerInfo,
  DataStoreMcpStatus,
  DataStoreMcpTarget,
  Column,
  ColumnKind,
  DataStoreOrderBy,
  DataStoreQueryParams,
  DataStoreQueryResult,
  DataStoreStatus,
  DataStoreTableImportInspection,
  DataStoreTableInfo,
  DataStoreTableSchema,
  DataStoreWhereClause,
  DataStoreWhereCondition,
  DataStoreWhereGroup,
}
