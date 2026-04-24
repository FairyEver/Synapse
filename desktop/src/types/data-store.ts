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
  op: "=" | "!=" | ">" | "<" | ">=" | "<=" | "LIKE" | "CONTAINS"
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

type DataStoreMcpStatus = {
  claude: boolean
  codex: boolean
  cursor: boolean
}

type DataStoreMcpTarget = "claude" | "codex" | "cursor"

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
  DataStoreColumnDef,
  DataStoreColumnInfo,
  DataStoreColumnType,
  DataStoreOrderBy,
  DataStoreQueryParams,
  DataStoreQueryResult,
  DataStoreStatus,
  DataStoreTableInfo,
  DataStoreTableSchema,
  DataStoreWhereClause,
  DataStoreWhereCondition,
}
