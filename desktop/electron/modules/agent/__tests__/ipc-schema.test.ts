import { describe, expect, it } from "vitest"

import { agentEventSchema } from "../ipc-shared"

describe("agent IPC schemas", () => {
  it("preserves SDK init MCP server summaries", () => {
    const parsed = agentEventSchema.parse({
      type: "sessionInit",
      sdkSessionId: "sdk-1",
      tools: ["Read"],
      mcpServers: [
        { name: "filesystem", status: "connected" },
      ],
      model: "claude-sonnet-4-5",
      payload: { type: "system", subtype: "init" },
    })

    expect(parsed).toEqual({
      type: "sessionInit",
      sdkSessionId: "sdk-1",
      tools: ["Read"],
      mcpServers: [
        { name: "filesystem", status: "connected" },
      ],
      model: "claude-sonnet-4-5",
      payload: { type: "system", subtype: "init" },
    })
  })
})
