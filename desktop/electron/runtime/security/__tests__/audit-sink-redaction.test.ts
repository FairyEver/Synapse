import { describe, expect, it } from "vitest"

import type { AuditEntryV1, DataNamespace } from "../../data-repo"
import { DataRepositoryAuditSink } from "../index"

describe("DataRepositoryAuditSink metadata redaction", () => {
  it("redacts session key metadata variants before persistence", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-session-key",
      now: () => new Date("2026-05-19T00:00:00.000Z"),
    })

    sink.record({
      action: "network.connect",
      actor: { kind: "agent", id: "side-channel" },
      resource: "side-channel:/send",
      outcome: "allowed",
      metadata: {
        sessionKey: "bridge:s1",
        session_key: "bridge:s2",
        sourceSessionKey: "bridge:s3",
        nested: { source_session_key: "bridge:s4" },
        projectId: "project-1",
      },
    })
    await sink.flushForTests()

    expect(namespace.items[0]?.metadata).toEqual({
      sessionKey: "[redacted]",
      session_key: "[redacted]",
      sourceSessionKey: "[redacted]",
      nested: { source_session_key: "[redacted]" },
      projectId: "project-1",
    })
    expect(JSON.stringify(namespace.items)).not.toContain("bridge:s")
  })
})

class FakeAuditNamespace implements DataNamespace<AuditEntryV1> {
  readonly name = "audit"
  readonly schemaVersion = 1
  readonly backend = "jsonl"
  readonly items: AuditEntryV1[] = []

  async getSingleton(): Promise<AuditEntryV1 | null> {
    return null
  }

  async setSingleton(_value: AuditEntryV1): Promise<void> {}

  async list(): Promise<AuditEntryV1[]> {
    return this.items.slice()
  }

  async get(id: string): Promise<AuditEntryV1 | null> {
    return this.items.find((item) => item.id === id) ?? null
  }

  async upsert(item: AuditEntryV1): Promise<void> {
    this.items.push(item)
  }

  async remove(_id: string): Promise<void> {}

  onChange(): () => void {
    return () => {}
  }
}
