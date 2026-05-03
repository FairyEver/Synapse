import { useCallback, useEffect, useRef, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import {
  EMPTY_DATABASE_QUERY_RESULT,
  getCurrentDatabaseError,
  getCurrentDatabaseQueryResult,
  getCurrentDatabaseSchema,
  type DatabaseQueryState,
  type DatabaseSchemaState,
} from "@/modules/database/utils"
import type {
  DatabaseCliDebugInfo,
  DatabaseCliStatus,
  Column,
  DatabaseMcpHttpStatus,
  DatabaseMcpServerInfo,
  DatabaseMcpStatus,
  DatabaseMcpTarget,
  DatabaseStatus,
  DatabaseTableImportInspection,
  DatabaseTableInfo,
  DatabaseWhereClause,
} from "@/types/database"

function toLoadError(error: unknown): Error {
  return error instanceof Error ? error : new Error("读取失败")
}

function useDatabaseTables() {
  const [tables, setTables] = useState<DatabaseTableInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().database.databaseTableList()
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

function useDatabaseQuery(table: string | null, page: number, where?: DatabaseWhereClause | null) {
  const [state, setState] = useState<DatabaseQueryState>({
    table: null,
    data: EMPTY_DATABASE_QUERY_RESULT,
    error: null,
  })
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef(0)
  const pageSize = 50

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current

    if (!table) {
      setState({ table: null, data: EMPTY_DATABASE_QUERY_RESULT, error: null })
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const result = await requireSynapseBridge().database.databaseRowList({
        table,
        where: where ?? undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (requestId !== requestIdRef.current) return
      setState({ table, data: result, error: null })
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return
      setState({ table, data: EMPTY_DATABASE_QUERY_RESULT, error: toLoadError(loadError) })
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
    ...getCurrentDatabaseQueryResult(table, state),
    loading,
    error: getCurrentDatabaseError(table, state),
    refresh,
    pageSize,
  }
}

function useDatabaseStatus() {
  const [status, setStatus] = useState<DatabaseStatus | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await requireSynapseBridge().database.databaseStatusGet()
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

function useDatabaseSchema(table: string | null) {
  const [state, setState] = useState<DatabaseSchemaState>({
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
      const result = await requireSynapseBridge().database.databaseTableDescribe(table)
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
    schema: getCurrentDatabaseSchema(table, state),
    loading,
    error: getCurrentDatabaseError(table, state),
    refresh,
  }
}

async function databaseTableCreate(name: string, columns: Column[], description?: string): Promise<void> {
  await requireSynapseBridge().database.databaseTableCreate({ name, columns, description })
}

async function databaseTableDelete(name: string): Promise<void> {
  await requireSynapseBridge().database.databaseTableDelete(name)
}

async function databaseTableUpdate(table: string, description: string): Promise<void> {
  await requireSynapseBridge().database.databaseTableUpdate({ table, description })
}

async function databaseColumnCreate(table: string, column: Column & { default?: unknown }): Promise<void> {
  await requireSynapseBridge().database.databaseColumnCreate({ table, column })
}

async function databaseColumnUpdate(table: string, column: string, description: string): Promise<void> {
  await requireSynapseBridge().database.databaseColumnUpdate({ table, column, description })
}

async function databaseChoiceUpdate(table: string, column: string, choices: string[]): Promise<void> {
  await requireSynapseBridge().database.databaseChoiceUpdate({ table, column, choices })
}

async function databaseChoiceUsageGet(table: string, column: string): Promise<Record<string, number>> {
  return requireSynapseBridge().database.databaseChoiceUsageGet({ table, column })
}

async function databaseRowCreate(table: string, data: Record<string, unknown>): Promise<{ id: number }> {
  return requireSynapseBridge().database.databaseRowCreate({ table, data })
}

async function databaseRowUpdate(table: string, id: number, data: Record<string, unknown>): Promise<void> {
  await requireSynapseBridge().database.databaseRowUpdate({ table, id, data })
}

async function databaseRowDelete(table: string, id: number): Promise<void> {
  await requireSynapseBridge().database.databaseRowDelete({ table, id })
}

async function databaseExport(): Promise<{ success: boolean; path?: string }> {
  return requireSynapseBridge().database.databaseExport()
}

async function databaseImport(): Promise<{ success: boolean }> {
  return requireSynapseBridge().database.databaseImport()
}

async function databaseTableExport(table: string): Promise<{ success: boolean; path?: string }> {
  return requireSynapseBridge().database.databaseTableExport(table)
}

async function databaseTableImportInspect(): Promise<
  { success: false }
  | ({ success: true } & DatabaseTableImportInspection)
> {
  return requireSynapseBridge().database.databaseTableImportInspect()
}

async function databaseTableImport(sourcePath: string): Promise<{ success: boolean; tableName?: string }> {
  return requireSynapseBridge().database.databaseTableImport(sourcePath)
}

async function databaseCliInstall(): Promise<{ success: boolean; path?: string; error?: string }> {
  return requireSynapseBridge().database.databaseCliInstall()
}

async function databaseCliStatusGet(): Promise<DatabaseCliStatus> {
  return requireSynapseBridge().database.databaseCliStatusGet()
}

async function databaseCliDebugInfoGet(): Promise<DatabaseCliDebugInfo> {
  return requireSynapseBridge().database.databaseCliDebugInfoGet()
}

async function databaseMcpHttpStatusGet(): Promise<DatabaseMcpHttpStatus> {
  return requireSynapseBridge().database.databaseMcpHttpStatusGet()
}

async function databaseMcpStatusGet(): Promise<DatabaseMcpStatus> {
  return requireSynapseBridge().database.databaseMcpStatusGet()
}

async function databaseMcpServersGet(): Promise<DatabaseMcpServerInfo[]> {
  return requireSynapseBridge().database.databaseMcpServersGet()
}

async function databaseMcpSettingsOpen(target: DatabaseMcpTarget): Promise<{ success: boolean; error?: string }> {
  return requireSynapseBridge().database.databaseMcpSettingsOpen(target)
}

async function databaseMcpRegister(target: DatabaseMcpTarget): Promise<{ success: boolean; error?: string }> {
  return requireSynapseBridge().database.databaseMcpRegister(target)
}

export {
  databaseColumnCreate,
  databaseTableCreate,
  databaseRowDelete,
  databaseTableDelete,
  databaseExport,
  databaseTableExport,
  databaseCliDebugInfoGet,
  databaseCliStatusGet,
  databaseChoiceUsageGet,
  databaseMcpServersGet,
  databaseMcpHttpStatusGet,
  databaseMcpStatusGet,
  databaseImport,
  databaseTableImport,
  databaseTableImportInspect,
  databaseRowCreate,
  databaseCliInstall,
  databaseMcpSettingsOpen,
  databaseMcpRegister,
  databaseTableUpdate,
  databaseColumnUpdate,
  databaseChoiceUpdate,
  databaseRowUpdate,
  useDatabaseQuery,
  useDatabaseSchema,
  useDatabaseStatus,
  useDatabaseTables,
}
