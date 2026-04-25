import { describe, expect, it } from "vitest"
import {
  AgentSessionsRepository,
  CONTINUE_SESSION,
  findAgentSessionIdFromSnapshots,
  flattenSessionSnapshots,
  matchesProjectSessionFile,
  parseSessionKey,
} from "../../electron/services/sessions-repository-service"

function fixedNow() {
  let tick = 0
  return () => new Date(Date.UTC(2026, 3, 25, 0, tick += 1, 0))
}

describe("agent sessions repository", () => {
  it("creates active sessions, side sessions, switches by id or name, and snapshots state", () => {
    const repo = new AgentSessionsRepository({ now: fixedNow() })
    const active = repo.getOrCreateActive("discord:chat:user")
    const side = repo.newSideSession("discord:chat:user", "analysis")

    expect(active.id).toBe("s1")
    expect(side.id).toBe("s2")
    expect(repo.getOrCreateActive("discord:chat:user").id).toBe("s1")
    expect(repo.switchSession("discord:chat:user", "analysis").id).toBe("s2")
    expect(repo.switchSession("discord:chat:user", "s1").id).toBe("s1")

    const restored = new AgentSessionsRepository({ snapshot: repo.snapshot() })
    expect(restored.getOrCreateActive("discord:chat:user").id).toBe("s1")
  })

  it("normalizes continue sentinel and records past agent session ids", () => {
    const repo = new AgentSessionsRepository({ now: fixedNow() })
    const session = repo.newSession("telegram:1")

    expect(repo.setAgentInfo(session.id, "codex", CONTINUE_SESSION)).toMatchObject({
      agentType: "codex",
      agentSessionId: "",
    })
    expect(() => repo.setAgentSessionId(session.id, CONTINUE_SESSION)).toThrow("continue sentinel")

    repo.setAgentSessionId(session.id, "thread-a")
    repo.setAgentSessionId(session.id, "thread-b")

    expect(repo.findById(session.id)).toMatchObject({
      agentSessionId: "thread-b",
      pastAgentSessionIds: ["thread-a"],
    })
    expect(repo.knownAgentSessionIds()).toEqual(["thread-b", "thread-a"])
    expect(repo.switchToAgentSession("telegram:2", "thread-a").id).toBe(session.id)
    expect(repo.deleteByAgentSessionId("thread-b")).toBe(true)
  })

  it("uses compare-and-set only when the stored agent id is empty or expected", () => {
    const repo = new AgentSessionsRepository({ now: fixedNow() })
    const session = repo.newSession("feishu:u")

    expect(repo.compareAndSetAgentSessionId(session.id, "", "agent-a")?.agentSessionId).toBe("agent-a")
    expect(repo.compareAndSetAgentSessionId(session.id, "", "agent-b")).toBeNull()
    expect(repo.compareAndSetAgentSessionId(session.id, "agent-a", "agent-b")?.agentSessionId).toBe("agent-b")
  })

  it("flattens project snapshots like cc-connect sessions list", () => {
    const repo = new AgentSessionsRepository({ now: fixedNow() })
    const session = repo.newSession("slack:C1:U1", "main")
    repo.setUserMeta("slack:C1:U1", { userName: "Ada", chatName: "Platform" })
    repo.appendHistory(session.id, { role: "user", content: "hello", timestamp: "2026-04-25T00:00:00.000Z" })

    const records = flattenSessionSnapshots({ alpha: repo.snapshot() })

    expect(records).toEqual([{
      project: "alpha",
      sessionId: "s1",
      globalId: "alpha:s1",
      name: "main",
      platform: "slack",
      groupUser: "C1:U1",
      userName: "Ada",
      chatName: "Platform",
      messages: 1,
      lastActive: "2026-04-25T00:02:00.000Z",
      history: [{ role: "user", content: "hello", timestamp: "2026-04-25T00:00:00.000Z" }],
    }])
  })

  it("parses session keys and matches current plus legacy session filenames", () => {
    expect(parseSessionKey("discord:111:222")).toEqual({ platform: "discord", groupUser: "111:222" })
    expect(parseSessionKey("cli")).toEqual({ platform: "cli", groupUser: "" })

    expect(matchesProjectSessionFile("mybot.json", "mybot")).toBe(true)
    expect(matchesProjectSessionFile("mybot_abc123.json", "mybot")).toBe(true)
    expect(matchesProjectSessionFile("mybot_ws_AABB00.json", "mybot")).toBe(true)
    expect(matchesProjectSessionFile("mybot.sessions.json", "mybot")).toBe(true)
    expect(matchesProjectSessionFile("mybot_extra.json", "mybot")).toBe(false)
    expect(matchesProjectSessionFile("mybot_ws_notahex.json", "mybot")).toBe(false)
  })

  it("finds an active agent session id or reports missing startup state", () => {
    const repo = new AgentSessionsRepository({ now: fixedNow() })
    const session = repo.newSession("weixin:user")
    repo.setAgentSessionId(session.id, "claude-session")

    expect(findAgentSessionIdFromSnapshots({ alpha: repo.snapshot() }, "alpha", "weixin:user")).toBe("claude-session")

    const starting = new AgentSessionsRepository({ now: fixedNow() })
    starting.newSession("weixin:user")

    expect(() => findAgentSessionIdFromSnapshots({ alpha: starting.snapshot() }, "alpha", "weixin:user"))
      .toThrow("agent session ID not yet available")
  })
})
