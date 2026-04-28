import type { SynapseRepositoryConfig, SynapseVariable } from "@/types/config"

function buildRepositoryVariablesPatch(
  repository: SynapseRepositoryConfig,
  substitutions: Record<string, string>,
): Pick<SynapseRepositoryConfig, "variables"> | null {
  const existingVariables = repository.variables ?? []
  const newVariables: SynapseVariable[] = []

  for (const [name, value] of Object.entries(substitutions)) {
    if (!value) continue
    const exists = existingVariables.some(
      (variable) => variable.name.toLowerCase() === name.toLowerCase(),
    )
    if (!exists) {
      newVariables.push({ name, value })
    }
  }

  if (newVariables.length === 0) {
    return null
  }

  return {
    variables: [...existingVariables, ...newVariables],
  }
}

export { buildRepositoryVariablesPatch }
