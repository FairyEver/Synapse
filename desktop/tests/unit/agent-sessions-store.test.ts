import { describe, expect, it } from "vitest"
import { AgentSessionsStoreService } from "../../electron/services/agent-sessions-store-service"
import type { SynapseProjectConfig } from "../../src/types/config"

function project(overrides: Partial<SynapseProjectConfig> = {}): SynapseProjectConfig {
  return {
    id: "project-1",
    name: "alpha",
    path: "/tmp/alpha",
    agentType: "codex",
    ...overrides,
  }
}

function clock() {
  let tick = 0
  return () => new Date(Date.UTC(2026, 3, 26, 1, tick += 1, 0))
}

describe("agent sessions store service", () => {
  it("creates real project sessions, lists summaries, and returns bounded history", async () => {
    const service = new AgentSessionsStoreService({ namespace: null, now: clock() })
    const projects = [project()]

    const created = await service.createSession(projects, {
      projectId: "project-1",
      sessionKey: "bridge:web-admin:alpha",
    })
    await service.appendHistoryForTest("project-1", "bridge:web-admin:alpha", "user", "hello")
    await service.appendHistoryForTest("project-1", "bridge:web-admin:alpha", "assistant", "world")

    const list = await service.list(projects)
    expect(list.sessions).toHaveLength(1)
    expect(list.sessions[0]).toMatchObject({
      id: created.id,
      projectId: "project-1",
      projectName: "alpha",
      sessionKey: "bridge:web-admin:alpha",
      platform: "bridge",
      agentType: "codex",
      active: true,
      live: false,
      historyCount: 2,
      lastMessage: {
        role: "assistant",
        content: "world",
      },
    })

    const detail = await service.getDetail(projects, {
      projectId: "project-1",
      sessionId: created.id,
      historyLimit: 1,
    })
    expect(detail.history.map((entry) => [entry.role, entry.content])).toEqual([
      ["assistant", "world"],
    ])
  })

  it("switches by session id and reports missing sessions", async () => {
    const service = new AgentSessionsStoreService({ namespace: null, now: clock() })
    const projects = [project()]
    const first = await service.createSession(projects, {
      projectId: "project-1",
      sessionKey: "telegram:user",
      name: "main",
    })
    const second = await service.createSession(projects, {
      projectId: "project-1",
      sessionKey: "telegram:user",
      name: "analysis",
    })

    await expect(service.switchSession(projects, {
      projectId: "project-1",
      sessionKey: "telegram:user",
      sessionId: first.id,
    })).resolves.toMatchObject({ id: first.id, active: true })

    await expect(service.getDetail(projects, {
      projectId: "project-1",
      sessionId: "missing",
    })).rejects.toThrow("session not found")
    await expect(service.switchSession(projects, {
      projectId: "project-1",
      sessionKey: "telegram:user",
      sessionId: second.id,
    })).resolves.toMatchObject({ id: second.id, active: true })
  })

  it("sends messages through the main-side engine success, error, and timeout paths", async () => {
    const service = new AgentSessionsStoreService({ namespace: null, now: clock() })
    const projects = [project()]
    const created = await service.createSession(projects, {
      projectId: "project-1",
      sessionKey: "bridge:web-admin:alpha",
    })

    const completed = await service.sendMessage(projects, {
      projectId: "project-1",
      sessionId: created.id,
      sessionKey: created.sessionKey,
      message: "hello",
    }, {
      events: [
        { type: "text", content: "hi ", sessionId: "agent-1" },
        { type: "result", content: "hi there", done: true },
      ],
    })

    expect(completed).toMatchObject({
      status: "completed",
      response: "hi there",
      error: null,
      events: [
        { seq: 1, type: "text", payload: { content: "hi ", agentSessionId: "agent-1" } },
        { seq: 2, type: "result", payload: { content: "hi there", done: true } },
      ],
      pendingPermission: null,
      session: {
        agentSessionId: "agent-1",
        historyCount: 2,
      },
    })
    expect(completed.session.history.map((entry) => [entry.role, entry.content])).toEqual([
      ["user", "hello"],
      ["assistant", "hi there"],
    ])

    const failed = await service.sendMessage(projects, {
      projectId: "project-1",
      sessionId: created.id,
      sessionKey: created.sessionKey,
      message: "fail",
    }, {
      events: [{ type: "error", error: "agent failed" }],
    })

    expect(failed).toMatchObject({
      status: "error",
      error: "agent failed",
    })
    expect(failed.session.history.at(-1)).toMatchObject({
      role: "user",
      content: "fail",
    })

    const timedOut = await service.sendMessage(projects, {
      projectId: "project-1",
      sessionId: created.id,
      sessionKey: created.sessionKey,
      message: "slow",
    }, {
      idleTimeoutMs: 100,
      eventGapsMs: [150],
      events: [{ type: "text", content: "late" }],
    })

    expect(timedOut).toMatchObject({
      status: "timed_out",
      error: "agent session timed out (no response)",
    })
  })

  it("returns ordered event records and accepts pending permission responses", async () => {
    const service = new AgentSessionsStoreService({ namespace: null, now: clock() })
    const projects = [project()]
    const created = await service.createSession(projects, {
      projectId: "project-1",
      sessionKey: "bridge:web-admin:alpha",
    })

    const waiting = await service.sendMessage(projects, {
      projectId: "project-1",
      sessionId: created.id,
      sessionKey: created.sessionKey,
      message: "edit file",
    }, {
      events: [
        { type: "thinking", content: "checking files" },
        { type: "tool_use", toolName: "Bash", toolInput: "ls" },
        {
          type: "tool_result",
          toolName: "Bash",
          toolResult: "README.md",
          toolStatus: "completed",
          toolExitCode: 0,
          toolSuccess: true,
        },
        {
          type: "permission_request",
          requestId: "perm-1",
          toolName: "Write",
          toolInput: "update README.md",
          toolInputRaw: { file_path: "README.md" },
        },
      ],
    })

    expect(waiting.status).toBe("waiting_permission")
    expect(waiting.events.map((event) => [event.seq, event.type])).toEqual([
      [1, "thinking"],
      [2, "tool_use"],
      [3, "tool_result"],
      [4, "permission_request"],
    ])
    expect(waiting.pendingPermission).toEqual({
      requestId: "perm-1",
      toolName: "Write",
      toolInput: "update README.md",
      toolInputRaw: { file_path: "README.md" },
      questions: [],
    })

    const response = await service.respondPermission(projects, {
      projectId: "project-1",
      sessionId: created.id,
      requestId: "perm-1",
      decision: "allow",
    })

    expect(response).toMatchObject({
      status: "accepted",
      event: {
        seq: 5,
        type: "permission_response",
        payload: {
          requestId: "perm-1",
          decision: "allow",
        },
      },
      pendingPermission: null,
    })

    await expect(service.respondPermission(projects, {
      projectId: "project-1",
      sessionId: created.id,
      requestId: "perm-1",
      decision: "deny",
    })).rejects.toThrow("permission request not found")
  })

  it("lists and executes safe commands with disabled-command filtering", async () => {
    const service = new AgentSessionsStoreService({ namespace: null, now: clock() })
    const projects = [project({ disabledCommands: ["upgrade"] })]
    const created = await service.createSession(projects, {
      projectId: "project-1",
      sessionKey: "bridge:web-admin:alpha",
    })

    const catalog = await service.listCommands(projects, { projectId: "project-1" })
    expect(catalog.commands.find((command) => command.id === "status")).toMatchObject({
      command: "/status",
      group: "info",
      disabled: false,
    })
    expect(catalog.commands.find((command) => command.id === "upgrade")).toMatchObject({
      command: "/upgrade",
      disabled: true,
      highRisk: true,
    })

    const status = await service.executeCommand(projects, {
      projectId: "project-1",
      sessionId: created.id,
      sessionKey: created.sessionKey,
      command: "/status",
    })

    expect(status).toMatchObject({
      status: "completed",
      command: "/status",
      title: "状态",
      error: null,
      requiresPermission: false,
    })
    expect(status.content).toContain("项目：alpha")

    await service.appendHistoryForTest("project-1", "bridge:web-admin:alpha", "user", "hello")
    const history = await service.executeCommand(projects, {
      projectId: "project-1",
      sessionId: created.id,
      command: "/history",
    })
    expect(history.content).toContain("user: hello")

    const skills = await service.executeCommand(projects, {
      projectId: "project-1",
      sessionId: created.id,
      command: "/skills",
    })
    expect(skills.content).toBe("进入技能 > 项目扫描。")

    const disabled = await service.executeCommand(projects, {
      projectId: "project-1",
      sessionId: created.id,
      command: "/upgrade",
    })
    expect(disabled).toMatchObject({
      status: "error",
      error: "command disabled",
    })
  })

  it("creates a new session from /new and gates high-risk commands", async () => {
    const service = new AgentSessionsStoreService({ namespace: null, now: clock() })
    const projects = [project()]
    const created = await service.createSession(projects, {
      projectId: "project-1",
      sessionKey: "bridge:web-admin:alpha",
    })

    const next = await service.executeCommand(projects, {
      projectId: "project-1",
      sessionId: created.id,
      sessionKey: created.sessionKey,
      command: "/new research",
    })
    expect(next.status).toBe("completed")
    expect(next.session).toMatchObject({
      name: "research",
      sessionKey: created.sessionKey,
    })
    expect(next.session?.id).not.toBe(created.id)

    const gated = await service.executeCommand(projects, {
      projectId: "project-1",
      sessionId: next.session?.id ?? created.id,
      sessionKey: created.sessionKey,
      command: "/shell ls",
    })
    expect(gated).toMatchObject({
      status: "permission_required",
      requiresPermission: true,
    })

    const denied = await service.executeCommand(projects, {
      projectId: "project-1",
      sessionId: next.session?.id ?? created.id,
      sessionKey: created.sessionKey,
      command: "/shell ls",
      permissionDecision: "deny",
    })
    expect(denied.status).toBe("denied")

    const allowed = await service.executeCommand(projects, {
      projectId: "project-1",
      sessionId: next.session?.id ?? created.id,
      sessionKey: created.sessionKey,
      command: "/shell ls",
      permissionDecision: "allow",
    })
    expect(allowed).toMatchObject({
      status: "error",
      error: "runtime not connected",
    })
  })

  it("rejects empty input before starting an engine turn", async () => {
    const service = new AgentSessionsStoreService({ namespace: null, now: clock() })
    const projects = [project()]
    const created = await service.createSession(projects, {
      projectId: "project-1",
      sessionKey: "bridge:web-admin:alpha",
    })

    await expect(service.sendMessage(projects, {
      projectId: "project-1",
      sessionId: created.id,
      message: "   ",
    })).rejects.toThrow("message is required")
  })
})
