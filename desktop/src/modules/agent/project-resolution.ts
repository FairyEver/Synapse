import { normalizePathForCompare } from "@/lib/path-compare"
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
  platform?: string,
): AgentProjectScope {
  const projectIds = unique(projects.map((project) => project.id).filter(Boolean))
  const repositoryPath = normalizePathForCompare(activeRepository?.localPath ?? "", { platform })
  const matchedProject = repositoryPath
    ? projects.find((project) => normalizePathForCompare(project.path, { platform }) === repositoryPath)
    : undefined
  const scopedProjectIds = projectIds

  return {
    projectIds: scopedProjectIds,
    defaultProjectId: matchedProject?.id ?? scopedProjectIds[0],
    repositoryId: activeRepository?.uuid,
    repositoryName: activeRepository?.name,
  }
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

export {
  resolveAgentProjectScope,
  type AgentProjectScope,
}
