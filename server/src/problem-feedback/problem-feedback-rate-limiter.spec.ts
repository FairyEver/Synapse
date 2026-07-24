import { describe, expect, it } from "vitest"
import {
  normalizeProblemFeedbackAddress,
  ProblemFeedbackRateLimiter,
} from "./problem-feedback-rate-limiter"

describe("problem feedback rate limiter", () => {
  it("normalizes IPv4, mapped IPv6, IPv6 /64, and unknown keys", () => {
    expect(normalizeProblemFeedbackAddress("192.0.2.9")).toBe("192.0.2.9")
    expect(normalizeProblemFeedbackAddress("::ffff:192.0.2.9")).toBe("192.0.2.9")
    expect(normalizeProblemFeedbackAddress("192.0.2.9:443")).toBe("192.0.2.9")
    expect(normalizeProblemFeedbackAddress("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64")
    expect(normalizeProblemFeedbackAddress("[2001:0db8:1:2::1]:443")).toBe("2001:db8:1:2::/64")
    expect(normalizeProblemFeedbackAddress("[fe80::1%en0]:443")).toBe("fe80::/64")
    expect(normalizeProblemFeedbackAddress("2001:db8:1:2:ffff::9")).toBe("2001:db8:1:2::/64")
    expect(normalizeProblemFeedbackAddress("not-an-address")).toBe("unknown")
    expect(normalizeProblemFeedbackAddress(undefined)).toBe("unknown")
  })

  it("enforces the network capacity and continuous refill", () => {
    let now = 0
    const limiter = new ProblemFeedbackRateLimiter(() => now)

    expect(limiter.tryAcquire("192.0.2.1")).toBe(true)
    expect(limiter.tryAcquire("192.0.2.1")).toBe(true)
    expect(limiter.tryAcquire("192.0.2.1")).toBe(true)
    expect(limiter.tryAcquire("192.0.2.1")).toBe(false)

    now += 10 * 60 * 1000
    expect(limiter.tryAcquire("192.0.2.1")).toBe(true)
    expect(limiter.tryAcquire("192.0.2.1")).toBe(false)
  })

  it("does not deduct the global bucket when the network bucket denies", () => {
    const limiter = new ProblemFeedbackRateLimiter(() => 0)
    expect(limiter.tryAcquire("192.0.2.1")).toBe(true)
    expect(limiter.tryAcquire("192.0.2.1")).toBe(true)
    expect(limiter.tryAcquire("192.0.2.1")).toBe(true)
    expect(limiter.tryAcquire("192.0.2.1")).toBe(false)

    for (let index = 0; index < 27; index += 1) {
      expect(limiter.tryAcquire(`198.51.100.${index + 1}`), `request ${index + 1}`).toBe(true)
    }
    expect(limiter.tryAcquire("203.0.113.1")).toBe(false)
  })

  it("cleans idle network keys lazily without persisting them", () => {
    let now = 0
    const limiter = new ProblemFeedbackRateLimiter(() => now)
    limiter.tryAcquire("192.0.2.1")
    expect(limiter.getNetworkBucketCount()).toBe(1)

    now += 60 * 60 * 1000
    limiter.tryAcquire("198.51.100.1")
    expect(limiter.getNetworkBucketCount()).toBe(1)
  })
})
