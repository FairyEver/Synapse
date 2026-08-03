import { useCallback } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"

const logger = createRendererLogger("git.repository-shell")

export function useGitRepositoryShellActions() {
  const showInFolder = useCallback(async (localPath: string) => {
    try {
      await requireSynapseBridge().shell.showItemInFolder(localPath)
    } catch (error) {
      logger.warn("Failed to show Git repository in folder.", {
        error: error instanceof Error ? error.name : typeof error,
      })
      toast.error("无法在文件夹中显示仓库。")
    }
  }, [])

  return { showInFolder }
}
