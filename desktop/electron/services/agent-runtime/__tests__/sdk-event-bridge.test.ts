import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
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
})
