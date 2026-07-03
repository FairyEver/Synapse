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

  it("accepts a main-thread persona snapshot on send requests", () => {
    expect(messageMethods.send.request.parse({
      projectId: "project-1",
      conversationId: "conversation-1",
      content: "hello",
      mainThreadPersonaId: "builtin-zh-en-translator",
      mainThreadPersonaName: "中英翻译",
    })).toMatchObject({
      mainThreadPersonaId: "builtin-zh-en-translator",
      mainThreadPersonaName: "中英翻译",
    })

    expect(messageMethods.send.request.parse({
      projectId: "project-1",
      conversationId: "conversation-1",
      content: "hello",
      mainThreadPersonaId: null,
      mainThreadPersonaName: "普通",
    })).toMatchObject({
      mainThreadPersonaId: null,
      mainThreadPersonaName: "普通",
    })
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
