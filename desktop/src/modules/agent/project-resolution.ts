import type { SynapseProjectConfig, SynapseRepositoryConfig } from "@/types/config"

type AgentProjectScope = {
  readonly projectIds: string[]
  readonly defaultProjectId?: string
  readonly repositoryId?: string
  readonly repositoryName?: string
}

function resolveAgentProjectScope(
  activeRepository: Pick<SynapseRepositoryConfig, "uuid" | "name" | "localPath"> | null | undefined,
  projects: readonly SynapseProjectConfig[],
): AgentProjectScope {
  const projectIds = unique(projects.map((project) => project.id).filter(Boolean))
  const repositoryPath = normalizePathForMatch(activeRepository?.localPath ?? "")
  const matchedProject = repositoryPath
    ? projects.find((project) => normalizePathForMatch(project.path) === repositoryPath)
    : undefined
  const fallbackRepositoryId = activeRepository?.uuid
  const scopedProjectIds = projectIds.length > 0
    ? projectIds
    : fallbackRepositoryId
      ? [fallbackRepositoryId]
      : []

  return {
    projectIds: scopedProjectIds,
    defaultProjectId: matchedProject?.id ?? scopedProjectIds[0],
    repositoryId: activeRepository?.uuid,
    repositoryName: activeRepository?.name,
  }
}

function normalizePathForMatch(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const normalized = trimmed.replace(/[\\/]+$/, "")
  return normalized || trimmed
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

export {
  resolveAgentProjectScope,
  type AgentProjectScope,
}
