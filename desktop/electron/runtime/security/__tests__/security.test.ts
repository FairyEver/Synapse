import { describe, expect, it } from "vitest"
import type { AuditEntryV1, DataNamespace } from "../../data-repo"
import {
  DataRepositoryAuditSink,
  InMemoryAuditSink,
  createPermissionGuard,
  systemAutomationPolicy,
  systemDataMaintenancePolicy,
  systemMcpAutoRegisterPolicy,
  systemShellExecPolicy,
  userInitiatedAllowPolicy,
  webhookShellExecPolicy,
  type PermissionPolicy,
  type PermissionRequest,
} from "../index"

const userReq: PermissionRequest = {
  action: "fs.write",
  actor: { kind: "user" },
  resource: "/tmp/x",
  context: {},
}
const agentReq: PermissionRequest = {
  action: "fs.write",
  actor: { kind: "agent", id: "claude" },
  resource: "/tmp/x",
  context: {},
}
const systemMcpAutoRegisterReq: PermissionRequest = {
  action: "fs.write",
  actor: { kind: "system", id: "database" },
  resource: "/Users/test/.claude.json",
  context: {
    operation: "register",
    settingsPath: "/Users/test/.claude.json",
    source: "database.mcp.autoRegister",
    target: "claude",
  },
}

describe("PermissionGuard (T6.6)", () => {
  it("user actions are allowed by default (no policies registered)", async () => {
    const guard = createPermissionGuard()
    expect((await guard.check(userReq)).allowed).toBe(true)
  })

  it("agent actions are denied by default", async () => {
    const guard = createPermissionGuard()
    const result = await guard.check(agentReq)
    expect(result.allowed).toBe(false)
  })

  it("policy 'allow' short-circuits the chain", async () => {
    const guard = createPermissionGuard()
    const allow: PermissionPolicy = { id: "allow-all", decide: () => "allow" }
    const deny: PermissionPolicy = { id: "deny-all", decide: () => "deny" }
    guard.registerPolicy(allow)
    guard.registerPolicy(deny)
    expect((await guard.check(agentReq)).allowed).toBe(true)
  })

  it("policy 'deny' short-circuits with the policy id", async () => {
    const guard = createPermissionGuard()
    guard.registerPolicy({ id: "deny-net", decide: () => "deny" })
    const result = await guard.check(userReq)
    expect(result.allowed).toBe(false)
    expect(result.allowed === false ? result.policyId : "").toBe("deny-net")
  })

  it("policy 'defer-to-next' lets the next policy decide", async () => {
    const guard = createPermissionGuard()
    guard.registerPolicy({ id: "p1", decide: () => "defer-to-next" })
    guard.registerPolicy({ id: "p2", decide: () => "deny" })
    const result = await guard.check(userReq)
    expect(result.allowed).toBe(false)
    expect(result.allowed === false ? result.policyId : "").toBe("p2")
  })

  it("policy 'prompt' degrades to allow for user, deny for agent", async () => {
    const guard = createPermissionGuard()
    guard.registerPolicy({ id: "ask", decide: () => "prompt" })
    expect((await guard.check(userReq)).allowed).toBe(true)
    expect((await guard.check(agentReq)).allowed).toBe(false)
  })

  it("userInitiatedAllowPolicy short-circuits user requests", async () => {
    const guard = createPermissionGuard()
    guard.registerPolicy(userInitiatedAllowPolicy)
    expect((await guard.check(userReq)).allowed).toBe(true)
    // agent reaches the default-deny.
    expect((await guard.check(agentReq)).allowed).toBe(false)
  })

  it("systemMcpAutoRegisterPolicy allows only database MCP auto-registration writes", async () => {
    const guard = createPermissionGuard()
    guard.registerPolicy(systemMcpAutoRegisterPolicy)

    expect((await guard.check(systemMcpAutoRegisterReq)).allowed).toBe(true)
    expect((await guard.check({
      ...systemMcpAutoRegisterReq,
      context: { source: "database.mcp.register", target: "claude" },
    })).allowed).toBe(false)
    expect((await guard.check({
      ...systemMcpAutoRegisterReq,
      actor: { kind: "system", id: "automation" },
    })).allowed).toBe(false)
    expect((await guard.check({
      ...systemMcpAutoRegisterReq,
      action: "shell.exec",
    })).allowed).toBe(false)
    expect((await guard.check({
      ...systemMcpAutoRegisterReq,
      context: {
        ...systemMcpAutoRegisterReq.context,
        operation: "read",
      },
    })).allowed).toBe(false)
    expect((await guard.check({
      ...systemMcpAutoRegisterReq,
      context: {
        ...systemMcpAutoRegisterReq.context,
        settingsPath: "/Users/test/.cursor/mcp.json",
      },
    })).allowed).toBe(false)
  })

  it("systemAutomationPolicy allows system workflow runs without allowing workflow mutations", async () => {
    const guard = createPermissionGuard()
    guard.registerPolicy(systemAutomationPolicy)

    expect((await guard.check({
      action: "workflow.run",
      actor: { kind: "system", id: "automation" },
      resource: "builtin.workflow:wf-1",
      context: { source: "automation" },
    })).allowed).toBe(true)
    expect((await guard.check({
      action: "workflow.mutate",
      actor: { kind: "system", id: "automation" },
      resource: "wf-1",
      context: { source: "automation" },
    })).allowed).toBe(false)
  })

  it("systemDataMaintenancePolicy is limited to the built-in runtime-data cleanup", async () => {
    const guard = createPermissionGuard()
    guard.registerPolicy(systemDataMaintenancePolicy)
    const request: PermissionRequest = {
      action: "database.mutate",
      actor: { kind: "system", id: "data-maintenance" },
      resource: "runtime-data",
      context: { source: "core.data-maintenance" },
    }

    expect((await guard.check(request)).allowed).toBe(true)
    expect((await guard.check({ ...request, resource: "business-data" })).allowed).toBe(false)
    expect((await guard.check({ ...request, actor: { kind: "system", id: "automation" } })).allowed).toBe(false)
    expect((await guard.check({ ...request, action: "fs.write" })).allowed).toBe(false)
  })

  it("default shell policies allow authenticated webhook exec requests", async () => {
    const guard = createPermissionGuard()
    guard.registerPolicy(userInitiatedAllowPolicy)
    guard.registerPolicy(systemShellExecPolicy)
    guard.registerPolicy(systemAutomationPolicy)
    guard.registerPolicy(systemMcpAutoRegisterPolicy)
    guard.registerPolicy(webhookShellExecPolicy)

    expect((await guard.check({
      action: "shell.exec",
      actor: { kind: "agent", id: "webhook" },
      resource: "webhook:/hooks/wh_123",
      context: {
        source: "automation-ingress.webhook",
        runId: "run-1",
      },
    })).allowed).toBe(true)
    expect((await guard.check({
      action: "shell.exec",
      actor: { kind: "agent", id: "claude" },
      resource: "bash",
      context: {},
    })).allowed).toBe(false)
  })
})

describe("InMemoryAuditSink (T6.7)", () => {
  it("record() stamps id + timestamp when missing", () => {
    const sink = new InMemoryAuditSink()
    sink.record({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/tmp/x",
      outcome: "allowed",
    })
    const events = sink.list()
    expect(events).toHaveLength(1)
    expect(events[0]?.id).toMatch(/^audit-/)
    expect(typeof events[0]?.timestamp).toBe("string")
  })

  it("preserves explicit id and timestamp when caller provides them", () => {
    const sink = new InMemoryAuditSink()
    sink.record({
      id: "evt-9000",
      timestamp: "2026-04-25T00:00:00Z",
      action: "shell.exec",
      actor: { kind: "user" },
      resource: "echo hi",
      outcome: "allowed",
    })
    expect(sink.list()[0]?.id).toBe("evt-9000")
    expect(sink.list()[0]?.timestamp).toBe("2026-04-25T00:00:00Z")
  })

  it("clearForTests resets the buffer", () => {
    const sink = new InMemoryAuditSink()
    sink.record({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/tmp/x",
      outcome: "allowed",
    })
    sink.clearForTests()
    expect(sink.list()).toEqual([])
  })
})

describe("DataRepositoryAuditSink", () => {
  it("persists audit entries into the audit namespace", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-1",
      now: () => new Date("2026-04-26T00:00:00.000Z"),
    })

    sink.record({
      action: "agent.spawn",
      actor: { kind: "user" },
      resource: "codex",
      outcome: "allowed",
      metadata: { projectId: "proj-1", conversationId: "conv-1" },
    })
    await sink.flushForTests()

    expect(namespace.items).toEqual([
      {
        id: "audit-1",
        schemaVersion: 1,
        action: "agent.spawn",
        actor: { kind: "user" },
        resource: { type: "agent", id: "codex", projectId: "proj-1" },
        outcome: "allowed",
        timestamp: "2026-04-26T00:00:00.000Z",
        projectId: "proj-1",
        sessionId: "conv-1",
        metadata: { projectId: "proj-1", conversationId: "conv-1" },
      },
    ])
  })

  it("redacts sensitive metadata before persistence", async () => {
    const namespace = new FakeAuditNamespace()
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      idFactory: () => "audit-2",
    })

    sink.record({
      action: "secret.read",
      actor: { kind: "user" },
      resource: "provider-secret",
      outcome: "allowed",
      metadata: {
        Authorization: "Bearer token",
        nested: { apiKey: "sk-test", safe: "value" },
        prompt: "full user prompt",
      },
    })
    await sink.flushForTests()

    expect(namespace.items[0]?.metadata).toEqual({
      Authorization: "[redacted]",
      nested: { apiKey: "[redacted]", safe: "value" },
      prompt: "[redacted]",
    })
  })

  it("logs persistence failures without throwing from record", async () => {
    const namespace = new FakeAuditNamespace(new Error("disk full"))
    const warnings: unknown[] = []
    const sink = new DataRepositoryAuditSink({
      audit: namespace,
      logger: { warn: (_message, meta) => warnings.push(meta) },
      idFactory: () => "audit-3",
    })

    expect(() => sink.record({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/tmp/a",
      outcome: "failed",
    })).not.toThrow()
    await sink.flushForTests()

    expect(warnings).toEqual([
      expect.objectContaining({ action: "fs.write", error: "disk full" }),
    ])
  })
})

class FakeAuditNamespace implements DataNamespace<AuditEntryV1> {
  readonly name = "audit"
  readonly schemaVersion = 1
  readonly backend = "jsonl"
  readonly items: AuditEntryV1[] = []
  private readonly error?: Error

  constructor(error?: Error) {
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
