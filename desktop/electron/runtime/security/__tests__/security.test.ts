import { describe, expect, it } from "vitest"
import {
  InMemoryAuditSink,
  createPermissionGuard,
  userInitiatedAllowPolicy,
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
