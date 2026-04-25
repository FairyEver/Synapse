/**
 * Phase 0.6 — Scheduling primitives.
 * SPEC §15.7.
 *
 * - TaskQueue: cap concurrency + priority + retry + AbortSignal cancellation
 * - RateLimiter: token bucket per key
 * - CircuitBreaker: closed → open → half-open
 *
 * Phase 0 keeps these in-memory and dependency-free.
 */

// ----- TaskQueue ----------------------------------------------------

export type Priority = "low" | "normal" | "high"

export interface RetryPolicy {
  readonly attempts: number
  readonly initialDelayMs?: number
  readonly maxDelayMs?: number
  readonly backoffFactor?: number
}

export interface Job<T> {
  readonly id: string
  readonly priority?: Priority
  readonly timeout?: number
  readonly retry?: RetryPolicy
  run(signal: AbortSignal): Promise<T>
}

export interface TaskQueue {
  enqueue<T>(job: Job<T>): Promise<T>
  readonly concurrency: number
  readonly pending: number
  readonly running: number
  pause(): void
  resume(): void
}

export interface TaskQueueOptions {
  readonly concurrency?: number
}

const PRIORITY_RANK: Record<Priority, number> = { low: 0, normal: 1, high: 2 }

interface PendingJob {
  readonly job: Job<unknown>
  readonly priority: Priority
  readonly resolve: (value: unknown) => void
  readonly reject: (err: unknown) => void
}

export class TaskQueueImpl implements TaskQueue {
  readonly concurrency: number
  private readonly queue: PendingJob[] = []
  private active = 0
  private paused = false

  constructor(options: TaskQueueOptions = {}) {
    this.concurrency = options.concurrency ?? 4
  }

  get pending(): number {
    return this.queue.length
  }
  get running(): number {
    return this.active
  }

  enqueue<T>(job: Job<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        job: job as Job<unknown>,
        priority: job.priority ?? "normal",
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      // High priority floats to the front.
      this.queue.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
      this.tick()
    })
  }

  pause(): void {
    this.paused = true
  }
  resume(): void {
    this.paused = false
    this.tick()
  }

  private tick(): void {
    if (this.paused) return
    while (this.active < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!
      this.active++
      void this.runOne(next).finally(() => {
        this.active--
        this.tick()
      })
    }
  }

  private async runOne(entry: PendingJob): Promise<void> {
    const retry = entry.job.retry ?? { attempts: 1 }
    const totalAttempts = Math.max(1, retry.attempts)
    let delay = retry.initialDelayMs ?? 0
    const maxDelay = retry.maxDelayMs ?? 5000
    const backoff = retry.backoffFactor ?? 2
    let lastErr: unknown

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      const controller = new AbortController()
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null
      if (entry.job.timeout) {
        timeoutHandle = setTimeout(() => controller.abort(new Error("Job timed out")), entry.job.timeout)
        if (typeof timeoutHandle.unref === "function") timeoutHandle.unref()
      }
      try {
        const result = await entry.job.run(controller.signal)
        if (timeoutHandle) clearTimeout(timeoutHandle)
        entry.resolve(result)
        return
      } catch (err) {
        lastErr = err
        if (timeoutHandle) clearTimeout(timeoutHandle)
        if (attempt < totalAttempts - 1) {
          await sleep(delay)
          delay = Math.min(delay * backoff || 1, maxDelay)
        }
      }
    }
    entry.reject(lastErr)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve()
      return
    }
    const t = setTimeout(resolve, ms)
    if (typeof t.unref === "function") t.unref()
  })
}

export function createTaskQueue(options?: TaskQueueOptions): TaskQueueImpl {
  return new TaskQueueImpl(options)
}

// ----- RateLimiter --------------------------------------------------

export interface RateLimiterPolicy {
  readonly capacity: number
  readonly refillPerSecond: number
}

export interface RateLimiter {
  configure(key: string, policy: RateLimiterPolicy): void
  acquire(key: string, cost?: number): Promise<void>
  /** Test helper: try to acquire without waiting. */
  tryAcquire(key: string, cost?: number): boolean
}

interface BucketState {
  policy: RateLimiterPolicy
  tokens: number
  lastRefill: number
}

export interface RateLimiterOptions {
  readonly now?: () => number
  /** Default 100 — capacity for unconfigured keys. */
  readonly defaultCapacity?: number
  /** Default 10/s — refill rate for unconfigured keys. */
  readonly defaultRefillPerSecond?: number
}

export class RateLimiterImpl implements RateLimiter {
  private readonly buckets = new Map<string, BucketState>()
  private readonly now: () => number
  private readonly defaultPolicy: RateLimiterPolicy

  constructor(options: RateLimiterOptions = {}) {
    this.now = options.now ?? Date.now
    this.defaultPolicy = {
      capacity: options.defaultCapacity ?? 100,
      refillPerSecond: options.defaultRefillPerSecond ?? 10,
    }
  }

  configure(key: string, policy: RateLimiterPolicy): void {
    const existing = this.buckets.get(key)
    if (existing) {
      existing.policy = policy
      existing.tokens = Math.min(existing.tokens, policy.capacity)
    } else {
      this.buckets.set(key, {
        policy,
        tokens: policy.capacity,
        lastRefill: this.now(),
      })
    }
  }

  async acquire(key: string, cost = 1): Promise<void> {
    while (!this.tryAcquire(key, cost)) {
      // Wait long enough for at least one token to refill.
      const bucket = this.bucket(key)
      const need = cost - bucket.tokens
      const waitMs = (need / bucket.policy.refillPerSecond) * 1000
      await sleep(Math.max(1, waitMs))
    }
  }

  tryAcquire(key: string, cost = 1): boolean {
    const bucket = this.bucket(key)
    this.refill(bucket)
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost
      return true
    }
    return false
  }

  private bucket(key: string): BucketState {
    const existing = this.buckets.get(key)
    if (existing) return existing
    const fresh: BucketState = {
      policy: this.defaultPolicy,
      tokens: this.defaultPolicy.capacity,
      lastRefill: this.now(),
    }
    this.buckets.set(key, fresh)
    return fresh
  }

  private refill(bucket: BucketState): void {
    const t = this.now()
    const elapsedSec = Math.max(0, (t - bucket.lastRefill) / 1000)
    bucket.tokens = Math.min(bucket.policy.capacity, bucket.tokens + elapsedSec * bucket.policy.refillPerSecond)
    bucket.lastRefill = t
  }
}

export function createRateLimiter(options?: RateLimiterOptions): RateLimiterImpl {
  return new RateLimiterImpl(options)
}

// ----- CircuitBreaker -----------------------------------------------

export type CircuitState = "closed" | "open" | "half-open"

export interface CircuitBreakerPolicy {
  /** Failures before tripping the breaker. Default 5. */
  readonly failureThreshold?: number
  /** Time to wait before half-opening, ms. Default 30s. */
  readonly cooldownMs?: number
  /** Successes in half-open before fully closing. Default 1. */
  readonly halfOpenSuccessesNeeded?: number
}

export interface CircuitBreaker {
  execute<T>(key: string, fn: () => Promise<T>): Promise<T>
  state(key: string): CircuitState
  configure(key: string, policy: CircuitBreakerPolicy): void
}

interface CircuitState_ {
  state: CircuitState
  failures: number
  successesInHalfOpen: number
  openedAt: number
  policy: Required<CircuitBreakerPolicy>
}

const DEFAULT_BREAKER_POLICY: Required<CircuitBreakerPolicy> = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  halfOpenSuccessesNeeded: 1,
}

export class CircuitBreakerImpl implements CircuitBreaker {
  private readonly states = new Map<string, CircuitState_>()
  private readonly now: () => number

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now
  }

  configure(key: string, policy: CircuitBreakerPolicy): void {
    const merged: Required<CircuitBreakerPolicy> = { ...DEFAULT_BREAKER_POLICY, ...policy }
    const existing = this.states.get(key)
    if (existing) {
      existing.policy = merged
    } else {
      this.states.set(key, this.fresh(merged))
    }
  }

  state(key: string): CircuitState {
    return this.stateFor(key).state
  }

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const slot = this.stateFor(key)
    if (slot.state === "open") {
      const elapsed = this.now() - slot.openedAt
      if (elapsed >= slot.policy.cooldownMs) {
        slot.state = "half-open"
        slot.successesInHalfOpen = 0
      } else {
        throw new CircuitOpenError(key, slot.policy.cooldownMs - elapsed)
      }
    }
    try {
      const result = await fn()
      this.onSuccess(slot)
      return result
    } catch (err) {
      this.onFailure(slot)
      throw err
    }
  }

  private onSuccess(slot: CircuitState_): void {
    if (slot.state === "half-open") {
      slot.successesInHalfOpen++
      if (slot.successesInHalfOpen >= slot.policy.halfOpenSuccessesNeeded) {
        slot.state = "closed"
        slot.failures = 0
      }
    } else {
      slot.failures = 0
    }
  }

  private onFailure(slot: CircuitState_): void {
    slot.failures++
    if (slot.state === "half-open") {
      slot.state = "open"
      slot.openedAt = this.now()
      slot.successesInHalfOpen = 0
    } else if (slot.failures >= slot.policy.failureThreshold) {
      slot.state = "open"
      slot.openedAt = this.now()
    }
  }

  private stateFor(key: string): CircuitState_ {
    const existing = this.states.get(key)
    if (existing) return existing
    const fresh = this.fresh(DEFAULT_BREAKER_POLICY)
    this.states.set(key, fresh)
    return fresh
  }

  private fresh(policy: Required<CircuitBreakerPolicy>): CircuitState_ {
    return {
      state: "closed",
      failures: 0,
      successesInHalfOpen: 0,
      openedAt: 0,
      policy,
    }
  }
}

export class CircuitOpenError extends Error {
  readonly key: string
  readonly retryAfterMs: number
  constructor(key: string, retryAfterMs: number) {
    super(`Circuit "${key}" is open; retry after ${retryAfterMs}ms`)
    this.name = "CircuitOpenError"
    this.key = key
    this.retryAfterMs = retryAfterMs
  }
}

export function createCircuitBreaker(options?: { now?: () => number }): CircuitBreakerImpl {
  return new CircuitBreakerImpl(options)
}
