import { describe, expect, it } from "vitest"

import type {
  ConnectorEntryV1,
  DataNamespace,
  DataRepository,
  SecretEntryV1,
} from "../../../runtime/data-repo"
import { FeishuSetupService } from "../feishu/setup-service"

describe("FeishuSetupService", () => {
  it("begins, polls, and saves Feishu credentials into secrets plus connector metadata", async () => {
    const dataRepository = new MemoryDataRepository()
    const calls: string[] = []
    const service = new FeishuSetupService({
      dataRepository,
      now: () => new Date("2026-04-26T00:00:00.000Z"),
      registrationClient: {
        async call(request) {
          calls.push(request.action)
          if (request.action === "begin") {
            return {
              device_code: "device-1",
              verification_uri_complete: "https://accounts.feishu.cn/qr",
              interval: 3,
              expires_in: 60,
            }
          }
          return {
            client_id: "cli_a",
            client_secret: "secret_a",
            owner_open_id: "ou_owner",
          }
        },
      },
    })

    const begin = await service.beginSetup("project-1")
    expect(begin).toEqual(expect.objectContaining({
      deviceCode: "device-1",
      qrUrl: "https://accounts.feishu.cn/qr",
      intervalSeconds: 3,
    }))

    const poll = await service.pollSetup(begin.setupId)
    expect(poll).toEqual({
      status: "completed",
      appId: "cli_a",
      ownerOpenId: "ou_owner",
    })

    const summary = await service.saveSetup(begin.setupId)
    expect(summary).toEqual(expect.objectContaining({
      projectId: "project-1",
      platform: "feishu",
      appId: "cli_a",
      ownerOpenId: "ou_owner",
      status: "disabled",
    }))
    expect(JSON.stringify(summary)).not.toContain("secret_a")
    expect(await service.readSecret("project-1")).toEqual({
      platform: "feishu",
      appId: "cli_a",
      appSecret: "secret_a",
    })
    expect(calls).toEqual(["begin", "poll"])
  })

  it("saves manual credentials without exposing appSecret in connector data", async () => {
    const dataRepository = new MemoryDataRepository()
    const service = new FeishuSetupService({ dataRepository })

    const summary = await service.saveManualCredentials({
      projectId: "project-1",
      appId: "cli_manual",
      appSecret: "secret_manual",
      ownerOpenId: "ou_owner",
    })

    const connector = await dataRepository.namespace<ConnectorEntryV1>("connectors").get("feishu:project-1")
    const secret = await dataRepository.namespace<SecretEntryV1>("secrets").get("feishu:project-1:credentials")
    expect(summary.appId).toBe("cli_manual")
    expect(JSON.stringify(connector)).not.toContain("secret_manual")
    expect(secret?.value).toContain("secret_manual")
  })
})

class MemoryDataRepository implements DataRepository {
  private readonly namespaces = new Map<string, MemoryNamespace<Record<string, unknown> & { id: string }>>()

  namespace<T>(name: string): DataNamespace<T> {
    let namespace = this.namespaces.get(name)
    if (!namespace) {
      namespace = new MemoryNamespace(name)
      this.namespaces.set(name, namespace)
    }
    return namespace as unknown as DataNamespace<T>
  }

  async exportAll() {
    return { format: "synapse-backup-v1" as const, exportedAt: "", namespaces: [] }
  }

  async importAll(): Promise<void> {}

  inspect() {
    return []
  }
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  private readonly items = new Map<string, T>()

  constructor(readonly name: string) {}

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(_value: T): Promise<void> {}

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.items.values()]
    if (!filter) return values
    return values.filter((item) =>
      Object.entries(filter).every(([key, value]) => item[key as keyof T] === value),
    )
  }

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    this.items.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id)
  }

  onChange(): () => void {
    return () => {}
  }
}
