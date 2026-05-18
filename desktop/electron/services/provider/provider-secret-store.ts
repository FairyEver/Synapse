import type { DataNamespace, SecretEntryV1 } from "../../runtime/data-repo"

export class ProviderSecretStore {
  private readonly secrets: DataNamespace<SecretEntryV1>

  constructor(secrets: DataNamespace<SecretEntryV1>) {
    this.secrets = secrets
  }

  async setApiKey(providerId: string, value: string, description?: string): Promise<string> {
    const id = providerApiKeySecretId(providerId)
    await this.secrets.upsert(removeUndefined({
      id,
      schemaVersion: 1,
      kind: "api-key",
      value,
      description,
    }))
    return id
  }

  async setEnvSecret(providerId: string, envName: string, value: string, description: string): Promise<string> {
    const id = providerEnvSecretId(providerId, envName)
    await this.secrets.upsert({
      id,
      schemaVersion: 1,
      kind: "generic",
      value,
      description,
    })
    return id
  }

  async getSecretValue(secretRef: string): Promise<string | undefined> {
    const secret = await this.secrets.get(secretRef)
    if (!secret) return undefined
    return typeof secret.value === "string" ? secret.value : undefined
  }

  async deleteSecret(secretRef: string): Promise<void> {
    await this.secrets.remove(secretRef)
  }
}

export function providerApiKeySecretId(providerId: string): string {
  return `provider:${providerId}:api-key`
}

export function providerEnvSecretId(providerId: string, envName: string): string {
  return `provider:${providerId}:env:${envName}`
}

function removeUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T
}
