import { describe, expect, it, vi } from "vitest"
import {
  TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID,
  TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID,
  TERMINAL_GROUP_DELETE_CAPABILITY_ID,
  TERMINAL_GROUP_LIST_CAPABILITY_ID,
  TERMINAL_GROUP_RENAME_CAPABILITY_ID,
  TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
  TERMINAL_SESSION_CREATE_CAPABILITY_ID,
  TERMINAL_SESSION_DELETE_CAPABILITY_ID,
  TERMINAL_SESSION_GET_CAPABILITY_ID,
  TERMINAL_SESSION_LIST_CAPABILITY_ID,
  TERMINAL_SESSION_READ_CAPABILITY_ID,
  TERMINAL_SESSION_RENAME_CAPABILITY_ID,
  TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
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

  it("authorizes group list without auditing saved command text", async () => {
    const group = createGroup({
      settings: {
        commands: [createCommand({ command: "export TOKEN=secret-value" })],
      },
    })
    const listGroups = vi.fn(() => [group])
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { listGroups } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_GROUP_LIST_CAPABILITY_ID, {}, { source: "mcp-http" }))
      .resolves.toEqual({ ok: true, data: [group], affected: 0 })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "terminal:groups",
      context: {
        source: "mcp-http",
        capabilityAction: TERMINAL_GROUP_LIST_CAPABILITY_ID,
        boundary: "terminal.mcp.listGroups",
      },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "terminal:groups",
      outcome: "allowed",
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("secret-value")
  })

  it("records denied group list audits without reading saved commands", async () => {
    const listGroups = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false,
        reason: "blocked by policy",
        policyId: "terminal-deny",
      })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { listGroups } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_GROUP_LIST_CAPABILITY_ID, {}, { source: "mcp-http" }))
      .rejects.toThrow("blocked by policy")

    expect(listGroups).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "terminal:groups",
      outcome: "denied",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_GROUP_LIST_CAPABILITY_ID,
        boundary: "terminal.mcp.listGroups",
        reason: "blocked by policy",
        policyId: "terminal-deny",
      },
    }))
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

  it("authorizes session create before calling service", async () => {
    const created = createSession({ id: "s-created", groupId: "g2" })
    const createSessionFn = vi.fn(async () => created)
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { createSession: createSessionFn } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    const result = await dispatcher.dispatch(TERMINAL_SESSION_CREATE_CAPABILITY_ID, {
      groupId: "g2",
      title: "Build",
      cwd: "/Users/alice/work",
      cols: 120,
      rows: 40,
    }, { source: "mcp-http" })

    expect(createSessionFn).toHaveBeenCalledWith({
      groupId: "g2",
      title: "Build",
      cwd: "/Users/alice/work",
      cols: 120,
      rows: 40,
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "g2",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_CREATE_CAPABILITY_ID,
        boundary: "terminal.mcp.createSession",
        groupId: "g2",
        cols: 120,
        rows: 40,
        cwdProvided: true,
      },
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("/Users/alice/work")
    expect(result).toEqual({ ok: true, data: created, affected: 1 })
  })

  it("records denied session create audits and does not call service", async () => {
    const createSessionFn = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false,
        reason: "blocked by policy",
        policyId: "terminal-deny",
      })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { createSession: createSessionFn } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_SESSION_CREATE_CAPABILITY_ID, {
      groupId: "g2",
      cwd: "/Users/alice/work",
    }, { source: "mcp-http" })).rejects.toThrow("blocked by policy")

    expect(createSessionFn).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "g2",
      outcome: "denied",
      metadata: expect.objectContaining({
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_CREATE_CAPABILITY_ID,
        boundary: "terminal.mcp.createSession",
        groupId: "g2",
        cwdProvided: true,
        reason: "blocked by policy",
        policyId: "terminal-deny",
      }),
    }))
  })

  it("authorizes session list and get before reading terminal metadata", async () => {
    const session = createSession()
    const listSessions = vi.fn(() => [session])
    const getSession = vi.fn(() => session)
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { listSessions, getSession } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_SESSION_LIST_CAPABILITY_ID, {}, { source: "mcp-http" }))
      .resolves.toEqual({ ok: true, data: [session], affected: 0 })
    await expect(dispatcher.dispatch(TERMINAL_SESSION_GET_CAPABILITY_ID, { sessionId: "s1" }, { source: "mcp-http" }))
      .resolves.toEqual({ ok: true, data: session, affected: 0 })

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "terminal:sessions",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_LIST_CAPABILITY_ID,
        boundary: "terminal.mcp.listSessions",
      },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "s1",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_GET_CAPABILITY_ID,
        boundary: "terminal.mcp.getSession",
        sessionId: "s1",
      },
    }))
  })

  it("authorizes session reads without auditing output chunks", async () => {
    const readSession = vi.fn(() => ({
      session: createSession(),
      chunks: [{
        sessionId: "s1",
        seq: 3,
        data: "SECRET_OUTPUT=raw-token\n",
        createdAt: "2026-06-24T00:00:01.000Z",
        source: "pty" as const,
      }],
      nextSeq: 4,
      firstSeq: 3,
      truncated: false,
    }))
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { readSession } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
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
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "s1",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_READ_CAPABILITY_ID,
        boundary: "terminal.mcp.readSession",
        sessionId: "s1",
        afterSeq: 2,
        limitBytes: 1024,
      },
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("SECRET_OUTPUT")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("raw-token")
  })

  it("records denied session read audits and does not call service", async () => {
    const readSession = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false,
        reason: "blocked by policy",
        policyId: "terminal-deny",
      })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { readSession } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_SESSION_READ_CAPABILITY_ID, {
      sessionId: "s1",
      afterSeq: 2,
      limitBytes: 1024,
    }, { source: "mcp-http" })).rejects.toThrow("blocked by policy")

    expect(readSession).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "s1",
      outcome: "denied",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_READ_CAPABILITY_ID,
        boundary: "terminal.mcp.readSession",
        sessionId: "s1",
        afterSeq: 2,
        limitBytes: 1024,
        reason: "blocked by policy",
        policyId: "terminal-deny",
      },
    }))
  })

  it("dispatches rename with parsed input", async () => {
    const renamed = createSession({ title: "Logs" })
    const renameSession = vi.fn(async () => renamed)
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { renameSession } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    const result = await dispatcher.dispatch(TERMINAL_SESSION_RENAME_CAPABILITY_ID, {
      sessionId: "s1",
      title: "  Logs  ",
    }, { source: "mcp-http" })

    expect(renameSession).toHaveBeenCalledWith({
      sessionId: "s1",
      title: "  Logs  ",
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "s1",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_RENAME_CAPABILITY_ID,
        boundary: "terminal.mcp.renameSession",
        sessionId: "s1",
      },
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("Logs")
    expect(result).toEqual({ ok: true, data: renamed, affected: 1 })
  })

  it("authorizes session resize before calling service", async () => {
    const resizeSession = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { resizeSession } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_SESSION_RESIZE_CAPABILITY_ID, {
      sessionId: "s1",
      cols: 120,
      rows: 40,
    }, { source: "mcp-http" })).resolves.toEqual({ ok: true, data: { ok: true }, affected: 1 })

    expect(resizeSession).toHaveBeenCalledWith({ sessionId: "s1", cols: 120, rows: 40 })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "s1",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
        boundary: "terminal.mcp.resizeSession",
        sessionId: "s1",
        cols: 120,
        rows: 40,
      },
    }))
  })

  it.each([
    {
      action: TERMINAL_SESSION_RENAME_CAPABILITY_ID,
      auditMetadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_RENAME_CAPABILITY_ID,
        boundary: "terminal.mcp.renameSession",
        sessionId: "s1",
      },
      params: { sessionId: "s1", title: "Logs" },
      serviceMethod: "renameSession",
    },
    {
      action: TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
      auditMetadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
        boundary: "terminal.mcp.resizeSession",
        sessionId: "s1",
        cols: 120,
        rows: 40,
      },
      params: { sessionId: "s1", cols: 120, rows: 40 },
      serviceMethod: "resizeSession",
    },
  ])("records denied $serviceMethod audits and does not call service", async ({
    action,
    auditMetadata,
    params,
    serviceMethod,
  }) => {
    const serviceCall = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false,
        reason: "blocked by policy",
        policyId: "terminal-deny",
      })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { [serviceMethod]: serviceCall } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(dispatcher.dispatch(action, params, { source: "mcp-http" }))
      .rejects.toThrow("blocked by policy")

    expect(serviceCall).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "s1",
      outcome: "denied",
      metadata: {
        ...auditMetadata,
        reason: "blocked by policy",
        policyId: "terminal-deny",
      },
    }))
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

  it("dispatches group settings update with parsed input", async () => {
    const updated = createGroup({
      name: "构建",
      settings: {
        defaultCwd: "/tmp",
        startupCommand: "pnpm dev",
      },
    })
    const updateGroupSettings = vi.fn(async () => updated)
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { updateGroupSettings } as never,
    })

    const result = await dispatcher.dispatch(TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID, {
      groupId: "g1",
      name: "  构建  ",
      settings: {
        defaultCwd: "/tmp",
        startupCommand: "pnpm dev",
      },
    }, { source: "mcp-http" })

    expect(updateGroupSettings).toHaveBeenCalledWith({
      groupId: "g1",
      name: "  构建  ",
      settings: {
        defaultCwd: "/tmp",
        startupCommand: "pnpm dev",
      },
    })
    expect(result).toEqual({ ok: true, data: updated, affected: 1 })
  })

  it("authorizes group settings updates before calling service as the mcp actor", async () => {
    const updated = createGroup({
      settings: {
        startupCommand: "pnpm dev",
      },
    })
    const updateGroupSettings = vi.fn(async () => updated)
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { updateGroupSettings } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await dispatcher.dispatch(TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID, {
      groupId: "g1",
      name: "Default",
      settings: {
        startupCommand: "pnpm dev",
      },
    }, { source: "mcp-http" })

    expect(updateGroupSettings).toHaveBeenCalledWith({
      groupId: "g1",
      name: "Default",
      settings: {
        startupCommand: "pnpm dev",
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "g1",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
        boundary: "terminal.mcp.updateGroupSettings",
        groupId: "g1",
        byteCount: Buffer.byteLength("pnpm dev"),
      },
    }))
  })

  it("records denied group settings update audits and does not call service", async () => {
    const updateGroupSettings = vi.fn()
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false,
        reason: "blocked by policy",
        policyId: "terminal-deny",
      })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { updateGroupSettings } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    await expect(dispatcher.dispatch(TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID, {
      groupId: "g1",
      name: "Default",
      settings: {
        startupCommand: "pnpm dev",
      },
    }, { source: "mcp-http" })).rejects.toThrow("blocked by policy")

    expect(updateGroupSettings).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "g1",
      outcome: "denied",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
        boundary: "terminal.mcp.updateGroupSettings",
        groupId: "g1",
        byteCount: Buffer.byteLength("pnpm dev"),
        reason: "blocked by policy",
        policyId: "terminal-deny",
      },
    }))
  })

  it("dispatches group command create with permission and audit metadata", async () => {
    const created = createCommand()
    const createGroupCommand = vi.fn(async () => created)
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { createGroupCommand } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    const result = await dispatcher.dispatch(TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID, {
      groupId: "g1",
      name: "dev",
      command: "pnpm dev",
    }, { source: "mcp-http" })

    expect(createGroupCommand).toHaveBeenCalledWith({
      groupId: "g1",
      name: "dev",
      command: "pnpm dev",
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "g1",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_GROUP_COMMAND_CREATE_CAPABILITY_ID,
        boundary: "terminal.mcp.createGroupCommand",
        groupId: "g1",
        byteCount: Buffer.byteLength("pnpm dev"),
      },
    }))
    expect(result).toEqual({ ok: true, data: created, affected: 1 })
  })

  it("dispatches group command launch through the shell permission boundary", async () => {
    const launched = createSession({ id: "session-command", title: "dev" })
    const launchGroupCommand = vi.fn(async () => launched)
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true })),
    }
    const auditSink = { record: vi.fn() }
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { launchGroupCommand } as never,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
    })

    const result = await dispatcher.dispatch(TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID, {
      groupId: "g1",
      commandId: "cmd-dev",
      cols: 100,
      rows: 30,
    }, { source: "mcp-http" })

    expect(launchGroupCommand).toHaveBeenCalledWith({
      groupId: "g1",
      commandId: "cmd-dev",
      cols: 100,
      rows: 30,
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "shell.exec",
      resource: "cmd-dev",
      outcome: "allowed",
      metadata: {
        source: "mcp-http",
        capabilityAction: TERMINAL_GROUP_COMMAND_LAUNCH_CAPABILITY_ID,
        boundary: "terminal.mcp.launchGroupCommand",
        groupId: "g1",
        commandId: "cmd-dev",
      },
    }))
    expect(result).toEqual({ ok: true, data: launched, affected: 1 })
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

function createCommand(overrides: Partial<ReturnType<typeof createCommandBase>> = {}) {
  return {
    ...createCommandBase(),
    ...overrides,
  }
}

function createCommandBase() {
  return {
    id: "cmd-dev",
    name: "dev",
    command: "pnpm dev",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  }
}
