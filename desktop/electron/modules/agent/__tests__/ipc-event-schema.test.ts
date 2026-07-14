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
    }) as { payload: { event: Record<string, unknown> } }

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

  it("preserves user question identity and resolution in timeline responses", () => {
    const parsed = agentIpcModule.methods.getTimeline.response!.parse({
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conversation-1",
      entries: [{
        id: "question-1",
        kind: "permissionRequest",
        timestamp: "2026-07-14T00:00:00.000Z",
        requestId: "request-1",
        toolName: "AskUserQuestion",
        questions: [{
          id: "question-id",
          key: "question-key",
          question: "选一个？",
          options: [{ label: "A" }, { label: "B" }],
          multiSelect: false,
        }],
        resolution: {
          status: "answered",
          resolvedAt: "2026-07-14T00:01:00.000Z",
          answers: [{ questionIndex: 0, values: ["B"] }],
        },
      }],
    }) as { entries: Array<Record<string, unknown>> }

    expect(parsed.entries[0]).toMatchObject({
      questions: [{ id: "question-id", key: "question-key" }],
      resolution: {
        status: "answered",
        answers: [{ questionIndex: 0, values: ["B"] }],
      },
    })
  })
})
