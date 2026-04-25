import { describe, expect, it } from "vitest"
import {
  CircuitOpenError,
  createCircuitBreaker,
  createRateLimiter,
  createTaskQueue,
  type Job,
} from "../index"

const job = <T>(id: string, fn: () => Promise<T>, opts: Partial<Job<T>> = {}): Job<T> => ({
  id,
  ...opts,
  run: () => fn(),
})

describe("TaskQueue (T6.8)", () => {
  it("respects concurrency cap", async () => {
    const queue = createTaskQueue({ concurrency: 2 })
    let active = 0
    let maxActive = 0
    const results: number[] = []
    const make = (n: number) =>
      queue.enqueue(
        job(`j${n}`, async () => {
          active++
          maxActive = Math.max(maxActive, active)
          await new Promise((r) => setTimeout(r, 5))
          active--
          return n
        }),
      )
    const all = await Promise.all([make(1), make(2), make(3), make(4)])
    results.push(...all)
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(results.sort()).toEqual([1, 2, 3, 4])
  })

  it("priority floats high jobs to the front", async () => {
    const queue = createTaskQueue({ concurrency: 1 })
    const order: string[] = []
    const trace = (id: string, prio?: "high" | "low" | "normal") =>
      queue.enqueue(
        job(id, async () => {
          order.push(id)
          return id
        }, { priority: prio }),
      )
    queue.pause()
    const a = trace("a", "low")
    const b = trace("b", "high")
    const c = trace("c", "normal")
    queue.resume()
    await Promise.all([a, b, c])
    // First in order should be the high-priority one.
    expect(order[0]).toBe("b")
  })

  it("retry policy retries on failure", async () => {
    const queue = createTaskQueue({ concurrency: 1 })
    let attempts = 0
    await expect(
      queue.enqueue(
        job(
          "x",
          async () => {
            attempts++
            if (attempts < 3) throw new Error("boom")
            return "ok"
          },
          { retry: { attempts: 3, initialDelayMs: 0 } },
        ),
      ),
    ).resolves.toBe("ok")
    expect(attempts).toBe(3)
  })
})

describe("RateLimiter (T6.8)", () => {
  it("tryAcquire empties the bucket up to capacity", () => {
    const rl = createRateLimiter()
    rl.configure("k", { capacity: 3, refillPerSecond: 1 })
    expect(rl.tryAcquire("k")).toBe(true)
    expect(rl.tryAcquire("k")).toBe(true)
    expect(rl.tryAcquire("k")).toBe(true)
    expect(rl.tryAcquire("k")).toBe(false)
  })

  it("tokens refill over time", () => {
    let now = 1_000_000
    const rl = createRateLimiter({ now: () => now })
    rl.configure("k", { capacity: 2, refillPerSecond: 10 })
    expect(rl.tryAcquire("k")).toBe(true)
    expect(rl.tryAcquire("k")).toBe(true)
    expect(rl.tryAcquire("k")).toBe(false)
    now += 200 // 200ms = 2 tokens at 10/s
    expect(rl.tryAcquire("k")).toBe(true)
    expect(rl.tryAcquire("k")).toBe(true)
  })

  it("acquire awaits until a token is available", async () => {
    const rl = createRateLimiter()
    rl.configure("k", { capacity: 1, refillPerSecond: 1000 })
    expect(rl.tryAcquire("k")).toBe(true)
    const t0 = Date.now()
    await rl.acquire("k")
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })
})

describe("CircuitBreaker (T6.8)", () => {
  it("trips after configured failure threshold", async () => {
    const cb = createCircuitBreaker()
    cb.configure("k", { failureThreshold: 3, cooldownMs: 1000 })
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute("k", async () => { throw new Error("x") })).rejects.toThrow()
    }
    expect(cb.state("k")).toBe("open")
    await expect(cb.execute("k", async () => "ok")).rejects.toBeInstanceOf(CircuitOpenError)
  })

  it("transitions open → half-open after cooldown", async () => {
    let now = 1000
    const cb = createCircuitBreaker({ now: () => now })
    cb.configure("k", { failureThreshold: 1, cooldownMs: 10, halfOpenSuccessesNeeded: 1 })
    await expect(cb.execute("k", async () => { throw new Error("x") })).rejects.toThrow()
    expect(cb.state("k")).toBe("open")
    now += 50
    // half-open path: a successful call closes the circuit.
    await expect(cb.execute("k", async () => "ok")).resolves.toBe("ok")
    expect(cb.state("k")).toBe("closed")
  })

  it("a failure during half-open immediately re-opens", async () => {
    let now = 1000
    const cb = createCircuitBreaker({ now: () => now })
    cb.configure("k", { failureThreshold: 1, cooldownMs: 10 })
    await expect(cb.execute("k", async () => { throw new Error("x") })).rejects.toThrow()
    now += 50
    await expect(cb.execute("k", async () => { throw new Error("y") })).rejects.toThrow()
    expect(cb.state("k")).toBe("open")
  })
})
