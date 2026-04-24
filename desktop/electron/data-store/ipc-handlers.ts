import { BrowserWindow, dialog } from "electron"
import { DATA_STORE_IPC_CHANNELS } from "./channels"
import { dataStoreService } from "./service"
import { getHttpPort } from "./http-server"
import { getCliDebugInfo, installCli, getCliStatus } from "./cli-installer"
import { getMcpServers, getMcpStatus, openMcpSettings, registerMcp } from "./mcp-installer"
import { getMcpServerPort, isMcpServerRunning, getMcpServerUrl } from "./mcp-server"
import { handleValidatedIpc } from "../ipc/validated-ipc"
import { createMainLogger } from "../services/log-store"
import type {
  DataStoreColumnDef,
  DataStoreQueryParams,
  DataStoreWhereClause,
} from "./types"

const logger = createMainLogger("data-store.ipc")
let handlersRegistered = false

function registerDataStoreHandlers(): void {
  if (handlersRegistered) return

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.listTables, async () => {
    return dataStoreService.listTables()
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.createTable, async (_event, params: {
    name: string
    description?: string
    columns: DataStoreColumnDef[]
  }) => {
    dataStoreService.createTable(params.name, params.columns, params.description)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.dropTable, async (_event, name: string) => {
    dataStoreService.dropTable(name)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.describeTable, async (_event, name: string) => {
    return dataStoreService.describeTable(name)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.addColumn, async (_event, params: {
    table: string
    column: DataStoreColumnDef & { default?: unknown }
  }) => {
    dataStoreService.addColumn(params.table, params.column)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.updateColumnDescription, async (_event, params: {
    table: string
    column: string
    description: string
  }) => {
    dataStoreService.updateColumnDescription(params.table, params.column, params.description)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.updateColumnEnumValues, async (_event, params: {
    table: string
    column: string
    values: string[]
  }) => {
    dataStoreService.updateColumnEnumValues(params.table, params.column, params.values)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.getColumnValueUsage, async (_event, params: {
    table: string
    column: string
  }) => {
    return dataStoreService.getColumnValueUsage(params.table, params.column)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.insert, async (_event, params: {
    table: string
    data: Record<string, unknown>
  }) => {
    return dataStoreService.insert(params.table, params.data)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.batchInsert, async (_event, params: {
    table: string
    rows: Record<string, unknown>[]
  }) => {
    return dataStoreService.batchInsert(params.table, params.rows)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.query, async (_event, params: DataStoreQueryParams) => {
    return dataStoreService.query(params)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.update, async (_event, params: {
    table: string
    id: number
    data: Record<string, unknown>
  }) => {
    return dataStoreService.update(params.table, params.id, params.data)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.delete, async (_event, params: {
    table: string
    id: number
  }) => {
    return dataStoreService.delete(params.table, params.id)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.updateWhere, async (_event, params: {
    table: string
    where: DataStoreWhereClause
    data: Record<string, unknown>
  }) => {
    return dataStoreService.updateWhere(params.table, params.where, params.data)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.deleteWhere, async (_event, params: {
    table: string
    where: DataStoreWhereClause
  }) => {
    return dataStoreService.deleteWhere(params.table, params.where)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.count, async (_event, params: {
    table: string
    where?: DataStoreWhereClause
  }) => {
    return dataStoreService.count(params.table, params.where)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.renameTable, async (_event, params: {
    from: string
    to: string
  }) => {
    dataStoreService.renameTable(params.from, params.to)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.renameColumn, async (_event, params: {
    table: string
    from: string
    to: string
  }) => {
    dataStoreService.renameColumn(params.table, params.from, params.to)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.dropColumn, async (_event, params: {
    table: string
    column: string
  }) => {
    dataStoreService.dropColumn(params.table, params.column)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.rawSQL, async (_event, params: {
    sql: string
    params?: unknown[]
  }) => {
    return dataStoreService.rawSQL(params.sql, params.params)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.getStatus, async () => {
    return {
      port: getHttpPort(),
      running: getHttpPort() > 0,
      dbSize: dataStoreService.getDbSize(),
      tableCount: dataStoreService.getTableCount(),
    }
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.exportDB, async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(ownerWindow!, {
      title: "导出数据库",
      defaultPath: "synapse-data.db",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    })

    if (result.canceled || !result.filePath) {
      return { success: false }
    }

    dataStoreService.exportDatabase(result.filePath)
    logger.info("Database exported.", { path: result.filePath })
    return { success: true, path: result.filePath }
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.importDB, async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(ownerWindow!, {
      title: "导入数据库",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
      properties: ["openFile"],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false }
    }

    dataStoreService.importDatabase(result.filePaths[0])
    return { success: true }
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.installCLI, async () => {
    return installCli()
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.getCliStatus, async () => {
    return getCliStatus()
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.getCliDebugInfo, async () => {
    return getCliDebugInfo()
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.getMcpHttpStatus, async () => {
    return {
      running: isMcpServerRunning(),
      port: getMcpServerPort(),
      url: getMcpServerUrl(),
    }
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.getMcpStatus, async () => {
    return getMcpStatus()
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.getMCPServers, async () => {
    return getMcpServers()
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.openMCPSettings, async (_event, target: "claude" | "codex" | "cursor") => {
    return openMcpSettings(target)
  })

  handleValidatedIpc(DATA_STORE_IPC_CHANNELS.registerMCP, async (_event, target: "claude" | "codex" | "cursor") => {
    return registerMcp(target, getMcpServerPort())
  })

  handlersRegistered = true
  logger.info("Data store IPC handlers registered.")
}

export { registerDataStoreHandlers }
