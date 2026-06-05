import type { SynapseConfigPatch, SynapseVariable } from "@/types/config"

type UserVariableChangeSet = {
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

function buildUserVariableChangeSet(
  variables: SynapseVariable[],
  substitutions: Record<string, string>,
): UserVariableChangeSet {
  const existingVariables = variables
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

function hasUserVariableChanges(changeSet: UserVariableChangeSet): boolean {
  return changeSet.newVariables.length > 0 || changeSet.updatedVariables.length > 0
}

function buildUserVariablesPatch(
  variables: SynapseVariable[],
  changeSet: UserVariableChangeSet,
): Pick<SynapseConfigPatch, "global"> | null {
  if (!hasUserVariableChanges(changeSet)) {
    return null
  }

  const updatedByName = new Map(
    changeSet.updatedVariables.map((variable) => [
      variable.name.toLowerCase(),
      variable,
    ]),
  )
  const existingVariables = variables
  const nextExistingVariables = existingVariables.map((variable) =>
    updatedByName.get(variable.name.toLowerCase()) ?? variable,
  )

  return {
    global: {
      variables: [...nextExistingVariables, ...changeSet.newVariables],
    },
  }
}

export {
  buildUserVariableChangeSet,
  buildUserVariablesPatch,
  hasUserVariableChanges,
}
export type { UserVariableChangeSet }
