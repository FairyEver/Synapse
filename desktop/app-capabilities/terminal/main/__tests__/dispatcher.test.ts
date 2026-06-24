import { describe, expect, it, vi } from "vitest"
import {
  TERMINAL_GROUP_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_CREATE_CAPABILITY_ID,
  TERMINAL_SESSION_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_READ_CAPABILITY_ID,
  TERMINAL_SESSION_STOP_CAPABILITY_ID,
  TERMINAL_SESSION_WRITE_CAPABILITY_ID,
} from "../../shared/capability"
import { createTerminalCapabilityDispatcher } from "../dispatcher"

describe("createTerminalCapabilityDispatcher", () => {
  it("rejects extra params for group list", async () => {
    const listGroups = vi.fn(() => [])
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { listGroups } as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_GROUP_LIST_CAPABILITY_ID, {
      unexpected: true,
    }, { source: "mcp-http" })).rejects.toThrow()
    expect(listGroups).not.toHaveBeenCalled()
  })

  it("rejects extra params for session list", async () => {
    const listSessions = vi.fn(() => [])
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { listSessions } as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_SESSION_LIST_CAPABILITY_ID, {
      unexpected: true,
    }, { source: "mcp-http" })).rejects.toThrow()
    expect(listSessions).not.toHaveBeenCalled()
  })

  it("dispatches read with parsed input", async () => {
    const readSession = vi.fn(() => ({
      session: createSession(),
      chunks: [],
      nextSeq: 0,
      firstSeq: 0,
      truncated: false,
    }))
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { readSession } as never,
    })

    await dispatcher.dispatch(TERMINAL_SESSION_READ_CAPABILITY_ID, {
      sessionId: "s1",
      afterSeq: 2,
      limitBytes: 1024,
    }, { source: "mcp-http" })

    expect(readSession).toHaveBeenCalledWith({
      sessionId: "s1",
      afterSeq: 2,
      limitBytes: 1024,
    })
  })

  it("authorizes and audits agent-controlled session creation", async () => {
    const createSessionService = vi.fn(async () => createSession())
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { createSession: createSessionService } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await dispatcher.dispatch(TERMINAL_SESSION_CREATE_CAPABILITY_ID, {
      cwd: "/tmp",
      agentControl: true,
    }, { source: "mcp-http" })

    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "shell.exec",
      actor: { kind: "user", id: "synapse-mcp", display: "Synapse MCP" },
      resource: "/tmp",
      context: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_CREATE_CAPABILITY_ID,
        boundary: "terminal.mcp.agentControl",
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "/tmp",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_CREATE_CAPABILITY_ID,
        boundary: "terminal.mcp.agentControl",
      },
    }))
    expect(createSessionService).toHaveBeenCalledWith({
      cwd: "/tmp",
      agentControl: true,
    })
  })

  it("records denied write audits without input data and does not call service", async () => {
    const writeSession = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false,
        reason: "blocked by policy",
        policyId: "terminal-deny",
      })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { writeSession } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_SESSION_WRITE_CAPABILITY_ID, {
      sessionId: "s1",
      data: "secret input\n",
    }, { source: "mcp-http" })).rejects.toThrow("blocked by policy")

    expect(writeSession).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "s1",
      outcome: "denied",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_WRITE_CAPABILITY_ID,
        boundary: "terminal.mcp.writeSession",
        sessionId: "s1",
        byteCount: Buffer.byteLength("secret input\n"),
        reason: "blocked by policy",
        policyId: "terminal-deny",
      },
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("secret input")
  })

  it("authorizes writes before calling service as the mcp actor", async () => {
    const writeSession = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { writeSession } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await dispatcher.dispatch(TERMINAL_SESSION_WRITE_CAPABILITY_ID, {
      sessionId: "s1",
      data: "pwd\n",
    }, { source: "mcp-http" })

    expect(writeSession).toHaveBeenCalledWith({
      sessionId: "s1",
      data: "pwd\n",
      actor: "mcp",
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "s1",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_WRITE_CAPABILITY_ID,
        boundary: "terminal.mcp.writeSession",
        sessionId: "s1",
        byteCount: Buffer.byteLength("pwd\n"),
      },
    }))
  })

  it("authorizes stop before calling service as the mcp actor", async () => {
    const stopSession = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { stopSession } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await dispatcher.dispatch(TERMINAL_SESSION_STOP_CAPABILITY_ID, {
      sessionId: "s1",
      force: true,
    }, { source: "mcp-http" })

    expect(stopSession).toHaveBeenCalledWith({
      sessionId: "s1",
      force: true,
      actor: "mcp",
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "s1",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_STOP_CAPABILITY_ID,
        boundary: "terminal.mcp.stopSession",
        sessionId: "s1",
        force: true,
      },
    }))
  })

  it("rejects unknown actions", async () => {
    const dispatcher = createTerminalCapabilityDispatcher({
      service: {} as never,
    })

    await expect(dispatcher.dispatch("app.terminal.missing", {}, { source: "mcp-http" }))
      .rejects.toThrow("Unknown terminal action: app.terminal.missing")
  })
})

function createSession() {
  return {
    id: "s1",
    groupId: "g1",
    title: "Shell",
    cwd: "/tmp",
    shell: "/bin/zsh",
    status: "running" as const,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    startedAt: "2026-06-24T00:00:00.000Z",
    agentControl: "enabled" as const,
    cols: 80,
    rows: 24,
    lastOutputSeq: 0,
  }
}
