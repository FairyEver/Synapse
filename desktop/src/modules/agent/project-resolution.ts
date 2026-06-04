import { DEFAULT_AGENT_WORKSPACE_PROJECT_ID } from "@/lib/default-agent-workspace"
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
  const configuredProjectIds = unique(projects.map((project) => project.id).filter(Boolean))
    .filter((projectId) => projectId !== DEFAULT_AGENT_WORKSPACE_PROJECT_ID)
  const projectIds = [DEFAULT_AGENT_WORKSPACE_PROJECT_ID, ...configuredProjectIds]
  const repositoryPath = normalizePathForCompare(activeRepository?.localPath ?? "", { platform })
  const matchedProject = repositoryPath
    ? projects.find((project) => normalizePathForCompare(project.path, { platform }) === repositoryPath)
    : undefined

  return {
    projectIds,
    defaultProjectId: matchedProject?.id ?? DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
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
