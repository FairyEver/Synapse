import { describe, expect, it } from "vitest"

import {
  agentEventSchema,
  sessionSummarySchema,
  timelineItemSchema,
} from "../ipc-shared"
import { messageMethods } from "../ipc-messages"
import { sessionMethods } from "../ipc-sessions"

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

  it("preserves tool use ids on agent tool events and timeline items", () => {
    expect(agentEventSchema.parse({
      type: "toolUse",
      toolUseId: "toolu-read-1",
      toolName: "Read",
      toolInput: "{\"file_path\":\"README.md\"}",
    })).toEqual({
      type: "toolUse",
      toolUseId: "toolu-read-1",
      toolName: "Read",
      toolInput: "{\"file_path\":\"README.md\"}",
    })

    expect(agentEventSchema.parse({
      type: "toolResult",
      toolUseId: "toolu-read-1",
      toolName: "Read",
      content: "file content",
      status: "success",
      success: true,
    })).toEqual({
      type: "toolResult",
      toolUseId: "toolu-read-1",
      toolName: "Read",
      content: "file content",
      status: "success",
      success: true,
    })

    expect(timelineItemSchema.parse({
      id: "conv-1:history:1",
      timestamp: "2026-04-27T03:17:00.000Z",
      kind: "toolCall",
      toolUseId: "toolu-read-1",
      toolName: "Read",
    })).toEqual({
      id: "conv-1:history:1",
      timestamp: "2026-04-27T03:17:00.000Z",
      kind: "toolCall",
      toolUseId: "toolu-read-1",
      toolName: "Read",
    })

    expect(timelineItemSchema.parse({
      id: "conv-1:history:2",
      timestamp: "2026-04-27T03:17:01.000Z",
      kind: "toolResult",
      toolUseId: "toolu-read-1",
      toolName: "Read",
      content: "file content",
    })).toEqual({
      id: "conv-1:history:2",
      timestamp: "2026-04-27T03:17:01.000Z",
      kind: "toolResult",
      toolUseId: "toolu-read-1",
      toolName: "Read",
      content: "file content",
    })
  })

  it("accepts a permission mode on session summaries", () => {
    expect(sessionSummarySchema.parse({
      projectId: "project-1",
      id: "conversation-1",
      sessionKey: "local:renderer",
      mode: "acceptEdits",
      active: true,
      historyCount: 0,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    })).toMatchObject({
      id: "conversation-1",
      mode: "acceptEdits",
    })
  })

  it("rejects unknown permission modes on session summaries", () => {
    expect(() => sessionSummarySchema.parse({
      projectId: "project-1",
      id: "conversation-1",
      sessionKey: "local:renderer",
      mode: "free-for-all",
      active: true,
      historyCount: 0,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    })).toThrow()
  })

  it("accepts valid setPermissionMode requests", () => {
    expect(messageMethods.setPermissionMode.request.parse({
      projectId: "project-1",
      conversationId: "conversation-1",
      mode: "dontAsk",
    })).toMatchObject({
      mode: "dontAsk",
    })
  })

  it("rejects invalid setPermissionMode requests", () => {
    expect(() => messageMethods.setPermissionMode.request.parse({
      projectId: "project-1",
      conversationId: "conversation-1",
      mode: "free-for-all",
    })).toThrow()
  })

  it("accepts a create session permission mode", () => {
    const parsed = sessionMethods.createSession.request.parse({
      projectId: "project-1",
      mode: "bypassPermissions",
    }) as { mode?: string }
    expect(parsed.mode).toBe("bypassPermissions")
  })

  it("rejects an invalid create session permission mode", () => {
    expect(() => sessionMethods.createSession.request.parse({
      projectId: "project-1",
      mode: "free-for-all",
    })).toThrow()
  })
})
