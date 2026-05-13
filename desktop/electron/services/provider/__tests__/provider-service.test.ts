import { describe, expect, it } from "vitest"

import type {
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
  ProviderEntryV1,
  SecretEntryV1,
} from "../../../runtime/data-repo"
import { ProviderService } from "../provider-service"

describe("ProviderService", () => {
  it("stores API keys only in the encrypted secrets namespace", async () => {
    const { service, providers, secrets } = makeProviderService()

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-test",
      env: {},
    })

    await expect(service.buildEnv("anthropic")).resolves.toMatchObject({
      ANTHROPIC_API_KEY: "sk-test",
    })
    await expect(providers.get("anthropic")).resolves.toMatchObject({
      secretRef: "provider:anthropic:api-key",
    })
    await expect(secrets.get("provider:anthropic:api-key")).resolves.toMatchObject({
      kind: "api-key",
      value: "sk-test",
    })
  })

  it("uses ANTHROPIC_AUTH_TOKEN for baseUrl providers", async () => {
    const { service } = makeProviderService()

    await service.createProvider({
      id: "deepseek",
      name: "DeepSeek",
      category: "cn_official",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      apiKey: "token",
      model: "deepseek-chat",
      env: {},
    })

    await expect(service.buildEnv("deepseek")).resolves.toMatchObject({
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: "deepseek-chat",
    })
  })

  it("builds default model env vars from provider model fields", async () => {
    const { service } = makeProviderService()

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-4-5",
      env: {},
    })
    await service.updateProvider("anthropic", {
      haikuModel: "claude-haiku-3-5",
      sonnetModel: "claude-sonnet-4-5",
      opusModel: "claude-opus-4-1",
    })

    await expect(service.buildEnv("anthropic")).resolves.toMatchObject({
      ANTHROPIC_MODEL: "claude-sonnet-4-5",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-3-5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-5",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-1",
    })
  })
})

function makeProviderService() {
  const providers = new MemoryNamespace<ProviderEntryV1>("providers")
  const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
  const service = new ProviderService({ providers, secrets, now: fixedNow })

  return { service, providers, secrets }
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  readonly name: string
  private readonly values = new Map<string, T>()
  private readonly listeners: DataChangeListener<T>[] = []

  constructor(name: string) {
    this.name = name
  }

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(): Promise<void> {}

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.values.values()]
    if (!filter) return values
    return values.filter((value) =>
      Object.entries(filter).every(([key, expected]) =>
        (value as Record<string, unknown>)[key] === expected,
      ),
    )
  }

  async get(id: string): Promise<T | null> {
    return this.values.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    const previous = this.values.get(item.id)
    this.values.set(item.id, item)
    this.emit({
      namespace: this.name,
      kind: "upsert",
      id: item.id,
      value: item,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  async remove(id: string): Promise<void> {
    const previous = this.values.get(id)
    this.values.delete(id)
    this.emit({
      namespace: this.name,
      kind: "remove",
      id,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  onChange(listener: DataChangeListener<T>): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  private emit(event: DataChangeEvent<T>): void {
    for (const listener of this.listeners) listener(event)
  }
}

function fixedNow(): Date {
  return new Date("2026-05-13T00:00:00.000Z")
}
