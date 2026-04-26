import { describe, expect, it } from "vitest"

import type { ConnectorEntryV1, DataNamespace } from "../../../runtime/data-repo"
import { ConnectorRepository } from "../connector-repository"

describe("ConnectorRepository", () => {
  it("creates a Feishu connector without storing the secret value", async () => {
    const repo = new ConnectorRepository({
      connectors: new MemoryNamespace<ConnectorEntryV1>("connectors"),
      now: () => new Date("2026-04-26T00:00:00.000Z"),
    })

    const connector = await repo.create({
      projectId: "project-1",
      platform: "feishu",
      secretRef: "feishu:project-1:credentials",
      appId: "cli_a",
      ownerOpenId: "ou_owner",
      metadata: { secret: "must-not-be-used" },
    })

    expect(connector).toEqual(expect.objectContaining({
      id: "feishu:project-1",
      platform: "feishu",
      secretRef: "feishu:project-1:credentials",
      status: "disabled",
      appId: "cli_a",
      ownerOpenId: "ou_owner",
      allowlist: {
        mode: "users",
        userIds: ["ou_owner"],
        adminIds: ["ou_owner"],
      },
    }))
    expect(JSON.stringify(repo.toFeishuSummary(connector))).not.toContain("must-not-be-used")
  })

  it("updates status, reconnect, and dedupe state in place", async () => {
    const repo = new ConnectorRepository({
      connectors: new MemoryNamespace<ConnectorEntryV1>("connectors"),
      now: () => new Date("2026-04-26T00:00:00.000Z"),
    })
    const connector = await repo.create({ projectId: "project-1", platform: "feishu" })

    await repo.updateStatus(connector.id, "connected", {
      lastConnectedAt: "2026-04-26T00:01:00.000Z",
    })
    await repo.updateDedupe(connector.id, {
      ttlMs: 60_000,
      lastMessageIds: ["m1"],
      ignoreBefore: "2026-04-26T00:00:00.000Z",
    })

    const updated = await repo.get(connector.id)
    expect(updated?.status).toBe("connected")
    expect(updated?.reconnect?.lastConnectedAt).toBe("2026-04-26T00:01:00.000Z")
    expect(updated?.dedupe?.lastMessageIds).toEqual(["m1"])
  })
})

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
