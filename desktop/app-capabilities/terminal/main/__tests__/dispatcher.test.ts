import { describe, expect, it, vi } from "vitest"
import {
  TERMINAL_GROUP_DELETE_CAPABILITY_ID,
  TERMINAL_GROUP_LIST_CAPABILITY_ID,
  TERMINAL_GROUP_RENAME_CAPABILITY_ID,
  TERMINAL_SESSION_DELETE_CAPABILITY_ID,
  TERMINAL_SESSION_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_READ_CAPABILITY_ID,
  TERMINAL_SESSION_RENAME_CAPABILITY_ID,
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

  it("dispatches rename with parsed input", async () => {
    const renamed = createSession({ title: "Logs" })
    const renameSession = vi.fn(async () => renamed)
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { renameSession } as never,
    })

    const result = await dispatcher.dispatch(TERMINAL_SESSION_RENAME_CAPABILITY_ID, {
      sessionId: "s1",
      title: "  Logs  ",
    }, { source: "mcp-http" })

    expect(renameSession).toHaveBeenCalledWith({
      sessionId: "s1",
      title: "  Logs  ",
    })
    expect(result).toEqual({ ok: true, data: renamed, affected: 1 })
  })

  it("dispatches group rename with parsed input", async () => {
    const renamed = createGroup({ name: "构建" })
    const renameGroup = vi.fn(async () => renamed)
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { renameGroup } as never,
    })

    const result = await dispatcher.dispatch(TERMINAL_GROUP_RENAME_CAPABILITY_ID, {
      groupId: "g1",
      name: "  构建  ",
    }, { source: "mcp-http" })

    expect(renameGroup).toHaveBeenCalledWith({
      groupId: "g1",
      name: "  构建  ",
    })
    expect(result).toEqual({ ok: true, data: renamed, affected: 1 })
  })

  it("authorizes group delete before calling service as the mcp actor", async () => {
    const deleteGroup = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { deleteGroup } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await dispatcher.dispatch(TERMINAL_GROUP_DELETE_CAPABILITY_ID, {
      groupId: "g1",
    }, { source: "mcp-http" })

    expect(deleteGroup).toHaveBeenCalledWith({ groupId: "g1" })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "g1",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_GROUP_DELETE_CAPABILITY_ID,
        boundary: "terminal.mcp.deleteGroup",
        groupId: "g1",
      },
    }))
  })

  it("records denied group delete audits and does not call service", async () => {
    const deleteGroup = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false,
        reason: "blocked by policy",
        policyId: "terminal-deny",
      })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { deleteGroup } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_GROUP_DELETE_CAPABILITY_ID, {
      groupId: "g1",
    }, { source: "mcp-http" })).rejects.toThrow("blocked by policy")

    expect(deleteGroup).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "g1",
      outcome: "denied",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_GROUP_DELETE_CAPABILITY_ID,
        boundary: "terminal.mcp.deleteGroup",
        groupId: "g1",
        reason: "blocked by policy",
        policyId: "terminal-deny",
      },
    }))
  })

  it("records denied delete audits and does not call service", async () => {
    const deleteSession = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false,
        reason: "blocked by policy",
        policyId: "terminal-deny",
      })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { deleteSession } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_SESSION_DELETE_CAPABILITY_ID, {
      sessionId: "s1",
    }, { source: "mcp-http" })).rejects.toThrow("blocked by policy")

    expect(deleteSession).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "s1",
      outcome: "denied",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_DELETE_CAPABILITY_ID,
        boundary: "terminal.mcp.deleteSession",
        sessionId: "s1",
        reason: "blocked by policy",
        policyId: "terminal-deny",
      },
    }))
  })

  it("authorizes delete before calling service as the mcp actor", async () => {
    const deleteSession = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { deleteSession } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await dispatcher.dispatch(TERMINAL_SESSION_DELETE_CAPABILITY_ID, {
      sessionId: "s1",
    }, { source: "mcp-http" })

    expect(deleteSession).toHaveBeenCalledWith({ sessionId: "s1" })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "s1",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_DELETE_CAPABILITY_ID,
        boundary: "terminal.mcp.deleteSession",
        sessionId: "s1",
      },
    }))
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

function createSession(overrides: Partial<ReturnType<typeof createSessionBase>> = {}) {
  return {
    ...createSessionBase(),
    ...overrides,
  }
}

function createSessionBase() {
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
    cols: 80,
    rows: 24,
    lastOutputSeq: 0,
  }
}

function createGroup(overrides: Partial<ReturnType<typeof createGroupBase>> = {}) {
  return {
    ...createGroupBase(),
    ...overrides,
  }
}

function createGroupBase() {
  return {
    id: "g1",
    name: "Default",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    sortOrder: 0,
  }
}
