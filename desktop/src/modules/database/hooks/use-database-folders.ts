import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { DatabaseFolder } from "@/types/database"

function useDatabaseFolders() {
  const [folders, setFolders] = useState<DatabaseFolder[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().database.databaseFolderList()
      setFolders(result)
    } catch {
      setFolders([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createFolder = useCallback(async (name: string) => {
    const result = await requireSynapseBridge().database.databaseFolderCreate({ name })
    await refresh()
    return result
  }, [refresh])

  const renameFolder = useCallback(async (id: number, name: string) => {
    await requireSynapseBridge().database.databaseFolderRename({ id, name })
    await refresh()
  }, [refresh])

  const deleteFolder = useCallback(async (id: number) => {
    await requireSynapseBridge().database.databaseFolderDelete({ id })
    await refresh()
  }, [refresh])

  const moveTable = useCallback(async (tableName: string, folderId: number | null) => {
    await requireSynapseBridge().database.databaseFolderMoveTable({ tableName, folderId })
    await refresh()
  }, [refresh])

  const reorderTables = useCallback(async (folderId: number, tableNames: string[]) => {
    await requireSynapseBridge().database.databaseFolderReorder({ folderId, tableNames })
    await refresh()
  }, [refresh])

  const reorderFolders = useCallback(async (folderIds: number[]) => {
    await requireSynapseBridge().database.databaseFolderReorderFolders({ folderIds })
    await refresh()
  }, [refresh])

  return {
    folders,
    loading,
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
