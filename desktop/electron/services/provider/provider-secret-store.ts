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

  async getSecretValue(secretRef: string): Promise<string | undefined> {
    const secret = await this.secrets.get(secretRef)
    if (!secret) return undefined
    return typeof secret.value === "string" ? secret.value : undefined
  }
}

export function providerApiKeySecretId(providerId: string): string {
  return `provider:${providerId}:api-key`
}

function removeUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T
}
