import { describe, expect, it } from "vitest"

import type { AuditEntryV1, DataNamespace } from "../../data-repo"
import { DataRepositoryAuditSink } from "../index"

describe("DataRepositoryAuditSink metadata redaction", () => {
  it("redacts camelCase and separated secret metadata keys", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-secret-keys",
      now: () => new Date("2026-05-19T00:00:00.000Z"),
    })

    sink.record({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "skill-env-binding",
      outcome: "allowed",
      metadata: {
        secretName: "PRODUCTION_TOKEN",
        api_key_name: "INTERNAL_API_KEY",
        accessTokenLabel: "tenant-token",
        projectId: "project-1",
      },
    })
    await sink.flushForTests()

    expect(namespace.items[0]?.metadata).toEqual({
      secretName: "[redacted]",
      api_key_name: "[redacted]",
      accessTokenLabel: "[redacted]",
      projectId: "project-1",
    })
    expect(JSON.stringify(namespace.items)).not.toContain("PRODUCTION_TOKEN")
    expect(JSON.stringify(namespace.items)).not.toContain("INTERNAL_API_KEY")
    expect(JSON.stringify(namespace.items)).not.toContain("tenant-token")
  })

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

  it("redacts POSIX absolute paths in metadata values before persistence", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-path",
      now: () => new Date("2026-05-19T00:00:00.000Z"),
    })

    sink.record({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "run_as_user:preflight",
      outcome: "allowed",
      metadata: {
        projectId: "project-1",
        workspacePath: "/Users/alice/private/repo",
        nested: {
          filePath: "failed at /home/alice/.config/token.txt",
        },
      },
    })
    await sink.flushForTests()

    expect(namespace.items[0]?.metadata).toEqual({
      projectId: "project-1",
      workspacePath: "[path]",
      nested: {
        filePath: "failed at [path]",
      },
    })
    expect(JSON.stringify(namespace.items)).not.toContain("/Users/alice")
    expect(JSON.stringify(namespace.items)).not.toContain("/home/alice")
  })

  it("redacts Windows absolute paths in metadata values before persistence", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-windows-path",
      now: () => new Date("2026-05-19T00:00:00.000Z"),
    })

    sink.record({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "config-import",
      outcome: "allowed",
      metadata: {
        projectId: "project-1",
        backupPath: "C:\\Users\\Ada Lovelace\\Downloads\\synapse-backup.zip",
        nested: {
          filePath: "failed at \\\\fileserver\\Audit Share\\logs\\audit.txt",
        },
      },
    })
    await sink.flushForTests()

    expect(namespace.items[0]?.metadata).toEqual({
      projectId: "project-1",
      backupPath: "[path]",
      nested: {
        filePath: "failed at [path]",
      },
    })
    expect(JSON.stringify(namespace.items)).not.toContain("C:\\Users\\Ada Lovelace")
    expect(JSON.stringify(namespace.items)).not.toContain("\\\\fileserver\\Audit Share")
  })

  it("redacts POSIX absolute paths in resources before caching and persistence", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-resource-path",
      now: () => new Date("2026-05-19T00:00:00.000Z"),
    })

    sink.record({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/Users/alice/private/repo/config.json token=sk-test-secret",
      outcome: "allowed",
    })
    await sink.flushForTests()

    expect(sink.list()[0]?.resource).toBe("[path] token=[redacted]")
    expect(namespace.items[0]?.resource.id).toBe("[path] token=[redacted]")
    expect(JSON.stringify(sink.list())).not.toContain("/Users/alice")
    expect(JSON.stringify(namespace.items)).not.toContain("/Users/alice")
    expect(JSON.stringify(namespace.items)).not.toContain("sk-test-secret")
  })

  it("redacts Windows absolute paths in resources before caching and persistence", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-resource-windows-path",
      now: () => new Date("2026-05-19T00:00:00.000Z"),
    })

    sink.record({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "C:\\Users\\Ada Lovelace\\Downloads\\synapse-logs.zip token=sk-test-secret",
      outcome: "allowed",
    })
    await sink.flushForTests()

    expect(sink.list()[0]?.resource).toBe("[path] token=[redacted]")
    expect(namespace.items[0]?.resource.id).toBe("[path] token=[redacted]")
    expect(JSON.stringify(sink.list())).not.toContain("C:\\Users\\Ada Lovelace")
    expect(JSON.stringify(namespace.items)).not.toContain("C:\\Users\\Ada Lovelace")
    expect(JSON.stringify(namespace.items)).not.toContain("sk-test-secret")
  })

  it("redacts sensitive URL query parameters in resources before caching and persistence", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-resource-url",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    })

    sink.record({
      action: "network.connect",
      actor: { kind: "user" },
      resource: "https://docs.example.test/source.pdf?access_token=raw-token&X-Amz-Signature=raw-signature&sig=raw-sig&safe=visible",
      outcome: "allowed",
    })
    await sink.flushForTests()

    expect(sink.list()[0]?.resource).toContain("safe=visible")
    expect(sink.list()[0]?.resource).toContain("access_token=%5Bredacted%5D")
    expect(sink.list()[0]?.resource).toContain("X-Amz-Signature=%5Bredacted%5D")
    expect(namespace.items[0]?.resource.id).toBe(sink.list()[0]?.resource)
    expect(JSON.stringify(sink.list())).not.toContain("raw-token")
    expect(JSON.stringify(sink.list())).not.toContain("raw-signature")
    expect(JSON.stringify(sink.list())).not.toContain("raw-sig")
    expect(JSON.stringify(namespace.items)).not.toContain("raw-token")
    expect(JSON.stringify(namespace.items)).not.toContain("raw-signature")
    expect(JSON.stringify(namespace.items)).not.toContain("raw-sig")
  })

  it("redacts command args and sensitive string values before persistence", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-command-args",
      now: () => new Date("2026-05-19T00:00:00.000Z"),
    })

    sink.record({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "cmd.exe",
      outcome: "allowed",
      metadata: {
        args: ["/c", "curl -H Authorization: Bearer sk-live-secret https://example.test"],
        launchArgs: ["-Command", "Write-Output token=one-time-secret"],
        nested: {
          note: "Authorization: Bearer nested-secret apiKey=nested-api-key",
        },
      },
    })
    await sink.flushForTests()

    expect(namespace.items[0]?.metadata).toEqual({
      args: "[redacted]",
      launchArgs: "[redacted]",
      nested: {
        note: "Authorization: [redacted] apiKey=[redacted]",
      },
    })
    expect(JSON.stringify(namespace.items)).not.toContain("sk-live-secret")
    expect(JSON.stringify(namespace.items)).not.toContain("one-time-secret")
    expect(JSON.stringify(namespace.items)).not.toContain("nested-secret")
    expect(JSON.stringify(namespace.items)).not.toContain("nested-api-key")
  })

  it("redacts cookie fragments before caching persistence and logging", async () => {
    const namespace = new FakeAuditNamespace(
      new Error("write failed Cookie: persist_sid=persist-secret at /tmp/audit.jsonl"),
    )
    const warnings: unknown[] = []
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      logger: { warn: (_message, meta) => warnings.push(meta) },
      idFactory: () => "audit-cookie",
      now: () => new Date("2026-06-20T00:00:00.000Z"),
    })

    sink.record({
      action: "network.connect",
      actor: { kind: "agent", id: "diagnostics" },
      resource: "https://example.test Cookie: sid=resource-secret; theme=light",
      outcome: "failed",
      metadata: {
        cookie: "sid=metadata-key-secret",
        error: "request failed Cookie: sid=header-secret; session=second-secret",
        nested: {
          detail: "curl failed cookie=session=assignment-secret",
        },
      },
    })
    await sink.flushForTests()

    const serializedEvents = JSON.stringify(sink.list())
    const serializedWarnings = JSON.stringify(warnings)

    expect(serializedEvents).toContain("Cookie: [redacted]")
    expect(serializedEvents).toContain("cookie=[redacted]")
    expect(serializedEvents).not.toContain("resource-secret")
    expect(serializedEvents).not.toContain("metadata-key-secret")
    expect(serializedEvents).not.toContain("header-secret")
    expect(serializedEvents).not.toContain("second-secret")
    expect(serializedEvents).not.toContain("assignment-secret")
    expect(serializedWarnings).toContain("Cookie: [redacted]")
    expect(serializedWarnings).not.toContain("persist-secret")
  })

  it("preserves operational error metadata while sanitizing sensitive fragments", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-error-message",
      now: () => new Date("2026-06-05T00:00:00.000Z"),
    })

    sink.record({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "run_as_user:command",
      outcome: "failed",
      metadata: {
        error: "spawn failed token=sk-test-secret at /Users/alice/private/script.sh",
        nested: {
          errors: ["Authorization: Bearer nested-secret failed at C:\\Users\\Ada\\secret.log"],
        },
      },
    })
    await sink.flushForTests()

    expect(namespace.items[0]?.metadata).toEqual({
      error: "spawn failed token=[redacted] at [path]",
      nested: {
        errors: ["Authorization: [redacted] failed at [path]"],
      },
    })
    expect(JSON.stringify(namespace.items)).not.toContain("sk-test-secret")
    expect(JSON.stringify(namespace.items)).not.toContain("nested-secret")
    expect(JSON.stringify(namespace.items)).not.toContain("/Users/alice")
    expect(JSON.stringify(namespace.items)).not.toContain("C:\\Users\\Ada")
  })

  it("redacts persistence failure error messages before logging", async () => {
    const namespace = new FakeAuditNamespace(
      new Error("write failed Authorization: Bearer audit-secret token=raw-token at /Users/alice/private/audit.jsonl"),
    )
    const warnings: unknown[] = []
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      logger: { warn: (_message, meta) => warnings.push(meta) },
      idFactory: () => "audit-persist-failure",
      now: () => new Date("2026-06-05T00:00:00.000Z"),
    })

    sink.record({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/Users/alice/private/target.json",
      outcome: "failed",
    })
    await sink.flushForTests()

    expect(warnings).toEqual([
      expect.objectContaining({
        action: "fs.write",
        error: "write failed Authorization: [redacted] token=[redacted] at [path]",
      }),
    ])
    expect(JSON.stringify(warnings)).not.toContain("audit-secret")
    expect(JSON.stringify(warnings)).not.toContain("raw-token")
    expect(JSON.stringify(warnings)).not.toContain("/Users/alice")
  })

  it("keeps request and prompt body metadata redacted", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-request-body",
      now: () => new Date("2026-06-05T00:00:00.000Z"),
    })

    sink.record({
      action: "network.connect",
      actor: { kind: "agent", id: "diagnostics" },
      resource: "https://api.example.test",
      outcome: "denied",
      metadata: {
        body: "raw request body",
        content: "generated content",
        message: "user message",
        reason: "policy reason",
        text: "plain text body",
      },
    })
    await sink.flushForTests()

    expect(namespace.items[0]?.metadata).toEqual({
      body: "[redacted]",
      content: "[redacted]",
      message: "[redacted]",
      reason: "[redacted]",
      text: "[redacted]",
    })
  })
})

class FakeAuditNamespace implements DataNamespace<AuditEntryV1> {
  readonly name = "audit"
  readonly schemaVersion = 1
  readonly backend = "jsonl"
  readonly items: AuditEntryV1[] = []
  private readonly error?: unknown

  constructor(error?: unknown) {
    this.error = error
  }

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
    if (this.error) throw this.error
    this.items.push(item)
  }

  async remove(_id: string): Promise<void> {}

  onChange(): () => void {
    return () => {}
  }
}
