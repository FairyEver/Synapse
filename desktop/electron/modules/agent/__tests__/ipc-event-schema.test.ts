import { describe, expect, it } from "vitest"

import { agentIpcModule } from "../ipc"

describe("agent IPC event schema", () => {
  it("preserves SDK event envelope correlation fields", () => {
    const parsed = agentIpcModule.events.event.payload.parse({
      domain: "agent",
      type: "stream",
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        event: {
          type: "stream",
          sdkSessionId: "sdk-session-1",
          conversationId: "conversation-1",
          turnId: "turn-1",
          providerId: "claude-sdk",
          projectId: "project-1",
          text: "hi",
          event: {
            type: "content_block_delta",
          },
        },
      },
      timestamp: "2026-05-14T00:00:00.000Z",
    })

    expect(parsed.payload.event).toMatchObject({
      type: "stream",
      sdkSessionId: "sdk-session-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
      providerId: "claude-sdk",
      projectId: "project-1",
      text: "hi",
    })
  })
})
