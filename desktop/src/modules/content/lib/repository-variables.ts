import type { SynapseRepositoryConfig, SynapseVariable } from "@/types/config"

type RepositoryVariableChangeSet = {
  newVariables: SynapseVariable[]
  updatedVariables: SynapseVariable[]
}

function findVariable(
  name: string,
  variables: SynapseVariable[],
): SynapseVariable | undefined {
  const normalizedName = name.toLowerCase()

  return variables.find((variable) => variable.name.toLowerCase() === normalizedName)
}

function buildRepositoryVariableChangeSet(
  repository: SynapseRepositoryConfig,
  substitutions: Record<string, string>,
): RepositoryVariableChangeSet {
  const existingVariables = repository.variables ?? []
  const newVariables: SynapseVariable[] = []
  const updatedVariables: SynapseVariable[] = []

  for (const [name, value] of Object.entries(substitutions)) {
    if (!value) continue

    const existing = findVariable(name, existingVariables)

    if (!existing) {
      newVariables.push({ name, value })
      continue
    }

    if (existing.value !== value) {
      updatedVariables.push({ ...existing, value })
    }
  }

  return { newVariables, updatedVariables }
}

function hasRepositoryVariableChanges(changeSet: RepositoryVariableChangeSet): boolean {
  return changeSet.newVariables.length > 0 || changeSet.updatedVariables.length > 0
}

function buildRepositoryVariablesPatch(
  repository: SynapseRepositoryConfig,
  changeSet: RepositoryVariableChangeSet,
): Pick<SynapseRepositoryConfig, "variables"> | null {
  if (!hasRepositoryVariableChanges(changeSet)) {
    return null
  }

  const updatedByName = new Map(
    changeSet.updatedVariables.map((variable) => [
      variable.name.toLowerCase(),
      variable,
    ]),
  )
  const existingVariables = repository.variables ?? []
  const nextExistingVariables = existingVariables.map((variable) =>
    updatedByName.get(variable.name.toLowerCase()) ?? variable,
  )

  return {
    variables: [...nextExistingVariables, ...changeSet.newVariables],
  }
}

export {
  buildRepositoryVariableChangeSet,
  buildRepositoryVariablesPatch,
  hasRepositoryVariableChanges,
}
export type { RepositoryVariableChangeSet }
