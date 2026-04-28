import { useCallback, useEffect, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import {
  EMPTY_DATA_STORE_QUERY_RESULT,
  getCurrentDataStoreError,
  getCurrentDataStoreQueryResult,
  getCurrentDataStoreSchema,
  type DataStoreQueryState,
  type DataStoreSchemaState,
} from "@/modules/data-store/utils"
import type {
  DataStoreCliDebugInfo,
  DataStoreCliStatus,
  Column,
  DataStoreMcpHttpStatus,
  DataStoreMcpServerInfo,
  DataStoreMcpStatus,
  DataStoreMcpTarget,
  DataStoreStatus,
  DataStoreTableImportInspection,
  DataStoreTableInfo,
  DataStoreWhereClause,
} from "@/types/data-store"

function toLoadError(error: unknown): Error {
  return error instanceof Error ? error : new Error("读取失败")
}

function useDataStoreTables() {
  const [tables, setTables] = useState<DataStoreTableInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().dataStore.listTables()
      setTables(result)
      setError(null)
    } catch (loadError) {
      setTables([])
      setError(toLoadError(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { tables, loading, error, refresh }
}

function useDataStoreQuery(table: string | null, page: number, where?: DataStoreWhereClause | null) {
  const [state, setState] = useState<DataStoreQueryState>({
    table: null,
    data: EMPTY_DATA_STORE_QUERY_RESULT,
    error: null,
  })
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)
  const pageSize = 50

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current

    if (!table) {
      setState({ table: null, data: EMPTY_DATA_STORE_QUERY_RESULT, error: null })
      setLoading(false)
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
      if (requestId !== requestIdRef.current) return
      setState({ table, data: result, error: null })
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return
      setState({ table, data: EMPTY_DATA_STORE_QUERY_RESULT, error: toLoadError(loadError) })
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [table, page, where])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    ...getCurrentDataStoreQueryResult(table, state),
    loading,
    error: getCurrentDataStoreError(table, state),
    refresh,
    pageSize,
  }
}

function useDataStoreStatus() {
  const [status, setStatus] = useState<DataStoreStatus | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await requireSynapseBridge().dataStore.getStatus()
      setStatus(result)
      setError(null)
    } catch (loadError) {
      setStatus(null)
      setError(toLoadError(loadError))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, error, refresh }
}

function useDataStoreSchema(table: string | null) {
  const [state, setState] = useState<DataStoreSchemaState>({
    table: null,
    schema: null,
    error: null,
  })
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current

    if (!table) {
      setState({ table: null, schema: null, error: null })
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const result = await requireSynapseBridge().dataStore.describeTable(table)
      if (requestId !== requestIdRef.current) return
      setState({ table, schema: result, error: null })
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return
      setState({ table, schema: null, error: toLoadError(loadError) })
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [table])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    schema: getCurrentDataStoreSchema(table, state),
    loading,
    error: getCurrentDataStoreError(table, state),
    refresh,
  }
}

async function createTable(name: string, columns: Column[], description?: string): Promise<void> {
  await requireSynapseBridge().dataStore.createTable({ name, columns, description })
}

async function dropTable(name: string): Promise<void> {
  await requireSynapseBridge().dataStore.dropTable(name)
}

async function updateTableDescription(table: string, description: string): Promise<void> {
  await requireSynapseBridge().dataStore.updateTableDescription({ table, description })
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

async function exportTable(table: string): Promise<{ success: boolean; path?: string }> {
  return requireSynapseBridge().dataStore.exportTable(table)
}

async function inspectTableImport(): Promise<
  { success: false }
  | ({ success: true } & DataStoreTableImportInspection)
> {
  return requireSynapseBridge().dataStore.inspectTableImport()
}

async function importTable(sourcePath: string): Promise<{ success: boolean; tableName?: string }> {
  return requireSynapseBridge().dataStore.importTable(sourcePath)
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
  exportTable,
  getCliDebugInfo,
  getCliStatus,
  getColumnChoicesUsage,
  getMCPServers,
  getMcpHttpStatus,
  getMcpStatus,
  importDB,
  importTable,
  inspectTableImport,
  insertRow,
  installCLI,
  openMCPSettings,
  registerMCP,
  updateTableDescription,
  updateColumnDescription,
  updateColumnChoices,
  updateRow,
  useDataStoreQuery,
  useDataStoreSchema,
  useDataStoreStatus,
  useDataStoreTables,
}
