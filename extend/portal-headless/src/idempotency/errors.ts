/**
 * 写操作短窗口防重（设计 D12）—— 错误类型。
 *
 * 三类错误各对应一个**必须让调用方看见**的判断，不要合并成一个 Error：
 * 调用方（主会话/AI）对它们的处置方式完全不同——重新生成 requestId、
 * 检查参数、还是先去查上一次是否生效。
 */

import { MAX_REQUEST_ID_LENGTH } from './types.js'

/** requestId 缺失、超长或含不安全字符。属于调用方的编码错误，重试没用 */
export class IdempotencyRequestIdError extends Error {
  readonly requestId: unknown

  constructor (requestId: unknown, reason: string) {
    super(
      `requestId ${reason}（实际值：${describe(requestId)}）。` +
      `要求：非空，长度 ≤ ${MAX_REQUEST_ID_LENGTH}，字符集 [A-Za-z0-9._:-]；` +
      '可以用 createRequestId() 生成。新意图必须换新值，同一次意图重试必须复用同一个值。'
    )
    this.name = 'IdempotencyRequestIdError'
    this.requestId = requestId
  }
}

/**
 * 同一个 requestId 配了不同的载荷。
 *
 * 这是**故意的硬失败**：既不发请求，也不覆盖已有记录，更不回放旧结果。
 * 规则与理由见 `key.ts` 的 `assertSamePayload`。
 */
export class IdempotencyKeyReuseError extends Error {
  readonly key: string
  readonly capabilityId: string
  /** 正在被复用的那个 requestId */
  readonly requestId: string

  constructor (init: {
    key: string
    capabilityId: string
    requestId: string
    firstFingerprint: string
    incomingFingerprint: string
  }) {
    super(
      `requestId ${init.requestId} 已用于「${init.capabilityId}」的另一次调用，载荷不同：` +
      `已有 ${short(init.firstFingerprint)}，本次 ${short(init.incomingFingerprint)}。` +
      '本次调用未发出。如果这是**一次新的写意图**，请换一个新的 requestId；' +
      '如果只是想重试上一次，请原样传回同一份载荷。'
    )
    this.name = 'IdempotencyKeyReuseError'
    this.key = init.key
    this.capabilityId = init.capabilityId
    this.requestId = init.requestId
  }
}

/** 载荷无法算指纹（含函数/symbol/类实例/循环引用等）。见 `fingerprint.ts` 的说明与出口 */
export class PayloadFingerprintError extends Error {
  /** 出问题的载荷路径，例如 `payload.room.owner` */
  readonly path: string

  constructor (path: string, detail: string) {
    super(
      `载荷无法计算指纹：${path} ${detail}。` +
      '指纹是"同 key 不同载荷"的判据，不能静默退化成常量。' +
      '请只把可序列化的那部分载荷交给指纹（withIdempotency 的 payload 选项），' +
      '或显式传入 fingerprint 覆盖。'
    )
    this.name = 'PayloadFingerprintError'
    this.path = path
  }
}

/**
 * 标记「这个失败发生在请求发出去之前」。
 *
 * 本地校验、权限预检、参数拼装这类失败，SDK 从异常本身看不出请求有没有发出去，
 * 因此默认一律按 in-doubt 处理（保守，宁可不给重试）。用这个类包一下，
 * 就是在**明确断言**「请求没发」——之后同一个 requestId 可以立刻重试。
 *
 * 典型接法（能力层的本地校验）：
 * ```ts
 * try { payload = buildMeetingApplicationPayload(draft) }
 * catch (error) { throw new NotDispatchedError(error) }
 * ```
 */
export class NotDispatchedError extends Error {
  constructor (cause: unknown, message?: string) {
    super(message ?? `调用在发出请求之前就失败了：${describe(cause)}`, { cause })
    this.name = 'NotDispatchedError'
  }
}

function describe (value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (value instanceof Error) return `${value.name}(${value.message})`
  return String(value)
}

function short (fingerprint: string): string {
  return fingerprint.length > 23 ? `${fingerprint.slice(0, 23)}…` : fingerprint
}
