import { useCallback, useEffect, useRef, useState } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { createRendererLogger } from "@/app-shell/logging"
import type { DatabaseFolder, DatabaseChangeEvent } from "@/types/database"

const folderLogger = createRendererLogger("database-folders")

function useDatabaseFolders() {
  const [folders, setFolders] = useState<DatabaseFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const bridgeRef = useRef(getSynapseBridge())

  const refresh = useCallback(async () => {
    const bridge = bridgeRef.current
    if (!bridge) return

    setLoading(true)
    setError(null)
    try {
      const result = await bridge.database.databaseFolderList()
      setFolders(result)
    } catch (e) {
      folderLogger.error("Failed to load database folders", e)
      setError(e instanceof Error ? e.message : "Unknown error loading folders")
      setFolders([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Listen for database changes from other sources (MCP, other agents)
  useEffect(() => {
    const bridge = bridgeRef.current
    if (!bridge) return

    const unsubscribe = bridge.database.onChanged((event: DatabaseChangeEvent) => {
      // Refresh folders when folder-related actions occur
      if (event.action.startsWith("database.folder.") || event.action === "database.table.move") {
        void refresh()
      }
    })
    return unsubscribe
  }, [refresh])

  const createFolder = useCallback(async (name: string) => {
    const bridge = bridgeRef.current
    if (!bridge) throw new Error("Bridge not available")
    const result = await bridge.database.databaseFolderCreate({ name })
    await refresh()
    return result
  }, [refresh])

  const renameFolder = useCallback(async (id: number, name: string) => {
    const bridge = bridgeRef.current
    if (!bridge) throw new Error("Bridge not available")
    await bridge.database.databaseFolderRename({ id, name })
    await refresh()
  }, [refresh])

  const deleteFolder = useCallback(async (id: number) => {
    const bridge = bridgeRef.current
    if (!bridge) throw new Error("Bridge not available")
    await bridge.database.databaseFolderDelete({ id })
    await refresh()
  }, [refresh])

  const moveTable = useCallback(async (tableName: string, folderId: number | null) => {
    const bridge = bridgeRef.current
    if (!bridge) throw new Error("Bridge not available")
    await bridge.database.databaseFolderMoveTable({ tableName, folderId })
    await refresh()
  }, [refresh])

  const reorderTables = useCallback(async (folderId: number, tableNames: string[]) => {
    const bridge = bridgeRef.current
    if (!bridge) throw new Error("Bridge not available")
    await bridge.database.databaseFolderReorder({ folderId, tableNames })
    await refresh()
  }, [refresh])

  const reorderFolders = useCallback(async (folderIds: number[]) => {
    const bridge = bridgeRef.current
    if (!bridge) throw new Error("Bridge not available")
    await bridge.database.databaseFolderReorderFolders({ folderIds })
    await refresh()
  }, [refresh])

  return {
    folders,
    loading,
    error,
    refresh,
    createFolder,
    renameFolder,
    deleteFolder,
    moveTable,
    reorderTables,
    reorderFolders,
  }
}

export { useDatabaseFolders }
