import { useCallback } from "react"
import { toast } from "sonner"

import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"

const logger = createRendererLogger("agent")

type AgentProjectFolderTarget = {
  readonly id: string
  readonly path: string
}

function useAgentProjectShellActions() {
  const showProjectInFolder = useCallback(async (project: AgentProjectFolderTarget) => {
    try {
      await requireSynapseBridge().shell.showItemInFolder(project.path)
    } catch (rawError) {
      logger.warn("Agent project show in folder failed.", {
        boundary: "renderer.agent.project-show-in-folder",
        projectId: project.id,
        errorName: rawError instanceof Error ? rawError.name : typeof rawError,
        errorLength: errorMessageLength(rawError),
      })
      toast.error("无法在文件夹中显示项目。")
    }
  }, [])

  return { showProjectInFolder }
}

function errorMessageLength(error: unknown): number {
  return (error instanceof Error ? error.message : String(error)).length
}

export { useAgentProjectShellActions }
