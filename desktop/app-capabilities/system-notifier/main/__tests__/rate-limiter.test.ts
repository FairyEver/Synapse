import { describe, expect, it } from "vitest"
import { SystemNotifierRateLimiter } from "../rate-limiter"

describe("SystemNotifierRateLimiter", () => {
  it("enforces the identity bucket and continuously refills it", () => {
    let now = 0
    const limiter = new SystemNotifierRateLimiter(() => now)
    expect(Array.from({ length: 5 }, () => limiter.acquire("caller"))).toEqual([
      true, true, true, true, true,
    ])
    expect(limiter.acquire("caller")).toBe(false)
    now = 9_999
    expect(limiter.acquire("caller")).toBe(false)
    now = 10_000
    expect(limiter.acquire("caller")).toBe(true)
  })

  it("deducts neither bucket when either bucket lacks a token", () => {
    let now = 0
    const limiter = new SystemNotifierRateLimiter(() => now)
    for (let index = 0; index < 5; index++) expect(limiter.acquire("limited")).toBe(true)
    expect(limiter.acquire("limited")).toBe(false)

    for (let index = 0; index < 15; index++) expect(limiter.acquire(`other-${index}`)).toBe(true)
    expect(limiter.acquire("global-blocked")).toBe(false)

    now = 2_000
    expect(limiter.acquire("global-blocked")).toBe(true)
  })

  it("removes identities lazily after ten idle minutes", () => {
    let now = 0
    const limiter = new SystemNotifierRateLimiter(() => now)
    for (let index = 0; index < 5; index++) limiter.acquire("caller")
    now = 10 * 60_000
    expect(limiter.acquire("cleanup-trigger")).toBe(true)
    expect(limiter.acquire("caller")).toBe(true)
  })
})
