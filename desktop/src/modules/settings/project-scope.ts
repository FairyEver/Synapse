import type { SynapseProjectConfig, SynapseRepositoryConfig } from "@/types/config"

function resolveSettingsAgentProjectId(
  activeRepository: Pick<SynapseRepositoryConfig, "uuid" | "localPath"> | null | undefined,
  projects: readonly SynapseProjectConfig[],
): string | undefined {
  const repositoryPath = normalizePathForMatch(activeRepository?.localPath ?? "")
  const matchedProject = repositoryPath
    ? projects.find((project) => normalizePathForMatch(project.path) === repositoryPath)
    : undefined

  return matchedProject?.id ?? activeRepository?.uuid ?? projects.find((project) => project.id)?.id
}

function normalizePathForMatch(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const normalized = trimmed.replace(/[\\/]+$/, "")
  return normalized || trimmed
}

export { resolveSettingsAgentProjectId }
