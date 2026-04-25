/**
 * Phase 0 — Shared lib helpers tests.
 */

import { describe, expect, it, vi } from "vitest"
import { buildKey, makeIdempotentDisposer, makeUnrefInterval, makeUnrefTimeout } from "../index"

describe("buildKey", () => {
  it("joins parts with '|' and stringifies non-strings", () => {
    expect(buildKey(["a", "b", 3])).toBe("a|b|3")
  })

  it("normalizes undefined to empty segments to keep position stable", () => {
    expect(buildKey(["a", undefined, "c"])).toBe("a||c")
    expect(buildKey([undefined, undefined])).toBe("|")
  })

  it("deterministic across calls with the same input", () => {
    const a = buildKey(["x", "y", undefined, "z"])
    const b = buildKey(["x", "y", undefined, "z"])
    expect(a).toBe(b)
  })
})

describe("makeUnrefTimeout", () => {
  it("calls the callback after the delay and returns a cancel fn", async () => {
    const fn = vi.fn()
    makeUnrefTimeout(5, fn)
    await new Promise((r) => setTimeout(r, 20))
    expect(fn).toHaveBeenCalledOnce()
  })

  it("cancel prevents the callback from running", async () => {
    const fn = vi.fn()
    const cancel = makeUnrefTimeout(50, fn)
    cancel()
    await new Promise((r) => setTimeout(r, 60))
    expect(fn).not.toHaveBeenCalled()
  })

  it("cancel can be called multiple times safely", () => {
    const cancel = makeUnrefTimeout(1000, () => {})
    cancel()
    expect(() => cancel()).not.toThrow()
  })
})

describe("makeUnrefInterval", () => {
  it("fires repeatedly until cancelled", async () => {
    const fn = vi.fn()
    const cancel = makeUnrefInterval(5, fn)
    await new Promise((r) => setTimeout(r, 30))
    cancel()
    const count = fn.mock.calls.length
    expect(count).toBeGreaterThanOrEqual(2)
    await new Promise((r) => setTimeout(r, 20))
    expect(fn.mock.calls.length).toBe(count)
  })
})

describe("makeIdempotentDisposer", () => {
  it("calls the inner fn exactly once across repeated invocations", () => {
    const fn = vi.fn()
    const dispose = makeIdempotentDisposer(fn)
    dispose()
    dispose()
    dispose()
    expect(fn).toHaveBeenCalledOnce()
  })

  it("inner fn errors propagate on the first call", () => {
    const dispose = makeIdempotentDisposer(() => {
      throw new Error("boom")
    })
    expect(() => dispose()).toThrow(/boom/)
  })

  it("after a throwing first call, subsequent calls are no-ops (does not re-throw)", () => {
    const dispose = makeIdempotentDisposer(() => {
      throw new Error("boom")
    })
    try {
      dispose()
    } catch {
      // First call throws — that's fine.
    }
    expect(() => dispose()).not.toThrow()
  })
})
