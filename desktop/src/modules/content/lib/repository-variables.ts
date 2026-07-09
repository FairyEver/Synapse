import type { SecretSafeView, SecretUpsertInput } from "../../../../app-capabilities/secrets/shared/schema"

type UserSecretChangeSet = {
  newSecrets: SecretUpsertInput[]
  updatedSecrets: SecretUpsertInput[]
}

function buildUserSecretChangeSet(
  secrets: SecretSafeView[],
  substitutions: Record<string, string>,
  initialValues: Record<string, string> = {},
): UserSecretChangeSet {
  const existingByName = new Map(secrets.map((secret) => [secret.name.toLowerCase(), secret]))
  const initialValueByName = new Map(Object.entries(initialValues).map(([name, value]) => [name.toLowerCase(), value]))
  const newSecrets: SecretUpsertInput[] = []
  const updatedSecrets: SecretUpsertInput[] = []

  for (const [name, value] of Object.entries(substitutions)) {
    if (value.length === 0) continue

    const existing = existingByName.get(name.toLowerCase())
    if (existing && initialValueByName.get(name.toLowerCase()) === value) continue

    if (!existing) {
      newSecrets.push({ name, value })
      continue
    }

    updatedSecrets.push({ name: existing.name, value })
  }

  return { newSecrets, updatedSecrets }
}

function hasUserSecretChanges(changeSet: UserSecretChangeSet): boolean {
  return changeSet.newSecrets.length > 0 || changeSet.updatedSecrets.length > 0
}

export {
  buildUserSecretChangeSet,
  hasUserSecretChanges,
}
export type { UserSecretChangeSet }
