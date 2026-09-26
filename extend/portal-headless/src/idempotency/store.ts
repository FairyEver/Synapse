/**
 * 短窗口去重表（设计 D12）。
 *
 * ## 它做什么
 *
 * 同一个键（`namespace|tenant|user|能力|目标|requestId`，见 `key.ts`）在 TTL 窗口内
 * 重复调用时：**返回第一次的结果，不再发请求**。并发到达的同键调用共享同一次请求。
 *
 * ## ⚠️ 它做不到什么（这是「短窗口防重」，不是幂等）
 *
 * 下面每一条都是**已知且接受**的缺口，不要当成待修的 bug，也不要在别处把它写成"幂等"：
 *
 * 1. **进程重启就没了**：整张表在内存里（刻意如此——落盘会让 SDK 引入状态文件、
 *    清理策略和并发写文件的问题，收益却只是覆盖"本进程存活期间的重试"）。
 *    重启后同 key 的重试会真的再发一次。
 * 2. **多实例部署不生效**：两个进程各自一张表，各自都会发。要跨进程只有一个办法：
 *    后端认幂等键。这恰恰是本模块想推动的事。
 * 3. **TTL 过后不生效**：窗口默认 10 分钟（`DEFAULT_IDEMPOTENCY_TTL_MS`），
 *    之后同 key 会重新发出去。
 * 4. **不认识"已经写过了"**：它只认识"本进程这个窗口内调用过"。用户在 Portal 页面上
 *    手工提交过的单据，SDK 一无所知，照样会再提交一单。
 * 5. **它答不了"上一次到底写没写"**：超时后它会保留键、拒绝重发（见下面第 4 节），
 *    但要不要把上一次当成写成功，只有调用方去后端确认（查占用、查单据）才知道。
 *    SDK 不替用户赌，也不替用户查。
 * 6. **不解决"写成功但结果丢了"**：第一次写成功、响应在网络里丢了，窗口内重试会被防住
 *    （这正是它的价值）；但窗口过后重试仍会再写一次。
 * 7. **`requestId` 是调用方给的**：AI 每次重试都新生成一个 requestId 的话，
 *    本模块完全失效，且不会报错。所以调用姿势必须是「同一次意图复用同一个值」，
 *    见 `writer.ts` 与 `./README.md`。
 *
 * 换句话说：它把「AI 自动重试导致的重复单据」这个最高频的成因摁住了，
 * 但**没有**把后端零幂等这件事解决。真正的幂等只能在服务端做——而且必须带唯一索引，
 * 不是先查后插。SDK 侧的设计与 BPM 已有的客户端幂等键同构，就是为了将来能拿同一套
 * 语言去推动后端。
 *
 * ## 失败怎么处理（见 `run()` 与 `defaultClassifyFailure`）
 *
 * - **确知没写**（后端明确答复否定 / 请求根本没发出去）→ **释放键**，同一个 requestId
 *   可以立刻重试。
 * - **不知道写没写**（超时、断连、HTTP 5xx、未识别异常）→ **保留键**，窗口内同 key
 *   重试直接抛回原错误、不再发请求。理由见 `run()` 里的长注释。
 *
 * ## 并发
 *
 * 「查表 + 登记」是一段**没有 await 的同步代码**，因此两个同时到达的同 key 调用
 * 不可能都登记成功：后来的那个必然看到 pending 记录，共享同一个 Promise。
 * 登记用的是自己造的 deferred（而不是「先跑 task 再登记它的 Promise」），
 * 这样即使 task 在同步阶段重入本表，pending 记录也已经带着可用的 Promise 挂在表上了。
 */

import { PortalApiError, PortalCredentialError } from '../http/errors.js'
import { NotDispatchedError } from './errors.js'
import { fingerprintPayload } from './fingerprint.js'
import { assertSamePayload, idempotencyKey, normalizeRequestId } from './key.js'
import {
  DEFAULT_IDEMPOTENCY_TTL_MS,
  systemClock,
  type Clock,
  type FailureClassifier,
  type IdempotencyEvent,
  type IdempotencyFailureKind,
  type IdempotencyScope,
  type IdempotencyStats,
  type IdempotencyStoreOptions,
} from './types.js'

/** 进行中。没有 `expiresAt`：pending 不按 TTL 清理，见 `prune()` */
type PendingEntry = {
  status: 'pending'
  key: string
  capabilityId: string
  requestId: string
  fingerprint: string
  /** 自己造的 deferred：登记时就必须是可用状态，不能等 task 跑起来 */
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  promise: Promise<unknown>
}

type SucceededEntry = {
  status: 'succeeded'
  key: string
  capabilityId: string
  requestId: string
  fingerprint: string
  result: unknown
  expiresAt: number
}

/** 「不知道后端写没写」。窗口内保留：用来拒绝重发，而不是用来回放结果 */
type InDoubtEntry = {
  status: 'in-doubt'
  key: string
  capabilityId: string
  requestId: string
  fingerprint: string
  error: unknown
  expiresAt: number
}

type Entry = PendingEntry | SucceededEntry | InDoubtEntry

export type IdempotentCall<T> = {
  scope: IdempotencyScope
  /** 参与指纹的载荷（通常就是请求体） */
  payload: unknown
  /** 覆盖指纹计算：载荷含不可序列化值时用 */
  fingerprint?: string
  /** 真正发请求的函数。只有第一次（以及确知失败被释放之后的重试）会被调用 */
  task: () => Promise<T>
}

/**
 * 默认的失败归类：**保守**。
 *
 * 只有两种情形算「确知没写」：
 * 1. `NotDispatchedError`：调用方明确断言请求没发出去（本地校验失败等）。
 * 2. `PortalApiError` / `PortalCredentialError`：后端**答复了**，且答复是否定
 *    （响应包络 `ret !== 'SUCCESS'`，或凭据被拒 401/403）。
 *    这里依赖一条可以质疑的假设：非 SUCCESS 的答复意味着后端事务已回滚、没有落库。
 *    如果哪天发现某接口会"报了错但已经写进去"，就必须把那个接口的失败改判为 unknown
 *    （或者干脆让后端给它补幂等键）——改这里之前先确认这一点。
 *
 * 其余一切（超时、ECONNRESET、HTTP 5xx、JSON 解析失败、任何未识别异常）都算 unknown。
 * 宁可多拦一次重试，不可多写一张单据。
 */
export function defaultClassifyFailure (error: unknown): IdempotencyFailureKind {
  if (error instanceof NotDispatchedError) return 'not-written'
  if (error instanceof PortalApiError) return 'not-written'
  if (error instanceof PortalCredentialError) return 'not-written'
  return 'unknown'
}

export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>()
  private readonly ttlMs: number
  private readonly now: Clock
  private readonly classifyFailure: FailureClassifier
  private readonly onEvent: ((event: IdempotencyEvent) => void) | undefined
  /** 观测回调自己抛出的异常。见 `emit()`；只用于诊断，不在写路径上 */
  private readonly collectedObserverErrors: unknown[] = []

  constructor (options: IdempotencyStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error(`ttlMs 必须是正数（实际：${String(options.ttlMs)}）`)
    }
    this.now = options.now ?? systemClock
    this.classifyFailure = options.classifyFailure ?? defaultClassifyFailure
    this.onEvent = options.onEvent
  }

  /**
   * 跑一次写调用（幂等入口）。
   *
   * 命中同键时**不发请求**：
   * - 记录是成功 → 回放第一次的结果；
   * - 记录是进行中 → 共享同一个 Promise（并发同键只发一次）；
   * - 记录是 in-doubt → 抛回第一次的错误（**不再发**，理由见下）；
   * - 载荷指纹不同 → 抛 `IdempotencyKeyReuseError`（规则见 `key.ts`）。
   *
   * ## 失败之后这个键释放不释放
   *
   * 分界线是**我们知不知道后端写没写**，而不是「失败严不严重」：
   *
   * - **确知没写 → 释放**（删记录）。业务失败是后端收到并拒绝了，本地预检是连请求都没发，
   *   两种情况下重试都是安全的；不释放反而有害：用户按提示改完参数，却在 TTL 里
   *   被自己的上一次失败挡住，只能干等。BPM 的 `limit_key` 是同一条规则——
   *   「同步全失败时置空允许重试」（`BpmProcessSmsRemindMapper.releaseDailyLimits`）。
   * - **不知道写没写 → 保留**（记为 in-doubt，窗口内拒绝重发）。
   *   超时就是这种情况：请求可能已经落库、只是响应没回来。此时释放键 = 允许自动重试，
   *   而 AI 的超时重试是常态——**那正是"一张重复单据"最常见的产生方式**。
   *   保留不是因为知道它写了，而是因为**不知道**：唯一安全的动作是把不确定性交还调用方，
   *   先确认（例如查一下该时段的占用 / 单据列表）上一次到底生效没有，再决定是复用这个
   *   requestId（确认没生效）还是作罢。这里刻意不做"自动重试"，SDK 没有资格替用户赌。
   *
   * 注意 in-doubt 也只保留到 TTL：窗口过后同 key 会重新发出去。这是能力边界，
   * 不是遗漏——见本文件顶部。
   */
  async run<T> (call: IdempotentCall<T>): Promise<T> {
    const { scope, payload, task } = call
    const requestId = normalizeRequestId(scope.requestId)
    const key = idempotencyKey({ ...scope, requestId })
    const fingerprint = call.fingerprint ?? fingerprintPayload(payload)

    // 过期清理放在查表之前，保证「TTL 过后能重发」对本次调用立刻生效
    this.prune()

    const existing = this.entries.get(key)
    if (existing) {
      assertSamePayload({
        key,
        capabilityId: existing.capabilityId,
        requestId,
        stored: existing.fingerprint,
        incoming: fingerprint,
      })

      if (existing.status === 'pending') {
        this.emit({ type: 'join-pending', key, capabilityId: existing.capabilityId })
        return existing.promise as Promise<T>
      }
      if (existing.status === 'succeeded') {
        this.emit({ type: 'replay-success', key, capabilityId: existing.capabilityId })
        return existing.result as T
      }
      // in-doubt：抛回**原错误对象本身**。包一层会破坏调用方的 instanceof 分支，
      // 也会把真正的失败原因藏起来；"这次没有重发"这件事通过 onEvent 观测，不靠错误类型。
      this.emit({
        type: 'replay-in-doubt',
        key,
        capabilityId: existing.capabilityId,
        error: existing.error,
      })
      throw existing.error
    }

    // —— 以下是同步的「登记」段：中间没有 await，所以两个并发同键调用不可能都走到这里 ——
    const pending = createPendingEntry(key, scope.capabilityId, requestId, fingerprint)
    this.entries.set(key, pending)
    this.start(pending, task)
    return pending.promise as Promise<T>
  }

  /** 当前存活的记录数（顺带清掉过期的） */
  get size (): number {
    this.prune()
    return this.entries.size
  }

  get stats (): IdempotencyStats {
    this.prune()
    const stats: IdempotencyStats = { live: 0, pending: 0, succeeded: 0, inDoubt: 0 }
    for (const entry of this.entries.values()) {
      stats.live += 1
      if (entry.status === 'pending') stats.pending += 1
      else if (entry.status === 'succeeded') stats.succeeded += 1
      else stats.inDoubt += 1
    }
    return stats
  }

  /**
   * 观测回调自己抛出的异常（诊断用）。
   *
   * 观测回调跑在写调用的关键路径上，让它把一次成功的写变成失败是不可接受的；
   * 但又不能静默丢弃，所以收集在这里，由测试/诊断读取。
   */
  get observerErrors (): readonly unknown[] {
    return this.collectedObserverErrors
  }

  /** 键是否存在且未过期（诊断用） */
  has (scope: IdempotencyScope): boolean {
    this.prune()
    return this.entries.has(idempotencyKey(scope))
  }

  /**
   * 丢掉一个键（不取消已经发出去的请求）。
   *
   * 用途：pending 记录不按 TTL 清理（见 `prune()`），万一底层请求永不 settle，
   * 需要有办法把它解开。正常路径上不需要调用它。
   */
  forget (scope: IdempotencyScope): boolean {
    return this.entries.delete(idempotencyKey(scope))
  }

  clear (): void {
    this.entries.clear()
  }

  // -------------------------------------------------------------------------

  private start<T> (entry: PendingEntry, task: () => Promise<T>): void {
    let attempt: Promise<T>
    try {
      attempt = task()
    } catch (error) {
      // 同步抛出 = 请求肯定没发出去，按确知失败处理
      this.recordFailure(entry, error)
      entry.reject(error)
      return
    }

    if (typeof (attempt as { then?: unknown } | null | undefined)?.then !== 'function') {
      // task 没返回 Promise（接线写错了，例如忘了 return）。不能当成成功——那会把
      // undefined 记成结果，让后续同键调用全部命中一个假结果；也不能让这个键停在
      // pending 上永远不落地（表里没有 await 后的清理），所以要显式失败掉。
      const error = new TypeError(
        `幂等任务的返回值不是 Promise（实际：${String(attempt)}）：` +
        '写函数必须返回 Promise，否则无法判断这次写有没有完成'
      )
      this.recordFailure(entry, error)
      entry.reject(error)
      return
    }

    attempt.then(
      (result) => {
        this.recordSuccess(entry, result)
        entry.resolve(result)
      },
      (error: unknown) => {
        this.recordFailure(entry, error)
        entry.reject(error)
      },
    )
  }

  private recordSuccess (entry: PendingEntry, result: unknown): void {
    if (this.entries.get(entry.key) !== entry) return

    this.entries.set(entry.key, {
      status: 'succeeded',
      key: entry.key,
      capabilityId: entry.capabilityId,
      requestId: entry.requestId,
      fingerprint: entry.fingerprint,
      result,
      // TTL 从**结束**时刻起算，而不是从发起的时刻：一次跑了 3 分钟的请求
      // 不该只剩下 7 分钟的保护窗口。
      expiresAt: this.now() + this.ttlMs,
    })
    this.emit({ type: 'recorded-success', key: entry.key, capabilityId: entry.capabilityId })
  }

  private recordFailure (entry: PendingEntry, error: unknown): void {
    if (this.entries.get(entry.key) !== entry) return

    const kind: IdempotencyFailureKind = this.classifyFailure(error)
    if (kind === 'not-written') {
      this.entries.delete(entry.key)
      this.emit({
        type: 'release-not-written',
        key: entry.key,
        capabilityId: entry.capabilityId,
        error,
      })
      return
    }
    this.entries.set(entry.key, {
      status: 'in-doubt',
      key: entry.key,
      capabilityId: entry.capabilityId,
      requestId: entry.requestId,
      fingerprint: entry.fingerprint,
      error,
      expiresAt: this.now() + this.ttlMs,
    })
    this.emit({ type: 'retain-in-doubt', key: entry.key, capabilityId: entry.capabilityId, error })
  }

  /**
   * 清掉过期的成功 / in-doubt 记录。
   *
   * **pending 记录不按 TTL 清**：它的请求还在飞，清掉之后同键的新调用会再发一次——
   * 那就是双写。代价是「底层请求永不 settle」时这个键会一直被占着，
   * 所以留了 `forget()` 作为解开的出口。
   */
  private prune (): void {
    const now = this.now()
    for (const [key, entry] of this.entries) {
      if (entry.status === 'pending') continue
      if (entry.expiresAt <= now) {
        this.entries.delete(key)
      }
    }
  }

  private emit (event: IdempotencyEvent): void {
    if (!this.onEvent) return
    try {
      this.onEvent(event)
    } catch (error) {
      this.collectedObserverErrors.push(error)
    }
  }
}

function createPendingEntry (
  key: string,
  capabilityId: string,
  requestId: string,
  fingerprint: string,
): PendingEntry {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { status: 'pending', key, capabilityId, requestId, fingerprint, resolve, reject, promise }
}
