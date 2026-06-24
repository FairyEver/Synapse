import { describe, expect, it, vi } from "vitest"
import {
  TERMINAL_GROUP_LIST_CAPABILITY_ID,
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

  it("writes as the mcp actor", async () => {
    const writeSession = vi.fn()
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { writeSession } as never,
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
  })

  it("stops as the mcp actor", async () => {
    const stopSession = vi.fn()
    const dispatcher = createTerminalCapabilityDispatcher({
      service: { stopSession } as never,
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
