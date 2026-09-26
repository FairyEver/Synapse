/**
 * 把查表结果接到会话上：写操作成功后一行调用。
 *
 * ```ts
 * const { session } = await portal.forSession({ userId, credential })
 * await session.ensure(['dict-hr'])
 * await portal.call(PAGE, { url: '/sys/dict/data', method: 'post', data: form })
 * applyInvalidation(session, { path: '/sys/dict/data', method: 'POST' })
 * ```
 *
 * **失败语义**：这个函数不抛错，也不做任何重取——它只把脏掉的 key 从会话里丢掉，
 * 下次 `ensure()` 自然会重新拉（`PortalSession.invalidate` 的语义，
 * `src/session/session.ts:200-206`）。写操作本身已经成功了，这里再抛错只会让调用方
 * 误以为写失败。真正的重取失败由 `ensure()` 按原有的 critical / 降级规则处理。
 *
 * **为什么不在写操作前失效**：失效只影响"下一次读"，提前失效不会更正确，
 * 但如果写失败了就会白丢一次缓存。写在成功后调用最省。
 */

import { resolveInvalidation } from './lookup.js'
import type { WriteTarget } from './types.js'

/**
 * 能承接失效的最小接口。`PortalSession`（`src/session/session.ts:200`）天然满足，
 * 因为它本来就有 `invalidate(capabilityKey): boolean`。
 * 只拿到 `SessionStore` 的调用方可以包一层：
 * `{ invalidate: (key) => store.invalidateCapability({ userId, tenantId }, key) }`。
 */
export type InvalidationSink = {
  invalidate: (capabilityKey: string) => boolean
}

export type ApplyInvalidationOptions = {
  /** 是否连"推测"的 key 一起失效。默认 true：漏失效的代价比多一次请求大得多 */
  includeInferred?: boolean
}

export type AppliedInvalidation = {
  target: WriteTarget
  /** 命中的规则 id，写日志时用得上 */
  rules: string[]
  /** 判定要失效的 key（按选项可能只含确定项） */
  keys: string[]
  /** 其中来自推测规则的 key，单独列出来便于观察"是不是老靠推测兜底" */
  inferredKeys: string[]
  /** 真的从会话里删掉的 */
  invalidated: string[]
  /** 判定要失效、但会话里本来就没有的（说明当时没加载过，之后照常拉） */
  absent: string[]
}

/**
 * 按写目标失效会话里的基础数据。返回发生了什么，便于调用方记日志。
 * 未登记的写目标：什么都不做，返回全空的结果——不猜。
 */
export function applyInvalidation (
  session: InvalidationSink,
  target: WriteTarget,
  options: ApplyInvalidationOptions = {},
): AppliedInvalidation {
  const resolution = resolveInvalidation(target)
  const includeInferred = options.includeInferred !== false

  const keys = includeInferred
    ? [...resolution.keys]
    : [...resolution.confirmedKeys]
  const inferredKeys = includeInferred
    ? [...resolution.inferredKeys]
    : []

  const invalidated: string[] = []
  const absent: string[] = []
  for (const key of keys) {
    if (session.invalidate(key)) {
      invalidated.push(key)
    } else {
      absent.push(key)
    }
  }

  return {
    target,
    rules: resolution.rules.map((rule) => rule.id),
    keys,
    inferredKeys,
    invalidated,
    absent,
  }
}
