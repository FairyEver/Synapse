import { describe, expect, it } from "vitest"
import {
  AccessPolicyService,
  OutgoingRateLimiter,
  SlidingWindowRateLimiter,
} from "../../electron/services/access-policy-service"

describe("rate limit", () => {
  it("allows requests within the sliding window and blocks overflow per key", () => {
    let now = 1_000
    const limiter = new SlidingWindowRateLimiter({ maxMessages: 3, windowMs: 60_000 }, { now: () => now })

    expect(limiter.allow("user1")).toBe(true)
    expect(limiter.allow("user1")).toBe(true)
    expect(limiter.allow("user1")).toBe(true)
    expect(limiter.allow("user1")).toBe(false)
    expect(limiter.allow("user2")).toBe(true)

    now += 60_001
    expect(limiter.allow("user1")).toBe(true)
  })

  it("disables inbound rate limiting when max_messages is zero", () => {
    const limiter = new SlidingWindowRateLimiter({ maxMessages: 0, windowMs: 60_000 })

    for (let index = 0; index < 100; index++) {
      expect(limiter.allow("user1")).toBe(true)
    }
  })

  it("uses role rate limits first and global fallback keying like CC Connect", () => {
    let now = 1_000
    const rolePolicy = new AccessPolicyService({
      defaultRole: "member",
      roles: [
        { name: "admin", userIds: ["admin1"], disabledCommands: [], rateLimit: { maxMessages: 50, windowMs: 60_000 } },
        { name: "member", userIds: ["*"], disabledCommands: [], rateLimit: { maxMessages: 2, windowMs: 60_000 } },
      ],
      rateLimit: { maxMessages: 1, windowMs: 60_000 },
      now: () => now,
    })

    expect(rolePolicy.checkIncomingRate({ sessionKey: "s1", userId: "user1" })).toEqual({ allowed: true })
    expect(rolePolicy.checkIncomingRate({ sessionKey: "s1", userId: "user1" })).toEqual({ allowed: true })
    expect(rolePolicy.checkIncomingRate({ sessionKey: "s2", userId: "user1" })).toEqual({
      allowed: false,
      reason: "rate_limited",
      role: "member",
    })
    expect(rolePolicy.checkIncomingRate({ sessionKey: "s1", userId: "admin1" })).toEqual({ allowed: true })

    now += 60_001
    const fallbackPolicy = new AccessPolicyService({
      defaultRole: "member",
      roles: [{ name: "member", userIds: ["*"], disabledCommands: [] }],
      rateLimit: { maxMessages: 2, windowMs: 60_000 },
      now: () => now,
    })

    expect(fallbackPolicy.checkIncomingRate({ sessionKey: "session1", userId: "same-user" })).toEqual({ allowed: true })
    expect(fallbackPolicy.checkIncomingRate({ sessionKey: "session2", userId: "same-user" })).toEqual({ allowed: true })
    expect(fallbackPolicy.checkIncomingRate({ sessionKey: "session3", userId: "same-user" })).toEqual({
      allowed: false,
      reason: "rate_limited",
    })

    const legacyPolicy = new AccessPolicyService({
      rateLimit: { maxMessages: 1, windowMs: 60_000 },
      now: () => now,
    })
    expect(legacyPolicy.checkIncomingRate({ sessionKey: "session1", userId: "same-user" })).toEqual({ allowed: true })
    expect(legacyPolicy.checkIncomingRate({ sessionKey: "session1", userId: "same-user" })).toEqual({
      allowed: false,
      reason: "rate_limited",
    })
    expect(legacyPolicy.checkIncomingRate({ sessionKey: "session2", userId: "same-user" })).toEqual({ allowed: true })
  })

  it("starts outgoing token buckets full, then refills per platform", () => {
    let now = 1_000
    const limiter = new OutgoingRateLimiter(
      { maxPerSecond: 2, burst: 2 },
      { fast: { maxPerSecond: 100 }, unlimited: { maxPerSecond: 0 } },
      { now: () => now },
    )

    expect(limiter.tryAcquire("slow")).toBe(true)
    expect(limiter.tryAcquire("slow")).toBe(true)
    expect(limiter.tryAcquire("slow")).toBe(false)
    expect(limiter.nextDelayMs("slow")).toBe(500)

    now += 500
    expect(limiter.tryAcquire("slow")).toBe(true)

    for (let index = 0; index < 10; index++) {
      expect(limiter.tryAcquire("fast")).toBe(true)
    }
    for (let index = 0; index < 50; index++) {
      expect(limiter.tryAcquire("unlimited")).toBe(true)
    }
  })

  it("uses ceil(max_per_second) as the default burst", () => {
    let now = 1_000
    const limiter = new OutgoingRateLimiter({ maxPerSecond: 1.5 }, {}, { now: () => now })

    expect(limiter.tryAcquire("p")).toBe(true)
    expect(limiter.tryAcquire("p")).toBe(true)
    expect(limiter.tryAcquire("p")).toBe(false)

    now += 667
    expect(limiter.tryAcquire("p")).toBe(true)
  })
})
