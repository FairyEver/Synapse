import { describe, expect, it } from "vitest"
import {
  DEFAULT_RELAY_TIMEOUT_MS,
  parseRelaySessionKey,
  processRelayTurn,
  RelayService,
  truncateRelayResponse,
} from "../../electron/services/relay-service"

describe("relay golden behavior", () => {
  it("parses normal and relay session keys", () => {
    expect(parseRelaySessionKey("feishu:oc_chat:user")).toEqual({
      platform: "feishu",
      chatId: "oc_chat",
    })
    expect(parseRelaySessionKey("relay:alpha:oc_chat:thread")).toEqual({
      platform: "relay",
      chatId: "oc_chat:thread",
    })
    expect(() => parseRelaySessionKey("invalid")).toThrow("invalid session key")
  })

  it("collects text, falls back to accumulated text, and auto-approves permissions", () => {
    const result = processRelayTurn({
      fromProject: "alpha",
      toProject: "beta",
      chatId: "chat-1",
      message: "hello",
      events: [
        { type: "text", content: "partial " },
        { type: "permission_request", requestId: "req-1", toolName: "Read" },
        { type: "tool_result", toolName: "Read", toolResult: "ok" },
        { type: "result", done: true },
      ],
    })

    expect(result).toEqual({
      status: "completed",
      response: "partial Read: ok\n\n",
      textParts: ["partial ", "Read: ok\n\n"],
      autoApprovedRequestIds: ["req-1"],
    })
  })

  it("returns partial text on timeout and an error when no text exists", () => {
    expect(processRelayTurn({
      fromProject: "alpha",
      toProject: "beta",
      chatId: "chat-1",
      message: "slow",
      timeoutMs: 20,
      eventGapsMs: [0, 30],
      events: [
        { type: "text", content: "partial response" },
        { type: "thinking", content: "still working" },
      ],
    })).toMatchObject({
      status: "partial_timeout",
      response: "partial response",
    })

    expect(processRelayTurn({
      fromProject: "alpha",
      toProject: "beta",
      chatId: "chat-1",
      message: "slow",
      timeoutMs: 20,
      eventGapsMs: [30],
      events: [{ type: "thinking", content: "still working" }],
    })).toMatchObject({
      status: "timeout",
      error: "relay response timed out",
    })
  })

  it("keeps exact target names, bindings, and group visibility messages", () => {
    const relay = new RelayService()
    relay.bind("feishu", "chat-1", { alpha: "Alpha Bot", beta: "Beta Bot" })
    relay.registerHandler("beta", (input) => processRelayTurn({
      ...input,
      events: [{ type: "result", content: "pong" }],
    }))

    expect(relay.listBoundBots("chat-1", "alpha")).toEqual({ beta: "Beta Bot" })
    expect(relay.send({
      from: "alpha",
      to: "beta",
      sessionKey: "feishu:chat-1:user-1",
      message: "ping",
    })).toEqual({
      response: "pong",
      timedOut: false,
      groupMessages: [
        "[Alpha Bot -> Beta Bot] ping",
        "[Beta Bot] pong",
      ],
    })
    expect(() => relay.send({
      from: "alpha",
      to: "Beta",
      sessionKey: "feishu:chat-1:user-1",
      message: "ping",
    })).toThrow("use the exact name")
  })

  it("supports configured timeout and unicode-safe truncation", () => {
    const relay = new RelayService()
    relay.setTimeoutMs(0)
    relay.bind("relay", "chat-1", { alpha: "alpha", beta: "beta" })
    relay.registerHandler("beta", (input) => {
      expect(input.timeoutMs).toBe(0)
      return processRelayTurn({
        ...input,
        timeoutMs: 0,
        eventGapsMs: [DEFAULT_RELAY_TIMEOUT_MS + 1],
        events: [{ type: "result", content: "done" }],
      })
    })

    expect(relay.send({
      from: "alpha",
      to: "beta",
      sessionKey: "relay:alpha:chat-1",
      message: "ping",
    }).groupMessages[0]).toBe("[relay] [alpha -> beta] ping")
    expect(truncateRelayResponse("你好世界", 2)).toBe("你好...")
  })
})
