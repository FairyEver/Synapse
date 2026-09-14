import { isDefaultAgentWorkspaceProjectId } from "../../lib/default-agent-workspace"

type AgentProjectMoveDirection = "up" | "down"

type AgentOrderableProject = {
  readonly id: string
}

function normalizeAgentProjectOrder(
  projects: readonly AgentOrderableProject[],
  order: readonly unknown[] | undefined,
): string[] {
  const knownIds = new Set(projects.map((project) => project.id))
  const next: string[] = []

  for (const value of order ?? []) {
    if (typeof value !== "string") {
      continue
    }
    const projectId = value.trim()
    if (!projectId || !knownIds.has(projectId) || next.includes(projectId)) {
      continue
    }
    next.push(projectId)
  }

  return next
}

function orderAgentProjects<T extends AgentOrderableProject>(
  projects: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) {
    return [...projects]
  }

  const projectById = new Map(projects.map((project) => [project.id, project]))
  const ordered: T[] = []
  const placedIds = new Set<string>()

  for (const projectId of order) {
    const project = projectById.get(projectId)
    if (!project || placedIds.has(projectId)) {
      continue
    }
    placedIds.add(projectId)
    ordered.push(project)
  }

  for (const project of projects) {
    if (placedIds.has(project.id)) {
      continue
    }
    placedIds.add(project.id)
    ordered.push(project)
  }

  return ordered
}

function splitPinnedAgentProjects<T extends AgentOrderableProject>(
  projects: readonly T[],
): { readonly pinned: T[]; readonly sortable: T[] } {
  const pinned: T[] = []
  const sortable: T[] = []

  for (const project of projects) {
    if (isDefaultAgentWorkspaceProjectId(project.id)) {
      pinned.push(project)
    } else {
      sortable.push(project)
    }
  }

  return { pinned, sortable }
}

function moveAgentProjectId(
  projectIds: readonly string[],
  projectId: string,
  direction: AgentProjectMoveDirection,
): readonly string[] {
  const currentIndex = projectIds.indexOf(projectId)
  if (currentIndex < 0) {
    return projectIds
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1
  if (targetIndex < 0 || targetIndex >= projectIds.length) {
    return projectIds
  }

  const next = [...projectIds]
  next.splice(currentIndex, 1)
  next.splice(targetIndex, 0, projectId)
  return next
}

export {
  moveAgentProjectId,
  normalizeAgentProjectOrder,
  orderAgentProjects,
  splitPinnedAgentProjects,
  type AgentOrderableProject,
  type AgentProjectMoveDirection,
}
