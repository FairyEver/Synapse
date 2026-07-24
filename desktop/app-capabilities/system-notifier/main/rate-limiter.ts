const IDENTITY_CAPACITY = 5
const IDENTITY_REFILL_INTERVAL_MS = 10_000
const GLOBAL_CAPACITY = 20
const GLOBAL_REFILL_INTERVAL_MS = 2_000
const IDENTITY_IDLE_TTL_MS = 10 * 60_000

interface TokenBucket {
  tokens: number
  lastRefillAt: number
}

interface IdentityBucket extends TokenBucket {
  lastActivityAt: number
}

export class SystemNotifierRateLimiter {
  private readonly identities = new Map<string, IdentityBucket>()
  private global: TokenBucket

  constructor(private readonly now: () => number = monotonicNow) {
    const current = now()
    this.global = { tokens: GLOBAL_CAPACITY, lastRefillAt: current }
  }

  acquire(identityKey: string): boolean {
    const current = this.now()
    this.cleanupIdleIdentities(current)
    const identity = this.identities.get(identityKey) ?? {
      tokens: IDENTITY_CAPACITY,
      lastRefillAt: current,
      lastActivityAt: current,
    }
    this.identities.set(identityKey, identity)

    refill(identity, current, IDENTITY_CAPACITY, IDENTITY_REFILL_INTERVAL_MS)
    refill(this.global, current, GLOBAL_CAPACITY, GLOBAL_REFILL_INTERVAL_MS)
    identity.lastActivityAt = current

    if (identity.tokens < 1 || this.global.tokens < 1) return false
    identity.tokens -= 1
    this.global.tokens -= 1
    return true
  }

  clear(): void {
    this.identities.clear()
    const current = this.now()
    this.global = { tokens: GLOBAL_CAPACITY, lastRefillAt: current }
  }

  private cleanupIdleIdentities(current: number): void {
    for (const [key, bucket] of this.identities) {
      if (current - bucket.lastActivityAt >= IDENTITY_IDLE_TTL_MS) {
        this.identities.delete(key)
      }
    }
  }
}

function refill(bucket: TokenBucket, now: number, capacity: number, intervalMs: number): void {
  const elapsed = Math.max(0, now - bucket.lastRefillAt)
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed / intervalMs)
  bucket.lastRefillAt = now
}

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now()
}
