import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import {
  moveAgentProjectId,
  normalizeAgentProjectOrder,
  orderAgentProjects,
  splitPinnedAgentProjects,
  type AgentOrderableProject,
  type AgentProjectMoveDirection,
} from "../project-order"

const logger = createRendererLogger("agent.project-order")

type UseAgentProjectOrderResult<T extends AgentOrderableProject> = {
  readonly canMoveProject: (projectId: string, direction: AgentProjectMoveDirection) => boolean
  readonly moveProject: (projectId: string, direction: AgentProjectMoveDirection) => Promise<boolean>
  readonly projects: T[]
  readonly reorderProjects: (orderedIds: readonly string[]) => Promise<boolean>
  readonly saving: boolean
}

function isSameProjectOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((projectId, index) => projectId === right[index])
}

function useAgentProjectOrder<T extends AgentOrderableProject>(
  projects: readonly T[],
): UseAgentProjectOrderResult<T> {
  const { config, updateConfig } = useAppConfig()
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)

  const { pinned, sortable } = useMemo(() => splitPinnedAgentProjects(projects), [projects])
  const savedOrder = useMemo(
    () => normalizeAgentProjectOrder(sortable, config.global.agentProjectOrder),
    [config.global.agentProjectOrder, sortable],
  )
  const projectIds = useMemo(
    () => orderAgentProjects(sortable, optimisticOrder ?? savedOrder).map((project) => project.id),
    [optimisticOrder, savedOrder, sortable],
  )
  const orderedProjects = useMemo(
    () => [...pinned, ...orderAgentProjects(sortable, projectIds)],
    [pinned, projectIds, sortable],
  )

  const saveProjectOrder = useCallback(async (nextProjectIds: readonly string[]) => {
    const normalizedNextOrder = normalizeAgentProjectOrder(sortable, nextProjectIds)
    if (saving || isSameProjectOrder(normalizedNextOrder, projectIds)) {
      return false
    }

    setSaving(true)
    setOptimisticOrder(normalizedNextOrder)
    try {
      await updateConfig({ global: { agentProjectOrder: [...normalizedNextOrder] } })
      toast("项目顺序已保存")
      return true
    } catch (saveError) {
      logger.error("Failed to save agent project order.", saveError)
      toast.error("保存项目顺序失败")
      return false
    } finally {
      setOptimisticOrder(null)
      setSaving(false)
    }
  }, [projectIds, saving, sortable, updateConfig])

  const reorderProjects = useCallback((orderedIds: readonly string[]) => (
    saveProjectOrder(orderedIds)
  ), [saveProjectOrder])

  const moveProject = useCallback((projectId: string, direction: AgentProjectMoveDirection) => {
    const nextProjectIds = moveAgentProjectId(projectIds, projectId, direction)
    if (nextProjectIds === projectIds) {
      return Promise.resolve(false)
    }

    return saveProjectOrder(nextProjectIds)
  }, [projectIds, saveProjectOrder])

  const canMoveProject = useCallback((projectId: string, direction: AgentProjectMoveDirection) => {
    const currentIndex = projectIds.indexOf(projectId)
    if (currentIndex < 0) {
      return false
    }

    return direction === "up" ? currentIndex > 0 : currentIndex < projectIds.length - 1
  }, [projectIds])

  return {
    canMoveProject,
    moveProject,
    projects: orderedProjects,
    reorderProjects,
    saving,
  }
}

export { useAgentProjectOrder, type UseAgentProjectOrderResult }
