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
