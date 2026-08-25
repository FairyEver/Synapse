import vm from "node:vm"

import { describe, expect, it } from "vitest"

import {
  agentEventSchema,
  sessionSummary,
  sessionSummarySchema,
  timelineItemSchema,
} from "../ipc-shared"
import type { ConversationEntryV1 } from "../../../runtime/data-repo"
import { messageMethods } from "../ipc-messages"
import { sessionMethods } from "../ipc-sessions"

describe("agent IPC schemas", () => {
  it("preserves structured user message attachments on timeline IPC", () => {
    expect(timelineItemSchema.parse({
      id: "conv-1:history:0",
      timestamp: "2026-08-25T00:00:00.000Z",
      kind: "message",
      role: "user",
      content: "请分析",
      attachments: [{
        kind: "image",
        id: "image-1",
        name: "screen.png",
        mimeType: "image/png",
        byteSize: 3,
        url: "synapse-agent-artifact://local/project/conv/image-1.png",
      }, {
        kind: "path",
        path: "/tmp/report.pdf",
        entryType: "file",
        name: "report.pdf",
        byteSize: 42,
      }],
    })).toMatchObject({
      content: "请分析",
      attachments: [
        expect.objectContaining({ kind: "image", name: "screen.png" }),
        expect.objectContaining({ kind: "path", byteSize: 42 }),
      ],
    })
  })

  it("accepts session-scoped directory permission responses", () => {
    expect(messageMethods.respondPermission.request.parse({
      projectId: "project-1",
      requestId: "permission-1",
      behavior: "allow",
      scope: "session",
    })).toEqual({
      projectId: "project-1",
      requestId: "permission-1",
      behavior: "allow",
      scope: "session",
    })
  })

  it("preserves directory permission capability without exposing SDK suggestions", () => {
    const parsed = messageMethods.listPendingPermissions.response?.parse([{
      requestId: "permission-1",
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conversation-1",
      toolName: "Read",
      blockedPath: "/Users/liyang/Downloads/report.pdf",
      sessionDirectoryGrantAvailable: true,
      createdAt: "2026-07-22T00:00:00.000Z",
      suggestions: [{ type: "addDirectories", directories: ["/Users/liyang/Downloads"] }],
    }])

    expect(parsed).toEqual([{
      requestId: "permission-1",
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conversation-1",
      toolName: "Read",
      blockedPath: "/Users/liyang/Downloads/report.pdf",
      sessionDirectoryGrantAvailable: true,
      createdAt: "2026-07-22T00:00:00.000Z",
    }])
  })

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

  it("preserves image artifacts on tool result events and timeline items", () => {
    const imageArtifacts = [{
      id: "artifact-1",
      kind: "image" as const,
      mimeType: "image/png" as const,
      byteSize: 76,
      url: "synapse-agent-artifact://local/project/conv/artifact-1.png",
      sha256: "sha256-artifact-1",
    }]

    expect(agentEventSchema.parse({
      type: "toolResult",
      toolUseId: "toolu-read-image",
      toolName: "Read",
      imageArtifacts,
      status: "success",
      success: true,
    })).toEqual({
      type: "toolResult",
      toolUseId: "toolu-read-image",
      toolName: "Read",
      imageArtifacts,
      status: "success",
      success: true,
    })

    expect(timelineItemSchema.parse({
      id: "conv-1:history:2",
      timestamp: "2026-07-03T13:25:40.000Z",
      kind: "toolResult",
      toolUseId: "toolu-read-image",
      toolName: "Read",
      imageArtifacts,
      success: true,
    })).toEqual({
      id: "conv-1:history:2",
      timestamp: "2026-07-03T13:25:40.000Z",
      kind: "toolResult",
      toolUseId: "toolu-read-image",
      toolName: "Read",
      imageArtifacts,
      success: true,
    })
  })

  it("preserves sanitized tool result content diagnostics", () => {
    const contentDiagnostics = {
      kind: "array" as const,
      itemCount: 2,
      contentTypes: ["text", "image"],
      textCharCount: 12,
      imageCount: 1,
      images: [{
        mimeType: "image/png",
        base64Length: 128,
        originalSize: 96,
        dimensions: { width: 32, height: 24 },
      }],
    }

    expect(agentEventSchema.parse({
      type: "toolResult",
      toolName: "Read",
      contentDiagnostics,
    })).toMatchObject({ contentDiagnostics })
    expect(timelineItemSchema.parse({
      id: "conv-1:history:diagnostics",
      timestamp: "2026-07-19T00:00:00.000Z",
      kind: "toolResult",
      toolName: "Read",
      contentDiagnostics,
    })).toMatchObject({ contentDiagnostics })
  })

  it("preserves terminal turn details on agent events and timeline items", () => {
    const turnOutcome = {
      status: "interrupted" as const,
      reason: "tool_use_interrupted" as const,
      recoverable: true as const,
      message: "工具调用被中断",
      diagnostics: [{
        source: "claude-sdk" as const,
        kind: "tool_use_interrupted" as const,
        message: "stop_reason=tool_use",
      }],
    }
    const resultDetails = {
      turnOutcome,
      modelUsage: { "claude-sonnet": { inputTokens: 10, outputTokens: 5 } },
      sdkResultUuid: "result-1",
    }

    expect(agentEventSchema.parse({
      type: "result",
      content: "done",
      done: true,
      metadata: resultDetails,
      modelUsage: resultDetails.modelUsage,
      sdkResultUuid: resultDetails.sdkResultUuid,
    })).toMatchObject({
      metadata: resultDetails,
      modelUsage: resultDetails.modelUsage,
      sdkResultUuid: resultDetails.sdkResultUuid,
    })
    expect(agentEventSchema.parse({
      type: "error",
      message: turnOutcome.message,
      errorKind: "tool_use_interrupted",
      recoverable: true,
      ...resultDetails,
    })).toMatchObject(resultDetails)
    expect(timelineItemSchema.parse({
      id: "conv-1:history:3",
      timestamp: "2026-07-18T01:00:00.000Z",
      kind: "result",
      content: "done",
      metadata: resultDetails,
    })).toMatchObject({ metadata: resultDetails })
    expect(timelineItemSchema.parse({
      id: "conv-1:history:4",
      timestamp: "2026-07-18T01:00:01.000Z",
      kind: "error",
      message: turnOutcome.message,
      turnOutcome,
    })).toMatchObject({ turnOutcome })
  })

  it("preserves unconfirmed user question resolution attempts on timeline items", () => {
    const resolutionAttempt = {
      status: "answered" as const,
      resolvedAt: "2026-07-18T01:00:00.000Z",
      answers: [{ questionIndex: 0, values: ["重试"] }],
    }

    expect(timelineItemSchema.parse({
      id: "conv-1:history:5",
      timestamp: "2026-07-18T01:00:00.000Z",
      kind: "permissionRequest",
      requestId: "request-1",
      toolName: "AskUserQuestion",
      resolutionAttempt,
    })).toMatchObject({ resolutionAttempt })
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

  it("includes model tier on session summaries", () => {
    const session: ConversationEntryV1 = {
      projectId: "project-1",
      id: "conversation-1",
      schemaVersion: 1,
      sessionKey: "local:renderer",
      agentConfig: { modelTier: "sonnet" },
      active: true,
      history: [],
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    }

    expect(sessionSummary(session)).toMatchObject({
      id: "conversation-1",
      modelTier: "sonnet",
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

  it("accepts normalized image and path attachments on send requests", () => {
    const imageData = new Uint8Array([1, 2, 3])
    const parsed = messageMethods.send.request.parse({
      projectId: "project-1",
      content: "hello",
      attachments: [
        {
          kind: "image",
          mimeType: "image/png",
          data: imageData,
          name: "chart.png",
          size: 3,
        },
        {
          kind: "path",
          path: "/Users/example/report.md",
          entryType: "file",
          name: "report.md",
        },
      ],
    }) as {
      readonly attachments?: readonly [
        { readonly kind: "image"; readonly data: Uint8Array },
        { readonly kind: "path"; readonly path: string },
      ]
    }

    expect(parsed.attachments?.[0]).toEqual(expect.objectContaining({
      kind: "image",
      mimeType: "image/png",
      data: imageData,
      name: "chart.png",
      size: 3,
    }))
    expect(parsed.attachments?.[1]).toEqual(expect.objectContaining({
      kind: "path",
      path: "/Users/example/report.md",
      entryType: "file",
      name: "report.md",
    }))
  })

  it("strips legacy per-message persona fields from send requests", () => {
    const parsed = messageMethods.send.request.parse({
      projectId: "project-1",
      conversationId: "conversation-1",
      content: "hello",
      mainThreadPersonaId: "builtin-zh-en-translator",
      mainThreadPersonaName: "中英翻译",
    })
    expect(parsed).not.toHaveProperty("mainThreadPersonaId")
    expect(parsed).not.toHaveProperty("mainThreadPersonaName")
  })

  it("allows attachment-only send requests and rejects empty sends", () => {
    expect(messageMethods.send.request.parse({
      projectId: "project-1",
      content: "",
      attachments: [{
        kind: "image",
        mimeType: "image/png",
        data: new Uint8Array([1]),
        size: 1,
      }],
    })).toMatchObject({
      content: "",
      attachments: [expect.objectContaining({ kind: "image" })],
    })

    expect(() => messageMethods.send.request.parse({
      projectId: "project-1",
      content: "",
    })).toThrow()
    expect(() => messageMethods.send.request.parse({
      projectId: "project-1",
      content: "   ",
      attachments: [],
    })).toThrow()
  })

  it("accepts cross-realm binary image data and Buffer image data", () => {
    const crossRealmArrayBuffer = vm.runInNewContext("new ArrayBuffer(3)") as ArrayBuffer
    const crossRealmUint8Array = vm.runInNewContext("new Uint8Array([1, 2, 3])") as Uint8Array
    const bufferData = Buffer.from([1, 2, 3])

    for (const data of [crossRealmArrayBuffer, crossRealmUint8Array, bufferData]) {
      expect(messageMethods.send.request.parse({
        projectId: "project-1",
        content: "",
        attachments: [{
          kind: "image",
          mimeType: "image/png",
          data,
        }],
      })).toMatchObject({
        attachments: [expect.objectContaining({ data })],
      })
    }
  })

  it("accepts POSIX and Windows absolute path attachments", () => {
    expect(messageMethods.send.request.parse({
      projectId: "project-1",
      content: "",
      attachments: [{ kind: "path", path: "/Users/example/report.md", entryType: "file" }],
    })).toMatchObject({
      attachments: [expect.objectContaining({ path: "/Users/example/report.md" })],
    })
    expect(messageMethods.send.request.parse({
      projectId: "project-1",
      content: "",
      attachments: [{ kind: "path", path: "C:\\Users\\example\\report.md", entryType: "file" }],
    })).toMatchObject({
      attachments: [expect.objectContaining({ path: "C:\\Users\\example\\report.md" })],
    })
    expect(messageMethods.send.request.parse({
      projectId: "project-1",
      content: "",
      attachments: [{ kind: "path", path: "C:/Users/example/report.md", entryType: "file" }],
    })).toMatchObject({
      attachments: [expect.objectContaining({ path: "C:/Users/example/report.md" })],
    })
    expect(messageMethods.send.request.parse({
      projectId: "project-1",
      content: "",
      attachments: [{ kind: "path", path: "\\\\server\\share\\report.md", entryType: "file" }],
    })).toMatchObject({
      attachments: [expect.objectContaining({ path: "\\\\server\\share\\report.md" })],
    })
    expect(messageMethods.send.request.parse({
      projectId: "project-1",
      content: "",
      attachments: [{ kind: "path", path: "//server/share/report.md", entryType: "file" }],
    })).toMatchObject({
      attachments: [expect.objectContaining({ path: "//server/share/report.md" })],
    })
  })

  it("rejects malformed send attachments", () => {
    const baseRequest = {
      projectId: "project-1",
      content: "hello",
    }

    expect(() => messageMethods.send.request.parse({
      ...baseRequest,
      attachments: [{ kind: "image", mimeType: "image/png", data: new ArrayBuffer(0) }],
    })).toThrow()
    expect(() => messageMethods.send.request.parse({
      ...baseRequest,
      attachments: [{ kind: "image", mimeType: "image/png", data: new Uint8Array() }],
    })).toThrow()
    expect(() => messageMethods.send.request.parse({
      ...baseRequest,
      attachments: [{ kind: "image", mimeType: "image/svg+xml", data: new Uint8Array([1]), size: 1 }],
    })).toThrow()
    expect(() => messageMethods.send.request.parse({
      ...baseRequest,
      attachments: [{ kind: "image", mimeType: "image/png", data: new Uint8Array([1]), size: -1 }],
    })).toThrow()
    expect(() => messageMethods.send.request.parse({
      ...baseRequest,
      attachments: [{ kind: "image", mimeType: "image/png", data: new Uint8Array([1]), size: 1.5 }],
    })).toThrow()
    expect(() => messageMethods.send.request.parse({
      ...baseRequest,
      attachments: [{ kind: "path", path: "", entryType: "file" }],
    })).toThrow()
    expect(() => messageMethods.send.request.parse({
      ...baseRequest,
      attachments: [{ kind: "path", path: "   ", entryType: "file" }],
    })).toThrow()
    expect(() => messageMethods.send.request.parse({
      ...baseRequest,
      attachments: [{ kind: "path", path: "relative/report.md", entryType: "file" }],
    })).toThrow()
    expect(() => messageMethods.send.request.parse({
      ...baseRequest,
      attachments: [{ kind: "path", path: "//server", entryType: "file" }],
    })).toThrow()
    expect(() => messageMethods.send.request.parse({
      ...baseRequest,
      attachments: [{ kind: "path", path: "///server/share/report.md", entryType: "file" }],
    })).toThrow()
    expect(() => messageMethods.send.request.parse({
      ...baseRequest,
      attachments: [{ kind: "file", path: "/Users/example/report.md" }],
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
