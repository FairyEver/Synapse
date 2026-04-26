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
})
