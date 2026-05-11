import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

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

  it("declares WatchNextAgentSessionPayload with projectId", async () => {
    const source = await readFile(
      new URL("../navigation.ts", import.meta.url),
      "utf8",
    )
    expect(source).toContain("WatchNextAgentSessionPayload")
    expect(source).toContain("projectId: string")
  })
})
