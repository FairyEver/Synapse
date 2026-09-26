/**
 * 写操作短窗口防重（设计 D12）—— 公共类型。
 *
 * 为什么需要它（三件事叠加，缺一不可）：
 * 1. 后端零幂等：全仓搜 `Idempotency-Key` / `X-Request-Id` / `reqId` / `nonce` 零命中，
 *    客户端没有任何办法让后端「认得出这是同一次请求」。
 * 2. 凭据不可撤销（决策 D17）：改密码不撤销已签发 token，出错也收不回来。
 * 3. AI 重试是常态：超时、模型重发起。一次 create 重发 = 一张重复单据。
 *
 * 于是 D12 定下的做法是：**写能力必带 `requestId`，SDK 在 TTL 窗口内去重**。
 * 目录里对 AI 的说明（`src/catalog/describe.ts` 的 `howToCall.idempotency`）说的就是这件事。
 *
 * ⚠️ 这是「短窗口防重」，**不是幂等**。它做不到什么，见 `store.ts` 顶部与
 * `./README.md`。不要在文档或注释里把它写成"幂等"。
 */

/** 注入时钟。TTL 相关测试用它推进时间，不要用真实 sleep。 */
export type Clock = () => number

export const systemClock: Clock = () => Date.now()

/**
 * 默认 TTL：10 分钟。
 *
 * 取值理由：窗口要盖住「一次 AI 意图里可能发生的重试链」——模型重发起、用户点重试、
 * 网络层重连，量级是秒到几分钟；又要短到不会在用户「过一会儿重新办一次」时误拦。
 * 注意窗口只约束**同一个 requestId**：换了 requestId 就是新意图，不受这个窗口限制，
 * 所以 TTL 偏长一点是安全的。
 */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000

/**
 * requestId 的长度上限。
 *
 * 与后端 BPM 已有的客户端幂等列对齐（`client_request_id VARCHAR(64)`，
 * 见 Mall_Platform_Java_Dev/erp-module-bpm/db/2026-07-22-流程跟进与短信提醒.sql）。
 * SDK 现在只在本地去重，不把它发出去；保持同一规格，是为了将来推动后端补幂等时
 * 同一个值可以原样落进那一列，不用改客户端。
 */
export const MAX_REQUEST_ID_LENGTH = 64

/** 允许的字符集：只保留能安全落进 VARCHAR 列、URL 和日志的值 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/

/**
 * 一次写调用的身份与范围。
 *
 * 键的组成对齐 BPM 的客户端幂等范式：那边唯一索引是
 * `(tenant_id, process_instance_id, creator, client_request_id)`（跟进）与
 * `(tenant_id, sender_user_id, client_request_id)`（短信提醒），
 * 即 **租户 + 用户 + 业务范围 + 客户端请求编号**。SDK 侧一一对应：
 *
 * | BPM | 这里 | 作用 |
 * |---|---|---|
 * | `tenant_id` | `tenantId` | 隔离租户 |
 * | `creator` / `sender_user_id` | `userId` | 隔离用户（**不是可选的锦上添花**，见下） |
 * | `process_instance_id` | `capabilityId` + `target` | 隔离业务对象与操作 |
 * | `client_request_id` | `requestId` | 调用方声明的"这是同一次调用" |
 * | —（BPM 无对应） | `namespace` | 同进程多接入方/多环境时再隔离一层 |
 *
 * 为什么要带 user/tenant 而不只用 `requestId`：`requestId` 是调用方（AI 会话）给的，
 * 不同用户完全可能给出同一个值（例如都用了默认前缀 + 计数器）。若不按身份隔离，
 * 用户 B 的写调用会命中用户 A 的结果，**把别人的单据当自己的成功返回**——
 * 这既是错，也是越权。BPM 的唯一索引同样带 `creator`，是同一个考虑。
 */
export type IdempotencyScope = {
  /** 客户端请求编号。同一次意图重试必须复用同一个值；新意图必须换新值 */
  requestId: string
  /** 写能力 ID，例如 `meeting-application-submit` */
  capabilityId: string
  /** 写操作的目标对象（撤销/更新类），例如单据 id；create 类不传 */
  target?: string | number
  /** 同进程多接入方/多环境（例如两个 baseUrl）时用来隔离 */
  namespace?: string
  tenantId?: string | number
  userId?: string | number
}

/**
 * 写调用的身份。由接线方（主会话）从会话里现取——
 * `PortalCredential` 只有 `token` 和 `tenantId`，**没有 userId**，
 * 而 userId 是键的隔离段之一，必须由知道会话身份的一方提供。
 *
 * 不传的后果写在这里，因为它很严重：同一租户下不同用户的同 requestId 会互相命中，
 * 于是 B 的写调用会拿到 A 的结果。宁可接错也别漏接。
 */
export type IdempotencyIdentity = {
  tenantId?: string | number
  userId?: string | number
  /** 同一进程里跑多个接入方/环境时用来隔离 */
  namespace?: string
}

/** 传给 `send` 的上下文。`payload` 就是参与指纹的那一份，避免构建两次导致两者不一致 */
export type IdempotentSendContext<Payload = unknown> = {
  requestId: string
  payload: Payload
}

/**
 * 失败归类。
 *
 * - `not-written`：**确知**后端没有写入。只有两种情形够得上这个判据——
 *   后端明确答复了且答复是否定（业务失败、凭据被拒），或请求根本没发出去（本地预检）。
 * - `unknown`：不知道。超时、连接断开、HTTP 5xx、任何未识别的异常都归这里。
 *
 * 这条区分是「失败后能不能重试」的全部依据，见 `store.ts` 的 `run()` 与 `./README.md`。
 */
export type IdempotencyFailureKind = 'not-written' | 'unknown'

/** 判定一个失败属于哪一类。默认实现见 `store.ts` 的 `defaultClassifyFailure` */
export type FailureClassifier = (error: unknown) => IdempotencyFailureKind

/**
 * 观测事件。D12 落地后必须**可审计**：出了重复单据，要能回答
 * 「这次到底重发没有」。默认不发，主会话接上日志即可。
 */
export type IdempotencyEvent =
  /** 调用成功，结果已记入窗口（窗口内同 key 的再次调用会被回放） */
  | { type: 'recorded-success'; key: string; capabilityId: string }
  /** 命中成功记录，直接回放第一次的结果，没有发请求 */
  | { type: 'replay-success'; key: string; capabilityId: string }
  /** 命中 in-doubt 记录，抛回原错误，没有发请求 */
  | { type: 'replay-in-doubt'; key: string; capabilityId: string; error: unknown }
  /** 命中进行中的调用，共享同一个 Promise，没有发第二次请求 */
  | { type: 'join-pending'; key: string; capabilityId: string }
  /** 同 key 不同载荷：拒绝执行并抛错，没有发请求 */
  | { type: 'key-reuse-mismatch'; key: string; capabilityId: string }
  /** 确知没写入 → 释放 key，允许用同一个 requestId 重试 */
  | { type: 'release-not-written'; key: string; capabilityId: string; error: unknown }
  /** 不知道写没写 → 保留 key，TTL 内拒绝重发 */
  | { type: 'retain-in-doubt'; key: string; capabilityId: string; error: unknown }

export type IdempotencyObserver = (event: IdempotencyEvent) => void

export type IdempotencyStoreOptions = {
  /** 去重窗口，默认 `DEFAULT_IDEMPOTENCY_TTL_MS` */
  ttlMs?: number
  /** 注入时钟（测试用），默认 `systemClock` */
  now?: Clock
  /** 失败归类。默认 `defaultClassifyFailure`（保守：不在白名单里的一律算 unknown） */
  classifyFailure?: FailureClassifier
  /** 观测回调。**不要让它抛异常**，它跑在写调用的关键路径上 */
  onEvent?: IdempotencyObserver
}

/** 诊断用计数。`live` 与 `size` 同义，其余按状态拆开 */
export type IdempotencyStats = {
  live: number
  pending: number
  succeeded: number
  inDoubt: number
}
