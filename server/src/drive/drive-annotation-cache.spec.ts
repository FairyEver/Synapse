import { describe, expect, it, vi } from "vitest"
import { AnnotationComputationCache } from "./drive-annotation-cache"

describe("AnnotationComputationCache", () => {
  it("shares concurrent work, reuses completed results, and isolates revision keys", async () => {
    const cache = new AnnotationComputationCache<string>({ maxEntries: 2, maxBytes: 100, sizeOf: (value) => value.length })
    const load = vi.fn(async () => "value")
    const results = await Promise.all([cache.get("document:revision-1", load), cache.get("document:revision-1", load)])
    expect(load).toHaveBeenCalledTimes(1)
    expect(results.map((result) => result.status)).toEqual(["computed", "shared"])
    expect(await cache.get("document:revision-1", load)).toEqual({ value: "value", status: "hit" })
    await cache.get("document:revision-2", load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("does not cache failures and releases rejected in-flight work for retry", async () => {
    const cache = new AnnotationComputationCache<string>({ maxEntries: 2, maxBytes: 20, sizeOf: (value) => value.length })
    const failure = new Error("storage unavailable")
    const load = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue("retried")
    const failed = await Promise.allSettled([cache.get("key", load), cache.get("key", load)])
    expect(failed).toEqual([{ status: "rejected", reason: failure }, { status: "rejected", reason: failure }])
    expect(await cache.get("key", load)).toEqual({ value: "retried", status: "computed" })
  })

  it("retains a result under its loaded revision when lookup and load see different revisions", async () => {
    const cache = new AnnotationComputationCache<string>({ maxEntries: 4, maxBytes: 100, sizeOf: (value) => value.length })
    const load = vi.fn(async () => "new")
    await cache.get("old", load, (value) => value)
    expect((await cache.get("new", load)).status).toBe("hit")
    expect((await cache.get("old", load, (value) => value)).status).toBe("computed")
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("evicts by least recent use and byte budget, and skips oversized results", async () => {
    const cache = new AnnotationComputationCache<string>({ maxEntries: 2, maxBytes: 9, sizeOf: (value) => value.length })
    await cache.get("a", async () => "aa")
    await cache.get("b", async () => "bb")
    expect((await cache.get("a", async () => "bad")).status).toBe("hit")
    await cache.get("c", async () => "cc")
    expect((await cache.get("b", async () => "bb")).status).toBe("computed")
    expect((await cache.get("large", async () => "oversized")).status).toBe("computed")
    expect((await cache.get("large", async () => "oversized")).status).toBe("computed")
  })
})
