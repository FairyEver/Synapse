/**
 * 载荷指纹：把一次写调用的载荷压成一个稳定字符串，用来回答
 * 「同一个 requestId 配的是不是同一份载荷」。
 *
 * 为什么需要它：`requestId` 是调用方（AI 会话）**声明**的"这是同一次调用"。
 * 声明可能是错的——模型把上一次的 requestId 顺手复用了，却改了会议时间。
 * 指纹是 SDK 对这条声明的**校验**，不是键的一部分（区别见 `key.ts` 的 `assertSamePayload`）。
 *
 * 稳定 = 不依赖键顺序、不依赖 `JSON.stringify` 的插入序、不依赖进程（没有时间戳和随机量）。
 * 同一份载荷重复计算结果逐字节一致，跨进程也一致。
 */

import { createHash } from 'node:crypto'

import { PayloadFingerprintError } from './errors.js'

/** 递归深度上限。载荷是请求体，正常不超过个位数层；超了基本是搞错了 */
const MAX_DEPTH = 32

/** 算法前缀写进结果：将来换算法时，旧记录能被认出来而不是静默不匹配 */
const ALGORITHM = 'sha256'

export function fingerprintPayload (payload: unknown): string {
  const canonical = canonicalPayloadString(payload)
  const digest = createHash(ALGORITHM).update(canonical, 'utf8').digest('hex')
  return `${ALGORITHM}:${digest}`
}

/**
 * 载荷的规范化字符串表示（指纹的输入，也直接可用来做断言和排查）。
 *
 * 规则（与 `JSON.stringify` 的语义尽量对齐，因为它最终的归宿就是请求体）：
 * - 对象键排序；值为 `undefined` 的键**跳过**（`{a:1,b:undefined}` 与 `{a:1}` 同形）
 * - 数组里的 `undefined` 记作 `null`（与 `JSON.stringify` 一致）
 * - `Date` 记 ISO 串（与 `JSON.stringify` 一致）
 * - `Map` / `Set` 按序列化后的元素排序，保证与插入序无关（`JSON.stringify` 不管它们，
 *   所以这里用 `{"__map":…}` / `{"__set":…}` 显式标记，避免与普通对象撞形）
 * - `NaN` / `Infinity` / `-0` 沿用 `JSON.stringify` 的结果（`null` / `null` / `0`）
 * - 其它（函数、symbol、类实例、循环引用）→ 抛 `PayloadFingerprintError`
 *
 * 最后一条是刻意的：指纹退化成常量，就会把「两份不同的载荷」判成同一份，
 * 于是 SDK 会把第一次的结果回放给第二次调用——比直接报错危险得多。
 */
export function canonicalPayloadString (payload: unknown): string {
  return encode(payload, 'payload', 0, new Set())
}

function encode (value: unknown, path: string, depth: number, seen: Set<object>): string {
  if (depth > MAX_DEPTH) {
    throw new PayloadFingerprintError(path, `嵌套超过 ${MAX_DEPTH} 层`)
  }

  if (value === null) return 'null'

  switch (typeof value) {
    case 'undefined':
      return 'undefined'
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      // JSON.stringify: NaN/Infinity → null，-0 → 0
      return JSON.stringify(value) ?? 'null'
    case 'bigint':
      return `${value}n`
    case 'string':
      return JSON.stringify(value)
    case 'function':
    case 'symbol':
      throw new PayloadFingerprintError(path, `是 ${typeof value}，没有稳定的序列化形式`)
    default:
      break
  }

  const object = value as object
  if (seen.has(object)) {
    throw new PayloadFingerprintError(path, '是循环引用')
  }

  seen.add(object)
  try {
    if (object instanceof Date) {
      if (Number.isNaN(object.getTime())) {
        throw new PayloadFingerprintError(path, '是 Invalid Date')
      }
      return JSON.stringify(object.toISOString())
    }
    if (Array.isArray(object)) {
      const items = object.map((item, index) =>
        item === undefined ? 'null' : encode(item, `${path}[${index}]`, depth + 1, seen)
      )
      return `[${items.join(',')}]`
    }
    if (object instanceof Map) {
      // 先各自编码再按编码结果排序：与插入序无关
      const pairs = [...object.entries()].map(([k, v]) => [
        encode(k, `${path}<key>`, depth + 1, seen),
        encode(v, `${path}<value>`, depth + 1, seen),
      ] as const)
      const sorted = pairs
        .map(([k, v]) => `[${k},${v}]`)
        .sort()
      return `{"__map":[${sorted.join(',')}]}`
    }
    if (object instanceof Set) {
      const items = [...object].map((item) => encode(item, `${path}<item>`, depth + 1, seen))
      return `{"__set":[${items.sort().join(',')}]}`
    }

    const prototype = Object.getPrototypeOf(object) as unknown
    if (prototype !== Object.prototype && prototype !== null) {
      const name = (object as { constructor?: { name?: string } }).constructor?.name
      throw new PayloadFingerprintError(path, `是 ${name ?? '类'} 的实例，没有稳定的序列化形式`)
    }

    const record = object as Record<string, unknown>
    const entries: string[] = []
    for (const key of Object.keys(record).sort()) {
      const item = record[key]
      // 与 JSON.stringify 一致：跳过 undefined 值的键
      if (item === undefined) continue
      entries.push(`${JSON.stringify(key)}:${encode(item, `${path}.${key}`, depth + 1, seen)}`)
    }
    return `{${entries.join(',')}}`
  } finally {
    // 按路径标记，退栈时要撤销：同一个对象被引用两次（有向无环）不算循环引用
    seen.delete(object)
  }
}
