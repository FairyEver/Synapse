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

  /**
   * 只看现在还能不能拿到一个 token，不扣任何配额。
   *
   * 图片暂存要在读文件、传字节之前问一次：已经会被限流挡掉的调用不该先做一次高权限的
   * 文件读取。真正扣额度仍由 `trigger` 里的 `acquire` 完成，诊断也仍记在那里。
   */
  canAcquire(identityKey: string): boolean {
    const current = this.now()
    const identity = this.identities.get(identityKey)
    const identityTokens = identity
      ? tokensAfterRefill(identity, current, IDENTITY_CAPACITY, IDENTITY_REFILL_INTERVAL_MS)
      : IDENTITY_CAPACITY
    return identityTokens >= 1
      && tokensAfterRefill(this.global, current, GLOBAL_CAPACITY, GLOBAL_REFILL_INTERVAL_MS) >= 1
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
  bucket.tokens = tokensAfterRefill(bucket, now, capacity, intervalMs)
  bucket.lastRefillAt = now
}

/** 只算不写：`canAcquire` 不能因为被问了一次就替调用方把时间推进。 */
function tokensAfterRefill(bucket: TokenBucket, now: number, capacity: number, intervalMs: number): number {
  const elapsed = Math.max(0, now - bucket.lastRefillAt)
  return Math.min(capacity, bucket.tokens + elapsed / intervalMs)
}

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now()
}
