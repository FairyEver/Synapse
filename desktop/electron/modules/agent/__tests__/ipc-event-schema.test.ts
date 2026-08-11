import { describe, expect, it } from "vitest"

import { agentIpcModule } from "../ipc"

describe("agent IPC event schema", () => {
  it("preserves session directory permission capability on live events", () => {
    const parsed = agentIpcModule.events.event.payload.parse({
      domain: "agent",
      type: "permissionRequest",
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        event: {
          type: "permissionRequest",
          requestId: "permission-1",
          toolName: "Read",
          blockedPath: "/Users/liyang/Downloads/report.pdf",
          sessionDirectoryGrantAvailable: true,
        },
      },
      timestamp: "2026-07-22T00:00:00.000Z",
    }) as { payload: { event: Record<string, unknown> } }

    expect(parsed.payload.event).toMatchObject({
      blockedPath: "/Users/liyang/Downloads/report.pdf",
      sessionDirectoryGrantAvailable: true,
    })
  })

  it("preserves SDK event envelope correlation fields", () => {
    const parsed = agentIpcModule.events.event.payload.parse({
      domain: "agent",
      type: "stream",
      payload: {
        projectId: "project-1",
        sessionKey: "local:renderer",
        platform: "renderer",
        deliveryEpoch: "delivery-1",
        sequence: 42,
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
    }) as { payload: { deliveryEpoch?: string; event: Record<string, unknown>; sequence?: number } }

    expect(parsed.payload.event).toMatchObject({
      type: "stream",
      sdkSessionId: "sdk-session-1",
      conversationId: "conversation-1",
      turnId: "turn-1",
      providerId: "claude-sdk",
      projectId: "project-1",
      text: "hi",
    })
    expect(parsed.payload.sequence).toBe(42)
    expect(parsed.payload.deliveryEpoch).toBe("delivery-1")
  })

  it("preserves user question identity and resolution in timeline responses", () => {
    const parsed = agentIpcModule.methods.getTimeline.response!.parse({
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conversation-1",
      total: 1,
      startIndex: 0,
      hasMore: false,
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
