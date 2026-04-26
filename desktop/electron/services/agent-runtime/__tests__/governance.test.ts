import { describe, expect, it } from "vitest"

import {
  AgentGovernanceService,
  MessageDedupe,
  OutgoingTokenBucketLimiter,
  SlidingWindowRateLimiter,
} from "../governance"
import type { AgentMessage } from "../types"

describe("AgentGovernanceService", () => {
  it("blocks disabled commands", () => {
    const governance = new AgentGovernanceService({ disabledCommands: ["model"] })
    expect(governance.evaluateMessage(message("/model gpt-5.4"))).toEqual(
      expect.objectContaining({ allowed: false, code: "disabled-command" }),
    )
  })

  it("requires admin allowlist for privileged commands", () => {
    const governance = new AgentGovernanceService({ adminUserIds: ["admin-1"] })

    expect(governance.evaluateMessage(message("/shell pwd", { userId: "user-1" }))).toEqual(
      expect.objectContaining({ allowed: false, code: "admin-required" }),
    )
    expect(governance.evaluateMessage(message("/shell pwd", { userId: "admin-1" }))).toEqual(
      { allowed: true },
    )
  })

  it("uses role disabled commands and role rate limits", () => {
    const governance = new AgentGovernanceService({
      roles: [
        {
          name: "guest",
          userIds: ["guest-1"],
          disabledCommands: ["status"],
          rateLimit: { maxMessages: 2, windowMs: 60_000 },
        },
      ],
    })

    expect(governance.evaluateMessage(message("/status", { userId: "guest-1" }))).toEqual(
      expect.objectContaining({ allowed: false, code: "disabled-command" }),
    )
    expect(governance.evaluateMessage(message("first", { userId: "guest-1" }))).toEqual(
      { allowed: true },
    )
    expect(governance.evaluateMessage(message("second", { userId: "guest-1" }))).toEqual(
      expect.objectContaining({ allowed: false, code: "rate-limit" }),
    )
  })

  it("applies global rate limits", () => {
    const governance = new AgentGovernanceService({
      rateLimit: { maxMessages: 1, windowMs: 60_000 },
    })

    expect(governance.evaluateMessage(message("first"))).toEqual({ allowed: true })
    expect(governance.evaluateMessage(message("second"))).toEqual(
      expect.objectContaining({ allowed: false, code: "rate-limit" }),
    )
  })

  it("blocks banned words outside slash commands", () => {
    const governance = new AgentGovernanceService({ bannedWords: ["secret"] })

    expect(governance.evaluateMessage(message("contains secret"))).toEqual(
      expect.objectContaining({ allowed: false, code: "banned-word" }),
    )
    expect(governance.evaluateMessage(message("/note secret"))).toEqual({ allowed: true })
  })

  it("checks allowlist and group mentions", () => {
    const governance = new AgentGovernanceService({
      allowlist: { mode: "users", userIds: ["user-1"] },
      groupMention: { required: true, botNames: ["synapse"] },
    })

    expect(governance.evaluateMessage(message("hello", { userId: "user-2" }))).toEqual(
      expect.objectContaining({ allowed: false, code: "allowlist" }),
    )
    expect(governance.evaluateMessage(message("hello", {
      userId: "user-1",
      chatType: "group",
    }))).toEqual(
      expect.objectContaining({ allowed: false, code: "mention-required" }),
    )
    expect(governance.evaluateMessage(message("@synapse hello", {
      userId: "user-1",
      chatType: "group",
    }))).toEqual({ allowed: true })
  })

  it("filters duplicate and old messages", () => {
    const governance = new AgentGovernanceService({
      dedupe: {
        ttlMs: 60_000,
        ignoreBefore: "2026-04-26T00:00:00.000Z",
      },
    })

    expect(governance.evaluateMessage(message("old", {
      messageId: "m-old",
      createdAt: "2026-04-25T23:59:00.000Z",
    }))).toEqual(expect.objectContaining({ allowed: false, code: "old-message" }))
    expect(governance.evaluateMessage(message("first", { messageId: "m1" }))).toEqual(
      { allowed: true },
    )
    expect(governance.evaluateMessage(message("duplicate", { messageId: "m1" }))).toEqual(
      expect.objectContaining({ allowed: false, code: "duplicate-message" }),
    )
  })

  it("limits outgoing messages with token buckets", () => {
    const governance = new AgentGovernanceService({
      outgoingRateLimit: {
        default: { maxPerSecond: 1, burst: 1 },
      },
    })

    expect(governance.allowOutgoing("local")).toBe(true)
    expect(governance.allowOutgoing("local")).toBe(false)
  })
})

describe("governance primitives", () => {
  it("supports direct rate limiter, outgoing limiter, and dedupe primitives", () => {
    let now = 0
    const rate = new SlidingWindowRateLimiter(
      { maxMessages: 1, windowMs: 1000 },
      () => now,
    )
    expect(rate.allow("u1")).toBe(true)
    expect(rate.allow("u1")).toBe(false)
    now = 1001
    expect(rate.allow("u1")).toBe(true)

    const outgoing = new OutgoingTokenBucketLimiter(
      { default: { maxPerSecond: 1, burst: 1 } },
      () => now,
    )
    expect(outgoing.allow("local")).toBe(true)
    expect(outgoing.allow("local")).toBe(false)

    const dedupe = new MessageDedupe(1000, undefined, () => now)
    expect(dedupe.isDuplicate("m1")).toBe(false)
    expect(dedupe.isDuplicate("m1")).toBe(true)
  })
})

function message(
  content: string,
  patch: Partial<AgentMessage> = {},
): AgentMessage {
  return {
    projectId: "project-1",
    sessionKey: "s1",
    platform: "local",
    userId: "user-1",
    content,
    ...patch,
  }
}
