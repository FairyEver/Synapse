import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { isWatchedAgentSessionEvent } from "../use-watch-next-agent-session"

describe("navigation watch-next-agent-session", () => {
  it("exports requestWatchNextAgentSession", async () => {
    const source = await readFile(
      new URL("../navigation.ts", import.meta.url),
      "utf8",
    )
    expect(source).toContain("function requestWatchNextAgentSession")
    expect(source).toContain("requestWatchNextAgentSession,")
  })

  it("exports subscribeWatchNextAgentSession", async () => {
    const source = await readFile(
      new URL("../navigation.ts", import.meta.url),
      "utf8",
    )
    expect(source).toContain("function subscribeWatchNextAgentSession")
    expect(source).toContain("subscribeWatchNextAgentSession,")
  })

  it("exports cancelWatchNextAgentSession", async () => {
    const source = await readFile(
      new URL("../navigation.ts", import.meta.url),
      "utf8",
    )
    expect(source).toContain("function cancelWatchNextAgentSession")
    expect(source).toContain("cancelWatchNextAgentSession,")
  })

  it("exports subscribeCancelWatchNextAgentSession", async () => {
    const source = await readFile(
      new URL("../navigation.ts", import.meta.url),
      "utf8",
    )
    expect(source).toContain("function subscribeCancelWatchNextAgentSession")
    expect(source).toContain("subscribeCancelWatchNextAgentSession,")
  })

  it("declares WatchNextAgentSessionPayload with projectId", async () => {
    const source = await readFile(
      new URL("../navigation.ts", import.meta.url),
      "utf8",
    )
    expect(source).toContain("WatchNextAgentSessionPayload")
    expect(source).toContain("projectId: string")
  })

  it("matches only the requested scheduled session shape", () => {
    const watch = {
      projectId: "project-1",
      platform: "scheduled",
      sessionKeyPrefix: "scheduled:project-1:",
      expiresAt: 200,
    }

    expect(isWatchedAgentSessionEvent(watch, {
      projectId: "project-1",
      platform: "scheduled",
      sessionKey: "scheduled:project-1:123",
      conversationId: "conversation-1",
    }, 100)).toBe(true)

    expect(isWatchedAgentSessionEvent(watch, {
      projectId: "project-1",
      platform: "local",
      sessionKey: "local:renderer",
      conversationId: "conversation-2",
    }, 100)).toBe(false)

    expect(isWatchedAgentSessionEvent(watch, {
      projectId: "project-1",
      platform: "scheduled",
      sessionKey: "scheduled:project-2:123",
      conversationId: "conversation-3",
    }, 100)).toBe(false)
  })
})
