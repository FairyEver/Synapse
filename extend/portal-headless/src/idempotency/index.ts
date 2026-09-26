/**
 * 写操作短窗口防重（设计 D12）。
 *
 * 独立成模块，不依赖 `src/session/`：身份（租户/用户）由接线方现取后传进来，
 * 接线由主会话统一做（与 `src/invalidation/` 同样的分工）。
 * 唯一的下游依赖是 `src/http/errors.ts` 的两个错误类型——默认的失败归类要认出
 * 「后端明确答复了否定」这一种情形。
 *
 * ⚠️ 这是**短窗口防重**，不是幂等。它做不到什么，逐条列在 `./store.ts` 顶部与 `./README.md`。
 */

export { IdempotencyStore, defaultClassifyFailure } from './store.js'
export type { IdempotentCall } from './store.js'

export {
  DEFAULT_REQUEST_ID_PREFIX,
  assertSamePayload,
  createRequestId,
  idempotencyKey,
  normalizeRequestId,
} from './key.js'

export { canonicalPayloadString, fingerprintPayload } from './fingerprint.js'

export { withIdempotency } from './writer.js'
export type { IdempotentWriteParams, WithIdempotencyInit } from './writer.js'

export {
  IdempotencyKeyReuseError,
  IdempotencyRequestIdError,
  NotDispatchedError,
  PayloadFingerprintError,
} from './errors.js'

export {
  DEFAULT_IDEMPOTENCY_TTL_MS,
  MAX_REQUEST_ID_LENGTH,
  REQUEST_ID_PATTERN,
  systemClock,
} from './types.js'
export type {
  Clock,
  FailureClassifier,
  IdempotencyEvent,
  IdempotencyFailureKind,
  IdempotencyIdentity,
  IdempotencyObserver,
  IdempotencyScope,
  IdempotencyStats,
  IdempotencyStoreOptions,
  IdempotentSendContext,
} from './types.js'
