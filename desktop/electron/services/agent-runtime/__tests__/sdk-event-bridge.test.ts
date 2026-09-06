import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import { describe, expect, it } from "vitest"

import { bridgeSdkMessage } from "../sdk-event-bridge"
import { DEFAULT_CLAUDE_SDK_MAX_TURNS } from "../turn-limits"

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
      uuid: "result-1",
      result: "done",
      total_cost_usd: 0.01,
      usage: { input_tokens: 1, output_tokens: 2 },
      modelUsage: { "claude-sonnet": { inputTokens: 1, outputTokens: 2 } },
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "result",
      content: "done",
      done: true,
      sdkSessionId: "sdk-1",
      sdkResultUuid: "result-1",
      costUsd: 0.01,
      costCny: expect.closeTo(0.072, 6),
      costCurrency: "CNY",
      usage: { input_tokens: 1, output_tokens: 2 },
      modelUsage: { "claude-sonnet": { inputTokens: 1, outputTokens: 2 } },
      ...baseEnvelope,
    })
  })

  it("preserves SDK result usage on error result messages", () => {
    expect(bridgeSdkMessage({
      type: "result",
      subtype: "error_during_execution",
      session_id: "sdk-error",
      uuid: "result-error",
      is_error: true,
      errors: ["failed"],
      total_cost_usd: 0.01,
      usage: { input_tokens: 3, output_tokens: 4 },
      modelUsage: { "claude-sonnet": { inputTokens: 3, outputTokens: 4 } },
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "error",
      message: "Agent 执行失败。诊断信息：failed",
      sdkSessionId: "sdk-error",
      sdkResultUuid: "result-error",
      usage: { input_tokens: 3, output_tokens: 4 },
      modelUsage: { "claude-sonnet": { inputTokens: 3, outputTokens: 4 } },
      ...baseEnvelope,
    })
  })

  it("treats terminal API disconnect results as recoverable errors", () => {
    expect(bridgeSdkMessage({
      type: "result",
      subtype: "success",
      session_id: "sdk-disconnected",
      uuid: "result-disconnected",
      is_error: true,
      result: "API Error: Connection lost mid-response. The response above may be incomplete.",
      terminal_reason: "api_error",
      api_error_status: null,
      total_cost_usd: 0.25,
      usage: { input_tokens: 8, output_tokens: 3 },
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "error",
      message: "模型连接中断，任务尚未完成。",
      errorKind: "connection_interrupted",
      recoverable: true,
      sdkSessionId: "sdk-disconnected",
      sdkResultUuid: "result-disconnected",
      costUsd: 0.25,
      payload: expect.objectContaining({
        is_error: true,
        terminal_reason: "api_error",
        api_error_status: null,
      }),
      ...baseEnvelope,
    })
  })

  it("prioritizes terminal API disconnects when the SDK also reports generic errors", () => {
    expect(bridgeSdkMessage({
      type: "result",
      subtype: "success",
      session_id: "sdk-disconnected-with-errors",
      uuid: "result-disconnected-with-errors",
      is_error: true,
      errors: ["server_error"],
      result: "API Error: Connection lost mid-response. The response above may be incomplete.",
      terminal_reason: "api_error",
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "error",
      message: "模型连接中断，任务尚未完成。",
      errorKind: "connection_interrupted",
      recoverable: true,
      sdkSessionId: "sdk-disconnected-with-errors",
    })
  })

  it("treats terminal API disconnects as errors without the SDK is_error flag", () => {
    expect(bridgeSdkMessage({
      type: "result",
      subtype: "success",
      session_id: "sdk-terminal-disconnect",
      uuid: "result-terminal-disconnect",
      result: "API Error: Connection lost mid-response. The response above may be incomplete.",
      terminal_reason: "api_error",
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "error",
      message: "模型连接中断，任务尚未完成。",
      errorKind: "connection_interrupted",
      recoverable: true,
      sdkSessionId: "sdk-terminal-disconnect",
    })
  })

  it("does not render synthetic API errors as assistant replies", () => {
    expect(bridgeSdkMessage({
      type: "assistant",
      session_id: "sdk-disconnected",
      error: "server_error",
      is_api_error_message: true,
      message: {
        role: "assistant",
        content: [{
          type: "text",
          text: "API Error: Connection lost mid-response. The response above may be incomplete.",
        }],
      },
    } as unknown as SDKMessage, baseEnvelope)).toEqual([])
  })

  it("does not render standard SDK assistant errors as assistant replies", () => {
    expect(bridgeSdkMessage({
      type: "assistant",
      session_id: "sdk-assistant-error",
      error: "server_error",
      message: {
        role: "assistant",
        content: [{
          type: "text",
          text: "API Error: Connection lost mid-response. The response above may be incomplete.",
        }],
      },
    } as unknown as SDKMessage, baseEnvelope)).toEqual([])
  })

  it("does not treat an SDK result marked as an error as success without diagnostics", () => {
    expect(bridgeSdkMessage({
      type: "result",
      subtype: "success",
      session_id: "sdk-error-without-details",
      uuid: "result-error-without-details",
      is_error: true,
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "error",
      message: "Agent 执行失败。",
      recoverable: false,
      sdkSessionId: "sdk-error-without-details",
    })
  })

  it("treats max turn result subtypes without errors as errors", () => {
    expect(bridgeSdkMessage({
      type: "result",
      subtype: "error_max_turns",
      session_id: "sdk-max-turns",
      uuid: "result-max-turns",
      total_cost_usd: 0.01,
      usage: { input_tokens: 3, output_tokens: 4 },
      modelUsage: { "claude-sonnet": { inputTokens: 3, outputTokens: 4 } },
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "error",
      message: "已达到本轮执行上限（200），任务尚未完成；发送“继续”可接着执行。",
      sdkSessionId: "sdk-max-turns",
      sdkResultUuid: "result-max-turns",
      usage: { input_tokens: 3, output_tokens: 4 },
      modelUsage: { "claude-sonnet": { inputTokens: 3, outputTokens: 4 } },
      ...baseEnvelope,
    })
    expect(bridgeSdkMessage({
      type: "result",
      subtype: "error_max_turns",
      session_id: "sdk-max-turns",
      uuid: "result-max-turns",
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      message: expect.stringContaining(String(DEFAULT_CLAUDE_SDK_MAX_TURNS)),
    })
  })

  it("treats SDK budget and unknown error result subtypes as Chinese errors", () => {
    expect(bridgeSdkMessage({
      type: "result",
      subtype: "error_max_budget_usd",
      session_id: "sdk-budget",
      uuid: "result-budget",
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "error",
      message: "已达到本轮费用上限，任务尚未完成；调整预算后可继续执行。",
      sdkSessionId: "sdk-budget",
    })

    expect(bridgeSdkMessage({
      type: "result",
      subtype: "error_future_limit",
      session_id: "sdk-future",
      uuid: "result-future",
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "error",
      message: "Agent 已停止，任务尚未完成。诊断信息：error_future_limit",
      sdkSessionId: "sdk-future",
    })
  })

  it("marks tool-use interrupted SDK result errors as recoverable", () => {
    expect(bridgeSdkMessage({
      type: "result",
      subtype: "error_during_execution",
      session_id: "sdk-tool-use",
      uuid: "result-tool-use",
      is_error: true,
      errors: ["[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"],
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "error",
      message: "Agent 在工具调用后中断，发送“继续”可接着执行。",
      errorKind: "tool_use_interrupted",
      recoverable: true,
      sdkSessionId: "sdk-tool-use",
    })
  })

  it("keeps success result text out of SDK payload diagnostics", () => {
    const rawResult =
      "Final answer with Authorization: Bearer sk-answer and /Users/liyang/private/source.ts"
    const event = bridgeSdkMessage({
      type: "result",
      subtype: "success",
      session_id: "sdk-result-payload",
      result: rawResult,
      total_cost_usd: 0.02,
      usage: { input_tokens: 4, output_tokens: 8 },
    } as unknown as SDKMessage, baseEnvelope)

    expect(event).toMatchObject({
      type: "result",
      content: rawResult,
      payload: expect.objectContaining({
        type: "result",
        subtype: "success",
        session_id: "sdk-result-payload",
      }),
    })
    expect((event as { payload?: Record<string, unknown> }).payload).not.toHaveProperty("result")
    expect(JSON.stringify((event as { payload?: Record<string, unknown> }).payload)).not.toContain("sk-answer")
    expect(JSON.stringify((event as { payload?: Record<string, unknown> }).payload)).not.toContain("/Users/liyang")
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

  it("derives tool stream activity from SDK tool content block events", () => {
    expect(bridgeSdkMessage({
      type: "stream_event",
      session_id: "sdk-tool-progress",
      uuid: "uuid-tool-progress",
      parent_tool_use_id: null,
      event: {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu-write",
          name: "Write",
          input: {},
        },
      },
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "stream",
      sdkSessionId: "sdk-tool-progress",
      blockIndex: 1,
      toolUseId: "toolu-write",
      toolName: "Write",
      ...baseEnvelope,
    })

    expect(bridgeSdkMessage({
      type: "stream_event",
      session_id: "sdk-tool-progress",
      uuid: "uuid-tool-progress-delta",
      parent_tool_use_id: null,
      event: {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: "{\"content\":\"hello\"}",
        },
      },
    } as unknown as SDKMessage, baseEnvelope)).toMatchObject({
      type: "stream",
      sdkSessionId: "sdk-tool-progress",
      blockIndex: 1,
      deltaType: "input_json_delta",
      inputJsonDeltaLength: 19,
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

  it("preserves local paths in SDK tool input JSON deltas", () => {
    const event = bridgeSdkMessage({
      type: "stream_event",
      session_id: "sdk-path",
      uuid: "uuid-path",
      parent_tool_use_id: null,
      event: {
        type: "content_block_delta",
        index: 2,
        delta: {
          type: "input_json_delta",
          partial_json:
            "{\"file_path\":\"/Users/liyang/private/project/file.ts\",\"command\":\"type C:\\\\Users\\\\liyang\\\\secret\\\\file.ts",
        },
      },
    } as unknown as SDKMessage, baseEnvelope)

    expect(event).toMatchObject({
      type: "stream",
      sdkSessionId: "sdk-path",
      partialJson: expect.stringContaining("/Users/liyang/private/project/file.ts"),
      payload: {
        event: {
          delta: {
            partial_json: expect.stringContaining("C:\\\\Users\\\\liyang\\\\secret\\\\file.ts"),
          },
        },
      },
      ...baseEnvelope,
    })
    expect(JSON.stringify(event)).toContain("/Users/liyang/private")
    expect(JSON.stringify(event)).toContain("C:\\\\\\\\Users\\\\\\\\liyang")
  })

  it("truncates sanitized SDK tool input JSON deltas", () => {
    const event = bridgeSdkMessage({
      type: "stream_event",
      session_id: "sdk-long-partial",
      uuid: "uuid-long-partial",
      parent_tool_use_id: null,
      event: {
        type: "content_block_delta",
        index: 2,
        delta: {
          type: "input_json_delta",
          partial_json: `{"authorization":"Bearer sk-long-partial","command":"${"x".repeat(360)}`,
        },
      },
    } as unknown as SDKMessage, baseEnvelope)

    const partialJson = (event as { partialJson?: string }).partialJson
    const payloadPartialJson = (event as {
      payload?: { event?: { delta?: { partial_json?: string } } }
    }).payload?.event?.delta?.partial_json

    expect(partialJson).toBe(payloadPartialJson)
    expect(partialJson).toContain("\"authorization\":\"[redacted]\"")
    expect(partialJson).toHaveLength(243)
    expect(partialJson?.endsWith("...")).toBe(true)
    expect(JSON.stringify(event)).not.toContain("sk-long-partial")
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

  it("keeps long assistant text available for final reconciliation without expanding diagnostics", () => {
    const longAnswer = `Final answer: ${"x".repeat(360)}`
    const event = bridgeSdkMessage({
      type: "assistant",
      session_id: "sdk-long-answer",
      uuid: "uuid-long-answer",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: longAnswer },
        ],
      },
    } as unknown as SDKMessage, baseEnvelope)

    expect(event).toMatchObject({
      type: "assistant",
      contentBlocks: [
        { type: "text", text: longAnswer },
      ],
      message: {
        content: [
          { type: "text", text: longAnswer },
        ],
      },
      ...baseEnvelope,
    })
    const payload = (event as { payload?: Record<string, unknown> }).payload
    expect(payload?.message).toEqual({
      role: "assistant",
      contentCount: 1,
      contentTypes: ["text"],
    })
    expect(JSON.stringify(payload)).not.toContain(longAnswer)
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
            input: {
              file_path: "/Users/liyang/project/README.md",
              authorization: "Bearer sk-tool",
            },
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
        toolUseId: "toolu-1",
        toolName: "Read",
        toolInput: "{\"file_path\":\"/Users/liyang/project/README.md\",\"authorization\":\"[redacted]\"}",
        toolInputRaw: {
          file_path: "/Users/liyang/project/README.md",
          authorization: "[redacted]",
        },
        ...baseEnvelope,
      }),
    ])
    expect(JSON.stringify(events)).toContain("/Users/liyang/project")
    expect(JSON.stringify(events)).not.toContain("sk-tool")
  })

  it("redacts sensitive text inside SDK assistant tool_use inputs", () => {
    const events = bridgeSdkMessage({
      type: "assistant",
      session_id: "sdk-tools",
      uuid: "uuid-tool-secret",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu-secret",
            name: "Bash",
            input: {
              command:
                "cat /Users/liyang/private/project/file.ts && type C:\\Users\\liyang\\private\\secret.txt && curl -H 'Authorization: Bearer sk-tool-secret' https://api.example.test",
              env: {
                normal: "kept",
                token: "env-token-secret",
              },
            },
          },
        ],
      },
    } as unknown as SDKMessage, baseEnvelope)

    const assistantEvent = Array.isArray(events) ? events[0] : events
    const toolEvent = Array.isArray(events) ? events[1] : events
    expect(toolEvent).toMatchObject({
      type: "toolUse",
      sdkSessionId: "sdk-tools",
      toolUseId: "toolu-secret",
      toolName: "Bash",
      toolInput: expect.stringContaining("Bearer [redacted]"),
      toolInputRaw: {
        command: expect.stringContaining("Bearer [redacted]"),
        env: {
          normal: "kept",
          token: "[redacted]",
        },
      },
      ...baseEnvelope,
    })
    expect(JSON.stringify(toolEvent)).not.toContain("sk-tool-secret")
    expect(JSON.stringify(toolEvent)).not.toContain("env-token-secret")
    expect(JSON.stringify(toolEvent)).toContain("/Users/liyang")
    expect(JSON.stringify(toolEvent)).toContain("C:\\\\Users\\\\liyang")
    expect(assistantEvent).toMatchObject({
      type: "assistant",
      contentBlocks: [
        expect.objectContaining({
          input: {
            command: expect.stringContaining("Bearer [redacted]"),
            env: {
              normal: "kept",
              token: "[redacted]",
            },
          },
        }),
      ],
    })
    expect(JSON.stringify(events)).not.toContain("sk-tool-secret")
    expect(JSON.stringify(events)).not.toContain("env-token-secret")
    expect(JSON.stringify(events)).toContain("/Users/liyang")
    expect(JSON.stringify(events)).toContain("C:\\\\Users\\\\liyang")
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
        toolUseId: "toolu-1",
        toolName: "toolu-1",
        content: "file contents",
        status: "success",
        success: true,
        ...baseEnvelope,
      }),
    ])
  })

  it("omits embedded image data URLs from persisted tool result text", () => {
    const encodedImage = "A".repeat(2_000)
    const events = bridgeSdkMessage({
      type: "user",
      session_id: "sdk-tools",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "toolu-read-html",
          content: `1705 <img src="data:image/jpeg;base64,${encodedImage}">`,
          is_error: false,
        }],
      },
    } as unknown as SDKMessage, baseEnvelope)

    expect(events).toEqual([
      expect.objectContaining({
        type: "toolResult",
        content: "1705 <img src=\"[embedded image omitted]\">",
        contentDiagnostics: expect.objectContaining({
          textCharCount: expect.any(Number),
        }),
      }),
    ])
    expect(JSON.stringify(events)).not.toContain(encodedImage)
  })

  it("extracts image SDK tool_result blocks into runtime-only imageBlocks", () => {
    const events = bridgeSdkMessage({
      type: "user",
      session_id: "sdk-tools",
      uuid: "uuid-tool-result-image",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu-image",
            content: [
              {
                type: "image",
                file: {
                  base64: "base64-secret-image-data",
                  type: "image/png",
                  originalSize: 123,
                  dimensions: {
                    originalWidth: 16,
                    originalHeight: 9,
                    displayWidth: 8,
                    displayHeight: 4,
                  },
                },
              },
              {
                type: "image",
                data: "mcp-image-data",
                mimeType: "image/webp",
              },
            ],
            is_error: false,
          },
        ],
      },
    } as unknown as SDKMessage, baseEnvelope)

    expect(events).toEqual([
      expect.objectContaining({
        type: "toolResult",
        sdkSessionId: "sdk-tools",
        toolUseId: "toolu-image",
        toolName: "toolu-image",
        contentDiagnostics: {
          kind: "array",
          itemCount: 2,
          contentTypes: ["image", "image"],
          textCharCount: 0,
          imageCount: 2,
          images: [
            {
              mimeType: "image/png",
              base64Length: 24,
              originalSize: 123,
              dimensions: {
                originalWidth: 16,
                originalHeight: 9,
                displayWidth: 8,
                displayHeight: 4,
              },
            },
            {
              mimeType: "image/webp",
              base64Length: 14,
            },
          ],
        },
        imageBlocks: [
          {
            kind: "image",
            mimeType: "image/png",
            base64: "base64-secret-image-data",
          },
          {
            kind: "image",
            mimeType: "image/webp",
            base64: "mcp-image-data",
          },
        ],
        status: "success",
        success: true,
        ...baseEnvelope,
      }),
    ])
  })

  it("ignores unsupported image mime types from tool result imageBlocks", () => {
    const events = bridgeSdkMessage({
      type: "user",
      session_id: "sdk-tools",
      uuid: "uuid-tool-result-image-svg",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu-svg",
            content: [
              {
                type: "image",
                data: "PHN2Zz4=",
                mimeType: "image/svg+xml",
              },
            ],
            is_error: false,
          },
        ],
      },
    } as unknown as SDKMessage, baseEnvelope)

    expect(events).toEqual([
      expect.objectContaining({
        type: "toolResult",
        toolUseId: "toolu-svg",
        contentDiagnostics: expect.objectContaining({
          imageCount: 1,
        }),
      }),
    ])
    expect(Array.isArray(events)).toBe(true)
    if (Array.isArray(events)) {
      expect(events[0]).not.toHaveProperty("imageBlocks")
    }
  })

  it("redacts sensitive SDK user tool_result content before emitting Agent events", () => {
    const events = bridgeSdkMessage({
      type: "user",
      session_id: "sdk-tools",
      uuid: "uuid-tool-result-secret",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu-secret",
            content: [
              {
                type: "text",
                text: "Authorization: Bearer sk-tool-result failed at /Users/liyang/private/file.ts",
              },
              {
                type: "text",
                text: "\ncookie=sid-secret",
              },
            ],
            is_error: true,
          },
        ],
      },
    } as unknown as SDKMessage, baseEnvelope)

    expect(events).toEqual([
      expect.objectContaining({
        type: "toolResult",
        sdkSessionId: "sdk-tools",
        toolUseId: "toolu-secret",
        toolName: "toolu-secret",
        content: expect.stringContaining("[redacted]"),
        status: "error",
        success: false,
        ...baseEnvelope,
      }),
    ])
    expect(JSON.stringify(events)).not.toContain("sk-tool-result")
    expect(JSON.stringify(events)).not.toContain("sid-secret")
    expect(JSON.stringify(events)).toContain("/Users/liyang/private")
  })

  it("redacts env-shaped tokens and data-server token payloads", () => {
    const events = bridgeSdkMessage({
      type: "user",
      session_id: "sdk-tools",
      uuid: "uuid-tool-result-env-secret",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu-secret",
            content: [
              {
                type: "text",
                text: [
                  "ANTHROPIC_AUTH_TOKEN=sk-auth ANTHROPIC_API_KEY=sk-api SYNAPSE_SIDE_CHANNEL_TOKEN=side-token",
                  "{\"token\":\"data-server-token\"}",
                  "node --env ANTHROPIC_AUTH_TOKEN=ps-auth --env SYNAPSE_SIDE_CHANNEL_TOKEN=ps-side /Users/liyang/project/app.js",
                  "Cookie: sid=session-secret; theme=light",
                ].join("\n"),
              },
            ],
            is_error: true,
          },
        ],
      },
    } as unknown as SDKMessage, baseEnvelope)

    const serialized = JSON.stringify(events)
    expect(serialized).toContain("[redacted]")
    expect(serialized).not.toContain("sk-auth")
    expect(serialized).not.toContain("sk-api")
    expect(serialized).not.toContain("side-token")
    expect(serialized).not.toContain("data-server-token")
    expect(serialized).not.toContain("ps-auth")
    expect(serialized).not.toContain("ps-side")
    expect(serialized).not.toContain("session-secret")
    expect(serialized).toContain("/Users/liyang/project/app.js")
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
          expect.stringContaining("/Users/liyang/private/project/file.ts"),
          expect.stringContaining("[redacted]"),
        ],
        stop_reason: expect.stringContaining("C:\\Users\\liyang\\secret\\file.ts"),
      }),
      ...baseEnvelope,
    })
    expect(serialized).not.toContain("sk-secret")
    expect(serialized).not.toContain("sid-secret")
    expect(serialized).toContain("/Users/liyang/private")
    expect(serialized).toContain("C:\\\\Users\\\\liyang")
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

  it("drops query and fragment from SDK bridge payload URLs", () => {
    const event = bridgeSdkMessage({
      type: "future_message",
      subtype: "future_subtype",
      session_id: "sdk-url",
      url: "https://api.example.test/v1/messages?token=sk-url#secret-fragment",
      nested: {
        request_url: "http://localhost:8787/callback?code=secret-code&state=secret-state",
        note: "https://example.test/docs?keep=query",
      },
    } as unknown as SDKMessage, baseEnvelope)

    const payload = (event as { payload: Record<string, unknown> }).payload
    expect(payload.url).toBe("https://api.example.test/v1/messages")
    expect(payload.nested).toMatchObject({
      request_url: "http://localhost:8787/callback",
      note: "https://example.test/docs?keep=query",
    })
    expect(JSON.stringify(payload)).not.toContain("sk-url")
    expect(JSON.stringify(payload)).not.toContain("secret-fragment")
    expect(JSON.stringify(payload)).not.toContain("secret-code")
    expect(JSON.stringify(payload)).not.toContain("secret-state")
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
    expect(serialized).toContain("/Users/liyang/private")
    expect(serialized).toContain("C:\\\\Users\\\\liyang")
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
