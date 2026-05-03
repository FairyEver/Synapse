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
}

type DatabaseCliStatus = {
  installed: boolean
  path: string
  executable: boolean
  pathInShell: boolean
  runtimeExists: boolean
  bundledScriptExists: boolean
  shimCurrent: boolean
  available: boolean
}

type DatabaseCliDebugInfo = {
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
  status: DatabaseCliStatus
}

type DatabaseMcpStatus = Record<string, boolean>

type DatabaseMcpTarget = string & { readonly __brand?: "DatabaseMcpTarget" }

type DatabaseMcpServerInfo = {
  target: DatabaseMcpTarget
  settingsPath: string
  settingsFileExists: boolean
  registered: boolean
  mode: "http" | "stdio" | null
  url: string | null
}

type DatabaseMcpHttpStatus = {
  running: boolean
  port: number
  url: string
}

type DatabaseChangeEvent = {
  action: string
  table?: string
}

export type {
  DatabaseChangeEvent,
  DatabaseCliDebugInfo,
  DatabaseCliStatus,
  DatabaseMcpHttpStatus,
  DatabaseMcpServerInfo,
  DatabaseMcpStatus,
  DatabaseMcpTarget,
  Column,
  ColumnKind,
  DatabaseOrderBy,
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
