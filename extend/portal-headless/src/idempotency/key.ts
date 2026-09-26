/**
 * 幂等键：组成、校验、以及「同 key 不同载荷」这条规则的家。
 *
 * ## 键的组成
 *
 * `namespace | tenantId | userId | capabilityId | target | requestId`
 * （空的部分留空串，各段用 `|` 连接且逐段 `encodeURIComponent`，因此不会撞键）。
 *
 * 前四段是**隔离**，最后一段是**身份**：
 * - `namespace` / `tenantId` / `userId`：把不同接入方、不同租户、不同用户隔开。
 *   `requestId` 是 AI 会话给的，两个用户撞上同一个值完全可能；不隔离就会出现
 *   「用户 B 的写调用拿到用户 A 的缓存结果」——既是错，也是越权。
 * - `capabilityId` + `target`：把不同的写操作、不同的目标对象隔开。
 *   同一个 `requestId` 用在「提交」和「撤销」上显然不是同一次调用。
 * - `requestId`：调用方声明的调用身份。
 *
 * 这套分段与 BPM 已有的客户端幂等范式同构：那边唯一索引是
 * `(tenant_id, process_instance_id, creator, client_request_id)`，
 * 即 **租户 + 业务对象 + 用户 + 客户端请求编号**（见 erp-module-bpm 的
 * `2026-07-22-流程跟进与短信提醒.sql` 与 `BpmProcessFollowUpServiceImpl`）。
 * 将来推动后端补幂等时，是同一套语言，不用换概念。
 *
 * ## 同 key 不同载荷：抛错，既不发也不回放
 *
 * 指纹**不进键**，只在校验时比对。这是刻意的，两个方向都有理由：
 *
 * 1. **为什么不做成键的一部分**（载荷不同 = 不同键 = 各跑各的）：
 *    那样一次**真正的重试**只要载荷有一个无关字段变了（时间戳重新生成、
 *    参数重新序列化、`_t` 防缓存参数）就会静默地再写一次——正是我们要防的重复单据。
 *    而且它会掩盖调用方的键复用 bug，让"同一次调用"这个声明永远得不到校验。
 *    声明要**验证**，不能**重写**。
 * 2. **为什么不学 BPM 后端那样"以请求号为准，回放第一次的结果"**：
 *    后端那边载荷只是一个 `content` 文本域，宽松一点代价可控。SDK 这边载荷是整张单据，
 *    回放旧结果等于告诉 AI「你新填的这场会已经订好了」——而它根本没订。
 *    宁可抛错：新的写意图请换新 requestId，重试请原样传回同一份载荷。
 *
 * 于是规则是：命中记录时若指纹不同，抛 `IdempotencyKeyReuseError`，
 * 不发请求、不覆盖记录、不回放结果。
 */

import { randomUUID } from 'node:crypto'

import { IdempotencyKeyReuseError, IdempotencyRequestIdError } from './errors.js'
import {
  MAX_REQUEST_ID_LENGTH,
  REQUEST_ID_PATTERN,
  type IdempotencyScope,
} from './types.js'

/** 段分隔符。逐段 `encodeURIComponent` 后它不会出现在段内，因此不会撞键 */
const SEPARATOR = '|'

/** 默认 requestId 前缀。唯一目的是让日志里能一眼认出这是幂等键 */
export const DEFAULT_REQUEST_ID_PREFIX = 'req'

/**
 * 校验并归一化 requestId，返回 trim 后的值。
 *
 * 规格与 BPM 的 `client_request_id VARCHAR(64)` 对齐（长度 ≤ 64、字符集受限），
 * 这样同一个值将来可以原样落进后端的幂等列。
 */
export function normalizeRequestId (requestId: unknown): string {
  if (typeof requestId !== 'string') {
    throw new IdempotencyRequestIdError(requestId, '必须是字符串')
  }
  const normalized = requestId.trim()
  if (normalized === '') {
    throw new IdempotencyRequestIdError(requestId, '不能为空')
  }
  if (normalized.length > MAX_REQUEST_ID_LENGTH) {
    throw new IdempotencyRequestIdError(
      requestId,
      `超过 ${MAX_REQUEST_ID_LENGTH} 个字符（实际 ${normalized.length} 个）`
    )
  }
  if (!REQUEST_ID_PATTERN.test(normalized)) {
    throw new IdempotencyRequestIdError(requestId, '含有不允许的字符')
  }
  return normalized
}

/**
 * 生成一个 requestId：`<prefix>_<uuid>`。
 *
 * 调用方（AI 会话）自己编的值经常是 `1`、`a`、`test` 这类——短、容易撞。
 * 用这个函数生成，撞键概率可忽略，且满足后端列的规格。
 *
 * **同一次意图重试时必须复用同一个值**，不要每次重试都新生成：
 * 新生成就等于新意图，防重也就失效了。
 */
export function createRequestId (prefix: string = DEFAULT_REQUEST_ID_PREFIX): string {
  if (!REQUEST_ID_PATTERN.test(prefix)) {
    throw new IdempotencyRequestIdError(prefix, '作为前缀含有不允许的字符')
  }
  return normalizeRequestId(`${prefix}_${randomUUID()}`)
}

/** 算幂等键。scope.requestId 会先按 `normalizeRequestId` 校验 */
export function idempotencyKey (scope: IdempotencyScope): string {
  const requestId = normalizeRequestId(scope.requestId)
  const capabilityId = String(scope.capabilityId ?? '').trim()
  if (capabilityId === '') {
    throw new Error('idempotencyKey 需要 capabilityId：写能力 ID 是键的一部分，缺了会把不同写操作混成一个')
  }
  return [
    segment(scope.namespace),
    segment(scope.tenantId),
    segment(scope.userId),
    segment(capabilityId),
    segment(scope.target),
    requestId,
  ].join(SEPARATOR)
}

/**
 * 「同 key 不同载荷」的规则（理由见本文件顶部）。
 *
 * 命中记录时调用；指纹一致就返回，不一致就抛 `IdempotencyKeyReuseError`。
 */
export function assertSamePayload (init: {
  key: string
  capabilityId: string
  requestId: string
  /** 记录里存的指纹 */
  stored: string
  /** 本次调用的指纹 */
  incoming: string
}): void {
  if (init.stored === init.incoming) {
    return
  }
  throw new IdempotencyKeyReuseError({
    key: init.key,
    capabilityId: init.capabilityId,
    requestId: init.requestId,
    firstFingerprint: init.stored,
    incomingFingerprint: init.incoming,
  })
}

/** 缺省部分留空串；`encodeURIComponent` 保证段内不会出现分隔符 */
function segment (value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  return encodeURIComponent(String(value))
}
