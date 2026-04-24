import { useCallback, useEffect, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  DataStoreCliDebugInfo,
  DataStoreCliStatus,
  Column,
  DataStoreMcpHttpStatus,
  DataStoreMcpServerInfo,
  DataStoreMcpStatus,
  DataStoreMcpTarget,
  DataStoreQueryParams,
  DataStoreQueryResult,
  DataStoreStatus,
  DataStoreTableInfo,
  DataStoreTableSchema,
  DataStoreWhereClause,
} from "@/types/data-store"

function useDataStoreTables() {
  const [tables, setTables] = useState<DataStoreTableInfo[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await requireSynapseBridge().dataStore.listTables()
      setTables(result)
    } catch {
      setTables([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { tables, loading, refresh }
}

function useDataStoreQuery(table: string | null, page: number, where?: DataStoreWhereClause | null) {
  const [data, setData] = useState<DataStoreQueryResult>({ rows: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const pageSize = 50

  const refresh = useCallback(async () => {
    if (!table) {
      setData({ rows: [], total: 0 })
      return
    }

    setLoading(true)
    try {
      const result = await requireSynapseBridge().dataStore.query({
        table,
        where: where ?? undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      setData(result)
    } catch {
      setData({ rows: [], total: 0 })
    } finally {
      setLoading(false)
    }
  }, [table, page, where])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { ...data, loading, refresh, pageSize }
}

function useDataStoreStatus() {
  const [status, setStatus] = useState<DataStoreStatus | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await requireSynapseBridge().dataStore.getStatus()
      setStatus(result)
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, refresh }
}

function useDataStoreSchema(table: string | null) {
  const [schema, setSchema] = useState<DataStoreTableSchema | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!table) {
      setSchema(null)
      return
    }

    setLoading(true)
    try {
      const result = await requireSynapseBridge().dataStore.describeTable(table)
      setSchema(result)
    } catch {
      setSchema(null)
    } finally {
      setLoading(false)
    }
  }, [table])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { schema, loading, refresh }
}

async function createTable(name: string, columns: Column[], description?: string): Promise<void> {
  await requireSynapseBridge().dataStore.createTable({ name, columns, description })
}

async function dropTable(name: string): Promise<void> {
  await requireSynapseBridge().dataStore.dropTable(name)
}

async function addColumn(table: string, column: Column & { default?: unknown }): Promise<void> {
  await requireSynapseBridge().dataStore.addColumn({ table, column })
}

async function updateColumnDescription(table: string, column: string, description: string): Promise<void> {
  await requireSynapseBridge().dataStore.updateColumnDescription({ table, column, description })
}

async function updateColumnChoices(table: string, column: string, choices: string[]): Promise<void> {
  await requireSynapseBridge().dataStore.updateColumnChoices({ table, column, choices })
}

async function getColumnChoicesUsage(table: string, column: string): Promise<Record<string, number>> {
  return requireSynapseBridge().dataStore.getColumnChoicesUsage({ table, column })
}

async function insertRow(table: string, data: Record<string, unknown>): Promise<{ id: number }> {
  return requireSynapseBridge().dataStore.insert({ table, data })
}

async function updateRow(table: string, id: number, data: Record<string, unknown>): Promise<void> {
  await requireSynapseBridge().dataStore.update({ table, id, data })
}

async function deleteRow(table: string, id: number): Promise<void> {
  await requireSynapseBridge().dataStore.delete({ table, id })
}

async function exportDB(): Promise<{ success: boolean; path?: string }> {
  return requireSynapseBridge().dataStore.exportDB()
}

async function importDB(): Promise<{ success: boolean }> {
  return requireSynapseBridge().dataStore.importDB()
}

async function installCLI(): Promise<{ success: boolean; path?: string; error?: string }> {
  return requireSynapseBridge().dataStore.installCLI()
}

async function getCliStatus(): Promise<DataStoreCliStatus> {
  return requireSynapseBridge().dataStore.getCliStatus()
}

async function getCliDebugInfo(): Promise<DataStoreCliDebugInfo> {
  return requireSynapseBridge().dataStore.getCliDebugInfo()
}

async function getMcpHttpStatus(): Promise<DataStoreMcpHttpStatus> {
  return requireSynapseBridge().dataStore.getMcpHttpStatus()
}

async function getMcpStatus(): Promise<DataStoreMcpStatus> {
  return requireSynapseBridge().dataStore.getMcpStatus()
}

async function getMCPServers(): Promise<DataStoreMcpServerInfo[]> {
  return requireSynapseBridge().dataStore.getMCPServers()
}

async function openMCPSettings(target: DataStoreMcpTarget): Promise<{ success: boolean; error?: string }> {
  return requireSynapseBridge().dataStore.openMCPSettings(target)
}

async function registerMCP(target: DataStoreMcpTarget): Promise<{ success: boolean; error?: string }> {
  return requireSynapseBridge().dataStore.registerMCP(target)
}

export {
  addColumn,
  createTable,
  deleteRow,
  dropTable,
  exportDB,
  getCliDebugInfo,
  getCliStatus,
  getColumnChoicesUsage,
  getMCPServers,
  getMcpHttpStatus,
  getMcpStatus,
  importDB,
  insertRow,
  installCLI,
  openMCPSettings,
  registerMCP,
  updateColumnDescription,
  updateColumnChoices,
  updateRow,
  useDataStoreQuery,
  useDataStoreSchema,
  useDataStoreStatus,
  useDataStoreTables,
}
