import { BrowserWindow, dialog, type IpcMainInvokeEvent, type OpenDialogOptions, type SaveDialogOptions } from "electron"
import path from "node:path"
import { DATABASE_IPC_CHANNELS } from "./channels"
import { databaseService } from "./service"
import { getHttpPort } from "./http-server"
import { sanitizeDatabaseLogPath } from "./logging"
import { notifyDatabaseChange } from "./dispatcher"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import { createMainLogger } from "../services/log-store"
import type {
  Column,
  DatabaseQueryParams,
  DatabaseWhereClause,
} from "./types"
import type { AuditSink, PermissionAction, PermissionGuard } from "../runtime/security"

const logger = createMainLogger("database.ipc")
let handlersRegistered = false
let permissionGuard: PermissionGuard | undefined
let auditSink: AuditSink | undefined

function recordMutatingOperation(action: string, table?: string, affected?: number): void {
  try {
    databaseService.recordOperation({ source: "ipc", action, table, affected })
  } catch {
    // Never let operation log failure break the IPC response.
  }
}

function setSecurity(guard: PermissionGuard | undefined, sink: AuditSink | undefined): void {
  permissionGuard = guard
  auditSink = sink
}

function actorIdentityForIpc(event: IpcMainInvokeEvent): { kind: "user"; id?: string } {
  return { kind: "user", id: undefined }
}

function getDatabaseAuditAction(type: "export" | "import"): { action: PermissionAction; resource: string } {
  if (type === "export") return { action: "fs.write", resource: "database:export" }
  return { action: "fs.read.outside-userdata", resource: "database:import" }
}

async function checkFilePermission(
  event: IpcMainInvokeEvent,
  type: "export" | "import",
  filePath: string,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (!permissionGuard) return { allowed: true }
  const { action, resource } = getDatabaseAuditAction(type)
  const result = await permissionGuard.check({
    action,
    actor: actorIdentityForIpc(event),
    resource,
    context: { filePath, projectId: undefined },
  })
  if (!result.allowed) {
    auditSink?.record({
      action,
      actor: actorIdentityForIpc(event),
      resource,
      outcome: "denied",
      metadata: { filePath, reason: result.reason, policyId: result.policyId },
    })
  }
  return result
}

function recordAudit(
  event: IpcMainInvokeEvent,
  type: "export" | "import",
  filePath: string,
  outcome: "allowed" | "failed",
  error?: string,
): void {
  if (!auditSink) return
  const { action, resource } = getDatabaseAuditAction(type)
  auditSink.record({
    action,
    actor: actorIdentityForIpc(event),
    resource,
    outcome,
    metadata: { filePath, ...(error ? { error } : {}) },
  })
}

function getOwnerWindow(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined
}

function showSaveDialogForEvent(event: IpcMainInvokeEvent, options: SaveDialogOptions) {
  const ownerWindow = getOwnerWindow(event)
  return ownerWindow ? dialog.showSaveDialog(ownerWindow, options) : dialog.showSaveDialog(options)
}

function showOpenDialogForEvent(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
  const ownerWindow = getOwnerWindow(event)
  return ownerWindow ? dialog.showOpenDialog(ownerWindow, options) : dialog.showOpenDialog(options)
}

function registerDatabaseHandlers(): void {
  if (handlersRegistered) return

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableList, async () => {
    return databaseService.databaseTableList()
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableCreate, async (_event, params: {
    name: string
    description?: string
    columns: Column[]
  }) => {
    databaseService.databaseTableCreate(params.name, params.columns, params.description)
    recordMutatingOperation("database.table.create", params.name)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableDelete, async (_event, name: string) => {
    databaseService.databaseTableDelete(name)
    recordMutatingOperation("database.table.delete", name)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableDescribe, async (_event, name: string) => {
    return databaseService.databaseTableDescribe(name)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseOverviewGet, async () => {
    return databaseService.databaseOverviewGet()
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableUpdate, async (_event, params: {
    table: string
    description: string
  }) => {
    databaseService.databaseTableUpdate(params.table, params.description)
    recordMutatingOperation("database.table.update", params.table)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseColumnCreate, async (_event, params: {
    table: string
    column: Column & { default?: unknown }
  }) => {
    databaseService.databaseColumnCreate(params.table, params.column)
    recordMutatingOperation("database.column.create", params.table)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseColumnUpdate, async (_event, params: {
    table: string
    column: string
    description: string
  }) => {
    databaseService.databaseColumnUpdate(params.table, params.column, params.description)
    recordMutatingOperation("database.column.update", params.table)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseChoiceUpdate, async (_event, params: {
    table: string
    column: string
    choices: string[]
  }) => {
    databaseService.databaseChoiceUpdate(params.table, params.column, params.choices)
    recordMutatingOperation("database.choice.update", params.table)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseChoiceUsageGet, async (_event, params: {
    table: string
    column: string
  }) => {
    return databaseService.databaseChoiceUsageGet(params.table, params.column)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowCreate, async (_event, params: {
    table: string
    data: Record<string, unknown>
  }) => {
    const result = databaseService.databaseRowCreate(params.table, params.data)
    recordMutatingOperation("database.row.create", params.table, 1)
    return result
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowsCreate, async (_event, params: {
    table: string
    rows: Record<string, unknown>[]
  }) => {
    const result = databaseService.databaseRowsCreate(params.table, params.rows)
    recordMutatingOperation("database.rows.create", params.table, params.rows.length)
    return result
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowList, async (_event, params: DatabaseQueryParams) => {
    return databaseService.databaseRowList(params)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowUpdate, async (_event, params: {
    table: string
    id: number
    data: Record<string, unknown>
  }) => {
    const result = databaseService.databaseRowUpdate(params.table, params.id, params.data)
    recordMutatingOperation("database.row.update", params.table, result.affected)
    return result
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowDelete, async (_event, params: {
    table: string
    id: number
  }) => {
    const result = databaseService.databaseRowDelete(params.table, params.id)
    recordMutatingOperation("database.row.delete", params.table, result.affected)
    return result
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowsUpdate, async (_event, params: {
    table: string
    where: DatabaseWhereClause
    data: Record<string, unknown>
  }) => {
    const result = databaseService.databaseRowsUpdate(params.table, params.where, params.data)
    recordMutatingOperation("database.rows.update", params.table, result?.affected)
    return result
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowsDelete, async (_event, params: {
    table: string
    where: DatabaseWhereClause
  }) => {
    const result = databaseService.databaseRowsDelete(params.table, params.where)
    recordMutatingOperation("database.rows.delete", params.table, result?.affected)
    return result
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowCount, async (_event, params: {
    table: string
    where?: DatabaseWhereClause
  }) => {
    return databaseService.databaseRowCount(params.table, params.where)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableRename, async (_event, params: {
    from: string
    to: string
  }) => {
    databaseService.databaseTableRename(params.from, params.to)
    recordMutatingOperation("database.table.rename", params.to)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseColumnRename, async (_event, params: {
    table: string
    from: string
    to: string
  }) => {
    databaseService.databaseColumnRename(params.table, params.from, params.to)
    recordMutatingOperation("database.column.rename", params.table)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseColumnDelete, async (_event, params: {
    table: string
    column: string
  }) => {
    databaseService.databaseColumnDelete(params.table, params.column)
    recordMutatingOperation("database.column.delete", params.table)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseSqlExecute, async (_event, params: {
    sql: string
    params?: unknown[]
  }) => {
    const result = databaseService.databaseSqlExecute(params.sql, params.params)
    recordMutatingOperation("database.sql.execute")
    return result
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseStatusGet, async () => {
    const dbPath = databaseService.getDbPath()

    return {
      port: getHttpPort(),
      running: getHttpPort() > 0,
      dbSize: databaseService.getDbSize(),
      tableCount: databaseService.getTableCount(),
      dbDirectoryPath: path.dirname(dbPath),
    }
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseExport, async (event) => {
    const result = await showSaveDialogForEvent(event, {
      title: "导出数据库",
      defaultPath: "synapse-database.db",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    })

    if (result.canceled || !result.filePath) {
      return { success: false }
    }

    const permission = await checkFilePermission(event, "export", result.filePath)
    if (!permission.allowed) {
      return { success: false, error: permission.reason }
    }

    try {
      databaseService.exportDatabase(result.filePath)
      recordAudit(event, "export", result.filePath, "allowed")
      logger.info("Database exported.", { path: sanitizeDatabaseLogPath(result.filePath) })
      return { success: true, path: result.filePath }
    } catch (error) {
      recordAudit(event, "export", result.filePath, "failed", error instanceof Error ? error.message : String(error))
      throw error
    }
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseImport, async (event) => {
    const result = await showOpenDialogForEvent(event, {
      title: "导入数据库",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
      properties: ["openFile"],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false }
    }

    const filePath = result.filePaths[0]
    const permission = await checkFilePermission(event, "import", filePath)
    if (!permission.allowed) {
      return { success: false, error: permission.reason }
    }

    try {
      databaseService.importDatabase(filePath)
      recordAudit(event, "import", filePath, "allowed")
      recordMutatingOperation("database.import")
      notifyDatabaseChange("database.import")
      return { success: true }
    } catch (error) {
      recordAudit(event, "import", filePath, "failed", error instanceof Error ? error.message : String(error))
      throw error
    }
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableExport, async (event, table: string) => {
    const result = await showSaveDialogForEvent(event, {
      title: "导出表",
      defaultPath: `${table}.synapse-table.sql`,
      filters: [{ name: "Synapse Table Export", extensions: ["sql"] }],
    })

    if (result.canceled || !result.filePath) {
      return { success: false }
    }

    const permission = await checkFilePermission(event, "export", result.filePath)
    if (!permission.allowed) {
      return { success: false, error: permission.reason }
    }

    try {
      databaseService.exportTable(table, result.filePath)
      recordAudit(event, "export", result.filePath, "allowed")
      return { success: true, path: result.filePath }
    } catch (error) {
      recordAudit(event, "export", result.filePath, "failed", error instanceof Error ? error.message : String(error))
      throw error
    }
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableImportInspect, async (event) => {
    const result = await showOpenDialogForEvent(event, {
      title: "导入表",
      filters: [{ name: "Synapse Table Export", extensions: ["sql"] }],
      properties: ["openFile"],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false }
    }

    const filePath = result.filePaths[0]
    const permission = await checkFilePermission(event, "import", filePath)
    if (!permission.allowed) {
      return { success: false, error: permission.reason }
    }

    try {
      const inspection = databaseService.inspectTableImport(filePath)
      recordAudit(event, "import", filePath, "allowed")
      return { success: true, ...inspection }
    } catch (error) {
      recordAudit(event, "import", filePath, "failed", error instanceof Error ? error.message : String(error))
      throw error
    }
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableImport, async (event, input: { sourcePath: string; sourceDigest: string }) => {
    const sourcePath = input.sourcePath
    const sourceDigest = input.sourceDigest
    const permission = await checkFilePermission(event, "import", sourcePath)
    if (!permission.allowed) {
      return { success: false, error: permission.reason }
    }

    try {
      const tableName = databaseService.importTable(sourcePath, sourceDigest)
      recordAudit(event, "import", sourcePath, "allowed")
      return { success: true, tableName }
    } catch (error) {
      recordAudit(event, "import", sourcePath, "failed", error instanceof Error ? error.message : String(error))
      throw error
    }
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderList, async () => {
    return databaseService.folderList()
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderCreate, async (_event, params: {
    name: string
  }) => {
    const result = databaseService.folderCreate(params.name)
    recordMutatingOperation("database.folder.create")
    return result
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderRename, async (_event, params: {
    id: number
    name: string
  }) => {
    databaseService.folderRename(params.id, params.name)
    recordMutatingOperation("database.folder.rename")
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderDelete, async (_event, params: {
    id: number
  }) => {
    databaseService.folderDelete(params.id)
    recordMutatingOperation("database.folder.delete")
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderMoveTable, async (_event, params: {
    tableName: string
    folderId: number | null
  }) => {
    databaseService.folderMoveTable(params.tableName, params.folderId)
    recordMutatingOperation("database.table.move", params.tableName)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderReorder, async (_event, params: {
    folderId: number
    tableNames: string[]
  }) => {
    databaseService.folderReorder(params.folderId, params.tableNames)
    recordMutatingOperation("database.folder.reorder")
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderReorderFolders, async (_event, params: {
    folderIds: number[]
  }) => {
    databaseService.folderReorderFolders(params.folderIds)
    recordMutatingOperation("database.folder.reorder")
  })

  handlersRegistered = true
  logger.info("Database IPC handlers registered.")
}

export { registerDatabaseHandlers, setSecurity }
