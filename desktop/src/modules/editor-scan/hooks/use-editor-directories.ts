import { useCallback, useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseEditorGlobalDirectory } from "@/types/editor"

const logger = createRendererLogger("editor-scan.directories")

function useEditorDirectories() {
  const [directories, setDirectories] = useState<SynapseEditorGlobalDirectory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { promise } = useAppNotifications()

  const loadDirectories = useCallback(() => {
    setIsLoading(true)
    setError(null)
    const bridge = getSynapseBridge()
    if (!bridge) {
      setDirectories([])
      setIsLoading(false)
      return
    }
    bridge.editor.getGlobalDirectories()
      .then(setDirectories)
      .catch((err) => {
        logger.error("Failed to load editor global directories.", err)
        setError("加载编辑器目录失败")
      })
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    loadDirectories()
  }, [loadDirectories])

  const handleOpen = useCallback((dirPath: string) => {
    logger.info("Opening editor directory.", { dirName: dirPath.split(/[/\\]/).pop() ?? dirPath })
    window.synapse?.shell.showItemInFolder(dirPath).catch(() => {})
  }, [])

  const handleCreate = useCallback(
    async (dirPath: string) => {
      logger.info("Creating editor directory.", { dirName: dirPath.split(/[/\\]/).pop() ?? dirPath })
      await promise(
        async () => {
          await requireSynapseBridge().editor.createDirectory(dirPath)
          loadDirectories()
        },
        {
          loading: "正在创建目录...",
          success: () => "目录已创建。",
          error: (err) => (err instanceof Error ? err.message : "创建目录失败。"),
        },
      )
    },
    [loadDirectories, promise],
  )

  return { directories, isLoading, error, handleOpen, handleCreate, reload: loadDirectories }
}

export { useEditorDirectories }
