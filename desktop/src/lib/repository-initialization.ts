import type { SynapseRepositoryInitializationPreview } from "@/types/repository"

const REPOSITORY_INITIALIZATION_DANGER_MESSAGE = "该目录位置风险较高，不能直接初始化。请选择空目录或新建本地仓库。"

function getRepositoryInitializationDangerMessage(
  preview: SynapseRepositoryInitializationPreview,
): string | null {
  return preview.dangerFlags.length > 0 ? REPOSITORY_INITIALIZATION_DANGER_MESSAGE : null
}

export {
  getRepositoryInitializationDangerMessage,
  REPOSITORY_INITIALIZATION_DANGER_MESSAGE,
}
