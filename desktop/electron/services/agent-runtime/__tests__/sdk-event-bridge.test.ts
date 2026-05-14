import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import { describe, expect, it } from "vitest"

import { bridgeSdkMessage } from "../sdk-event-bridge"

const baseEnvelope = {
  conversationId: "conversation-1",
  turnId: "turn-1",
  providerId: "claude-sdk",
  timestamp: "2026-05-13T00:00:00.000Z",
}

describe("SDK event bridge", () => {
  it("bridges SDK result success messages to legacy result events", () => {
    expect(bridgeSdkMessage({
      type: "result",
      subtype: "success",
      session_id: "sdk-1",
      result: "done",
      total_cost_usd: 0.01,
      usage: { input_tokens: 1, output_tokens: 2 },
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "result",
      content: "done",
      done: true,
      sdkSessionId: "sdk-1",
      costUsd: 0.01,
      usage: { input_tokens: 1, output_tokens: 2 },
      ...baseEnvelope,
    })
  })

  it("bridges SDK init messages to session init events", () => {
    expect(bridgeSdkMessage({
      type: "system",
      subtype: "init",
      session_id: "sdk-1",
      tools: ["Read"],
      mcp_servers: [],
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "sessionInit",
      sdkSessionId: "sdk-1",
      tools: ["Read"],
      mcpServers: [],
      ...baseEnvelope,
    })
  })

  it("normalizes SDK text deltas without losing raw payload", () => {
    expect(bridgeSdkMessage({
      type: "stream_event",
      session_id: "sdk-1",
      uuid: "uuid-1",
      parent_tool_use_id: null,
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "lo" },
      },
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "stream",
      sdkSessionId: "sdk-1",
      blockIndex: 0,
      deltaType: "text_delta",
      text: "lo",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "lo" },
      },
      ...baseEnvelope,
    })
  })

  it("normalizes SDK thinking deltas", () => {
    expect(bridgeSdkMessage({
      type: "stream_event",
      session_id: "sdk-1",
      uuid: "uuid-2",
      parent_tool_use_id: null,
      event: {
        type: "content_block_delta",
        index: 1,
        delta: { type: "thinking_delta", thinking: "I should answer briefly." },
      },
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "stream",
      blockIndex: 1,
      deltaType: "thinking_delta",
      thinking: "I should answer briefly.",
      ...baseEnvelope,
    })
  })

  it("normalizes SDK tool input JSON deltas", () => {
    expect(bridgeSdkMessage({
      type: "stream_event",
      session_id: "sdk-1",
      uuid: "uuid-3",
      parent_tool_use_id: null,
      event: {
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: "{\"cmd\"" },
      },
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "stream",
      blockIndex: 2,
      deltaType: "input_json_delta",
      partialJson: "{\"cmd\"",
      ...baseEnvelope,
    })
  })

  it("redacts sensitive values from SDK tool input JSON deltas", () => {
    const event = bridgeSdkMessage({
      type: "stream_event",
      session_id: "sdk-secret",
      uuid: "uuid-secret",
      parent_tool_use_id: null,
      event: {
        type: "content_block_delta",
        index: 2,
        delta: {
          type: "input_json_delta",
          partial_json:
            "{\"authorization\":\"Bearer sk-auth\",\"cookie\":\"sid=secret-cookie\",\"apiKey\":\"sk-live",
        },
      },
    } as unknown as SDKMessage, baseEnvelope)

    expect(event).toMatchObject({
      type: "stream",
      sdkSessionId: "sdk-secret",
      partialJson:
        "{\"authorization\":\"[redacted]\",\"cookie\":\"[redacted]\",\"apiKey\":\"[redacted]",
      payload: {
        event: {
          delta: {
            partial_json:
              "{\"authorization\":\"[redacted]\",\"cookie\":\"[redacted]\",\"apiKey\":\"[redacted]",
          },
        },
      },
      ...baseEnvelope,
    })
    expect(JSON.stringify(event)).not.toContain("sk-auth")
    expect(JSON.stringify(event)).not.toContain("secret-cookie")
    expect(JSON.stringify(event)).not.toContain("sk-live")
  })

  it("exposes assistant content blocks for final reconciliation", () => {
    expect(bridgeSdkMessage({
      type: "assistant",
      session_id: "sdk-1",
      uuid: "uuid-4",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "summary", signature: "sig" },
          { type: "text", text: "final answer" },
        ],
      },
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "assistant",
      sdkSessionId: "sdk-1",
      contentBlocks: [
        { type: "thinking", thinking: "summary", signature: "sig" },
        { type: "text", text: "final answer" },
      ],
      ...baseEnvelope,
    })
  })

  it("bridges SDK assistant tool_use blocks to Agent tool events", () => {
    const events = bridgeSdkMessage({
      type: "assistant",
      session_id: "sdk-tools",
      uuid: "uuid-tool-use",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu-1",
            name: "Read",
            input: { file_path: "/Users/liyang/project/README.md" },
          },
        ],
      },
    } as unknown as SDKMessage, baseEnvelope)

    expect(events).toEqual([
      expect.objectContaining({
        type: "assistant",
        sdkSessionId: "sdk-tools",
        contentBlocks: [
          expect.objectContaining({
            type: "tool_use",
            name: "Read",
          }),
        ],
        ...baseEnvelope,
      }),
      expect.objectContaining({
        type: "toolUse",
        sdkSessionId: "sdk-tools",
        toolName: "Read",
        toolInput: "{\"file_path\":\"/Users/liyang/project/README.md\"}",
        toolInputRaw: { file_path: "/Users/liyang/project/README.md" },
        ...baseEnvelope,
      }),
    ])
  })

  it("bridges SDK user tool_result blocks to Agent tool result events", () => {
    expect(bridgeSdkMessage({
      type: "user",
      session_id: "sdk-tools",
      uuid: "uuid-tool-result",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu-1",
            content: "file contents",
            is_error: false,
          },
        ],
      },
    } as unknown as SDKMessage, baseEnvelope)).toEqual([
      expect.objectContaining({
        type: "toolResult",
        sdkSessionId: "sdk-tools",
        toolName: "toolu-1",
        content: "file contents",
        status: "success",
        success: true,
        ...baseEnvelope,
      }),
    ])
  })

  it("bridges SDK result error messages to error events", () => {
    expect(bridgeSdkMessage({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      session_id: "sdk-err",
      errors: ["boom"],
      stop_reason: "tool failed",
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "error",
      message: expect.stringContaining("boom"),
      sdkSessionId: "sdk-err",
      payload: expect.objectContaining({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        session_id: "sdk-err",
        errors: ["boom"],
        stop_reason: "tool failed",
      }),
      ...baseEnvelope,
    })
  })

  it("sanitizes SDK result error diagnostics before they enter agent events", () => {
    const event = bridgeSdkMessage({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      session_id: "sdk-err",
      errors: [
        "Authorization: Bearer sk-secret failed at /Users/liyang/private/project/file.ts",
        "cookie=sid-secret",
      ],
      stop_reason: "failed in C:\\Users\\liyang\\secret\\file.ts",
    } as unknown as SDKMessage, baseEnvelope)

    const serialized = JSON.stringify(event)
    expect(event).toMatchObject({
      type: "error",
      message: expect.stringContaining("[redacted]"),
      payload: expect.objectContaining({
        errors: [
          expect.stringContaining("[path redacted]"),
          expect.stringContaining("[redacted]"),
        ],
        stop_reason: expect.stringContaining("[path redacted]"),
      }),
      ...baseEnvelope,
    })
    expect(serialized).not.toContain("sk-secret")
    expect(serialized).not.toContain("sid-secret")
    expect(serialized).not.toContain("/Users/liyang/private")
    expect(serialized).not.toContain("C:\\Users\\liyang")
  })

  it("bridges unknown SDK messages to generic SDK events with plain JSON payloads", () => {
    const event = bridgeSdkMessage({
      type: "future_message",
      subtype: "future_subtype",
      session_id: "sdk-1",
      created_at: 1n,
      callback: () => "drop me",
      nested: { value: "kept" },
    } as unknown as SDKMessage, baseEnvelope)

    expect(event).toMatchObject({
      type: "sdkEvent",
      sdkSessionId: "sdk-1",
      sdkType: "future_message",
      sdkSubtype: "future_subtype",
      payload: {
        type: "future_message",
        subtype: "future_subtype",
        session_id: "sdk-1",
        created_at: "1",
        nested: { value: "kept" },
      },
      ...baseEnvelope,
    })
    expect((event as { payload: Record<string, unknown> }).payload.callback).toBeUndefined()
  })

  it("redacts sensitive fields from SDK bridge payloads", () => {
    const event = bridgeSdkMessage({
      type: "future_message",
      subtype: "future_subtype",
      session_id: "sdk-redacted",
      apiKey: "sk-live",
      nested: {
        authorization: "Bearer sk-auth",
        headers: {
          cookie: "sid=secret-cookie",
        },
      },
      tools: [
        {
          name: "Read",
          credential: "private-credential",
        },
      ],
    } as unknown as SDKMessage, baseEnvelope)

    const payload = (event as { payload: Record<string, unknown> }).payload
    expect(payload.apiKey).toBe("[redacted]")
    expect(payload.nested).toMatchObject({
      authorization: "[redacted]",
      headers: { cookie: "[redacted]" },
    })
    expect(payload.tools).toMatchObject([{ name: "Read", credential: "[redacted]" }])
    expect(JSON.stringify(payload)).not.toContain("sk-live")
    expect(JSON.stringify(payload)).not.toContain("sk-auth")
    expect(JSON.stringify(payload)).not.toContain("secret-cookie")
    expect(JSON.stringify(payload)).not.toContain("private-credential")
  })

  it("sanitizes diagnostic strings in unknown SDK event payloads", () => {
    const event = bridgeSdkMessage({
      type: "future_error",
      subtype: "stderr",
      session_id: "sdk-diagnostic",
      message: "Authorization: Bearer sk-message failed at /Users/liyang/private/project/file.ts",
      stderr: "token=sk-stderr C:\\Users\\liyang\\secret\\file.ts",
      nested: {
        details: "cookie=sid-secret",
      },
      content: "literal assistant content remains available",
    } as unknown as SDKMessage, baseEnvelope)

    const payload = (event as { payload: Record<string, unknown> }).payload
    const serialized = JSON.stringify(payload)
    expect(payload).toMatchObject({
      message: expect.stringContaining("Bearer [redacted]"),
      stderr: expect.stringContaining("token=[redacted]"),
      nested: {
        details: expect.stringContaining("cookie=[redacted]"),
      },
      content: "literal assistant content remains available",
    })
    expect(serialized).not.toContain("sk-message")
    expect(serialized).not.toContain("sk-stderr")
    expect(serialized).not.toContain("sid-secret")
    expect(serialized).not.toContain("/Users/liyang/private")
    expect(serialized).not.toContain("C:\\Users\\liyang")
  })

  it("sanitizes circular SDK payloads without dropping enumerable data", () => {
    class Fixture {
      readonly classField = "kept"
    }

    const fixture = new Fixture()
    const message = {
      type: "future_message",
      subtype: "future_subtype",
      session_id: "sdk-cycle",
      keep: "yes",
      omit: undefined,
      callback: () => "drop me",
      symbolValue: Symbol("drop me"),
      array: [undefined, 1n, fixture],
      fixture,
    } as Record<string, unknown>
    message.self = message

    const event = bridgeSdkMessage(message as unknown as SDKMessage, baseEnvelope)

    expect(event).toMatchObject({
      type: "sdkEvent",
      sdkType: "future_message",
      sdkSubtype: "future_subtype",
      payload: {
        type: "future_message",
        subtype: "future_subtype",
        session_id: "sdk-cycle",
        keep: "yes",
        self: "[Circular]",
        array: [null, "1", { classField: "kept" }],
        fixture: { classField: "kept" },
      },
      ...baseEnvelope,
    })
    const payload = (event as { payload: Record<string, unknown> }).payload
    expect(payload.omit).toBeUndefined()
    expect(payload.callback).toBeUndefined()
    expect(payload.symbolValue).toBeUndefined()
  })
})
