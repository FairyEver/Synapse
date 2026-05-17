import { BrowserWindow, dialog, type IpcMainInvokeEvent, type OpenDialogOptions, type SaveDialogOptions } from "electron"
import path from "node:path"
import { DATABASE_IPC_CHANNELS } from "./channels"
import { databaseService } from "./service"
import { getHttpPort } from "./http-server"
import { getCliDebugInfo, installCli, getCliStatus } from "./cli-installer"
import { getMcpServers, getMcpStatus, openMcpSettings, registerMcp } from "./mcp-installer"
import { getMcpServerPort, isMcpServerRunning, getMcpServerUrl } from "./mcp-server"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import { createMainLogger } from "../services/log-store"
import type { DatabaseMcpTarget } from "../../src/types/database"
import type {
  Column,
  DatabaseQueryParams,
  DatabaseWhereClause,
} from "./types"

const logger = createMainLogger("database.ipc")
let handlersRegistered = false

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
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableDelete, async (_event, name: string) => {
    databaseService.databaseTableDelete(name)
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
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseColumnCreate, async (_event, params: {
    table: string
    column: Column & { default?: unknown }
  }) => {
    databaseService.databaseColumnCreate(params.table, params.column)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseColumnUpdate, async (_event, params: {
    table: string
    column: string
    description: string
  }) => {
    databaseService.databaseColumnUpdate(params.table, params.column, params.description)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseChoiceUpdate, async (_event, params: {
    table: string
    column: string
    choices: string[]
  }) => {
    databaseService.databaseChoiceUpdate(params.table, params.column, params.choices)
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
    return databaseService.databaseRowCreate(params.table, params.data)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowsCreate, async (_event, params: {
    table: string
    rows: Record<string, unknown>[]
  }) => {
    return databaseService.databaseRowsCreate(params.table, params.rows)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowList, async (_event, params: DatabaseQueryParams) => {
    return databaseService.databaseRowList(params)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowUpdate, async (_event, params: {
    table: string
    id: number
    data: Record<string, unknown>
  }) => {
    return databaseService.databaseRowUpdate(params.table, params.id, params.data)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowDelete, async (_event, params: {
    table: string
    id: number
  }) => {
    return databaseService.databaseRowDelete(params.table, params.id)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowsUpdate, async (_event, params: {
    table: string
    where: DatabaseWhereClause
    data: Record<string, unknown>
  }) => {
    return databaseService.databaseRowsUpdate(params.table, params.where, params.data)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseRowsDelete, async (_event, params: {
    table: string
    where: DatabaseWhereClause
  }) => {
    return databaseService.databaseRowsDelete(params.table, params.where)
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
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseColumnRename, async (_event, params: {
    table: string
    from: string
    to: string
  }) => {
    databaseService.databaseColumnRename(params.table, params.from, params.to)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseColumnDelete, async (_event, params: {
    table: string
    column: string
  }) => {
    databaseService.databaseColumnDelete(params.table, params.column)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseSqlExecute, async (_event, params: {
    sql: string
    params?: unknown[]
  }) => {
    return databaseService.databaseSqlExecute(params.sql, params.params)
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

    databaseService.exportDatabase(result.filePath)
    logger.info("Database exported.", { path: result.filePath })
    return { success: true, path: result.filePath }
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

    databaseService.importDatabase(result.filePaths[0])
    return { success: true }
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

    databaseService.exportTable(table, result.filePath)
    return { success: true, path: result.filePath }
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

    const inspection = databaseService.inspectTableImport(result.filePaths[0])
    return { success: true, ...inspection }
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseTableImport, async (_event, sourcePath: string) => {
    const tableName = databaseService.importTable(sourcePath)
    return { success: true, tableName }
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseCliInstall, async () => {
    return installCli()
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseCliStatusGet, async () => {
    return getCliStatus()
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseCliDebugInfoGet, async () => {
    return getCliDebugInfo()
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseMcpHttpStatusGet, async () => {
    return {
      running: isMcpServerRunning(),
      port: getMcpServerPort(),
      url: getMcpServerUrl(),
    }
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseMcpStatusGet, async () => {
    return getMcpStatus()
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseMcpServersGet, async () => {
    return getMcpServers()
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseMcpSettingsOpen, async (_event, target: DatabaseMcpTarget) => {
    return openMcpSettings(target)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseMcpRegister, async (_event, target: DatabaseMcpTarget) => {
    return registerMcp(target, getMcpServerPort())
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderList, async () => {
    return databaseService.folderList()
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderCreate, async (_event, params: {
    name: string
  }) => {
    return databaseService.folderCreate(params.name)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderRename, async (_event, params: {
    id: number
    name: string
  }) => {
    databaseService.folderRename(params.id, params.name)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderDelete, async (_event, params: {
    id: number
  }) => {
    databaseService.folderDelete(params.id)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderMoveTable, async (_event, params: {
    tableName: string
    folderId: number | null
  }) => {
    databaseService.folderMoveTable(params.tableName, params.folderId)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderReorder, async (_event, params: {
    folderId: number
    tableNames: string[]
  }) => {
    databaseService.folderReorder(params.folderId, params.tableNames)
  })

  handleValidatedIpc(DATABASE_IPC_CHANNELS.databaseFolderReorderFolders, async (_event, params: {
    folderIds: number[]
  }) => {
    databaseService.folderReorderFolders(params.folderIds)
  })

  handlersRegistered = true
  logger.info("Database IPC handlers registered.")
}

export { registerDatabaseHandlers }
