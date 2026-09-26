/**
 * 查表：给一个写目标，回答"要失效哪些基础数据"。
 *
 * 三条刻意的行为约定：
 *
 * 1. **查不到就返回空数组，绝不"大概齐"给一个 key。** 多失效一次只是多一次请求，
 *    但乱失效会让调用方以为某条链路被覆盖了，从而不再去补真正的规则。
 *    想知道"是没登记还是核查过确认无影响"，用 `isAuditedWriteTarget`。
 * 2. **路径比较是段对齐的**，因为 SDK 会补前缀：`src/http/client.ts:58-61` 给裸路径
 *    补 `/admin-api`，所以前端代码里的 `/sys/dict/data` 和真实请求里的
 *    `/admin-api/sys/dict/data` 必须被认为是同一个接口。
 * 3. **能力 ID 与路径是"或"的关系**，不是"与"。调用方通常只知道其中一个。
 */

import { WRITE_INVALIDATION_RULES } from './rules.js'
import type {
  InvalidationResolution,
  WriteInvalidationRule,
  WriteTarget,
} from './types.js'

/** 去掉 query/hash、统一前导斜杠、去掉末尾斜杠。比较前一律先过一遍 */
export function normalizeEndpointPath (path: string): string {
  const withoutQuery = path.trim().split(/[?#]/)[0] ?? ''
  const withLeading = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`
  const collapsed = withLeading.replace(/\/{2,}/g, '/')
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed
}

function segmentsOf (path: string): string[] {
  return normalizeEndpointPath(path).split('/').filter((segment) => segment !== '')
}

/** `{id}` 这类占位段：一条规则写 `/x/disable/{id}`，调用方传 `/x/disable/123` 都算同一个接口 */
function isPlaceholder (segment: string): boolean {
  return /^\{.*\}$/.test(segment)
}

function segmentMatches (left: string, right: string): boolean {
  return left === right || isPlaceholder(left) || isPlaceholder(right)
}

/**
 * 两个路径是不是同一个接口。
 *
 * 三条规则，按顺序生效：
 * 1. 段数相同 → 逐段比（占位段 `{id}` 通配）；
 * 2. 段数不同 → 允许"段对齐的后缀相等"，用来吸收 `/admin-api` 这类前缀差异；
 * 3. 段数少于 2 的一方不参与后缀匹配——那种匹配几乎必然误伤。
 */
export function sameEndpoint (left: string, right: string): boolean {
  const a = segmentsOf(left)
  const b = segmentsOf(right)

  if (a.length === b.length) {
    return a.length > 0 && a.every((segment, index) => segmentMatches(segment, b[index] ?? ''))
  }

  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  if (shorter.length < 2) {
    return false
  }
  const tail = longer.slice(longer.length - shorter.length)
  return tail.every((segment, index) => segmentMatches(segment, shorter[index] ?? ''))
}

function methodMatches (ruleMethod: string | undefined, targetMethod: string | undefined): boolean {
  if (ruleMethod === undefined) {
    return true
  }
  // 调用方没给方法时不当作不匹配：同一个路径上不同方法的写，要失效的 key 通常一样，
  // 这种情况下宁可多失效也不要不失效。
  if (targetMethod === undefined || targetMethod.trim() === '') {
    return true
  }
  return ruleMethod.toUpperCase() === targetMethod.trim().toUpperCase()
}

/** 命中的规则，按声明顺序。空数组 = 没核查过这个写目标 */
export function matchingRules (target: WriteTarget): WriteInvalidationRule[] {
  const capabilityId = typeof target?.capabilityId === 'string' ? target.capabilityId.trim() : ''
  const path = typeof target?.path === 'string' ? target.path.trim() : ''
  if (capabilityId === '' && path === '') {
    return []
  }

  const matched = WRITE_INVALIDATION_RULES.filter((rule) => {
    if (capabilityId !== '' && (rule.capabilityIds ?? []).includes(capabilityId)) {
      return true
    }
    if (path === '') {
      return false
    }
    return (rule.endpoints ?? []).some(
      (endpoint) => methodMatches(endpoint.method, target.method) && sameEndpoint(endpoint.path, path),
    )
  })

  return matched
}

function uniqueKeys (rules: readonly WriteInvalidationRule[]): string[] {
  const keys: string[] = []
  for (const rule of rules) {
    for (const key of rule.keys) {
      if (!keys.includes(key)) {
        keys.push(key)
      }
    }
  }
  return keys
}

/**
 * 这个写目标核查过吗。
 *
 * `keys` 为空的规则也算"核查过"——它表达的是"查过了，确认不影响任何基础数据"，
 * 与"从来没登记过"是两回事。调用方（尤其是给 AI 看的诊断输出）用这个区分
 * "没有影响"和"我们不知道有没有影响"。
 */
export function isAuditedWriteTarget (target: WriteTarget): boolean {
  return matchingRules(target).length > 0
}

/**
 * 解析一个写目标：命中的规则、确定项、推测项、并集。
 *
 * 默认把推测项也算进去（`inferredKeys`），因为漏失效的代价是**用户/AI 看到旧数据**，
 * 而多失效的代价只是下一次 ensure 多一个请求。要只看确定项就单用 `confirmedKeys`。
 */
export function resolveInvalidation (target: WriteTarget): InvalidationResolution {
  const rules = matchingRules(target)
  const confirmed = rules.filter((rule) => rule.confidence === 'confirmed')
  const inferred = rules.filter((rule) => rule.confidence === 'inferred')

  const confirmedKeys = uniqueKeys(confirmed)
  const inferredKeys = uniqueKeys(inferred).filter((key) => !confirmedKeys.includes(key))

  return {
    target,
    rules,
    confirmedKeys,
    inferredKeys,
    keys: [...confirmedKeys, ...inferredKeys],
    audited: rules.length > 0,
  }
}

/**
 * 这个写目标要失效哪些基础数据 key（确定项在前，推测项在后，去重）。
 * 未登记的写目标返回 `[]`。
 */
export function invalidationKeysFor (
  target: WriteTarget,
  options: { includeInferred?: boolean } = {},
): string[] {
  const resolution = resolveInvalidation(target)
  return options.includeInferred === false
    ? [...resolution.confirmedKeys]
    : [...resolution.keys]
}

/** 只取有直接代码证据的确定项 */
export function confirmedInvalidationKeysFor (target: WriteTarget): string[] {
  return [...resolveInvalidation(target).confirmedKeys]
}

/** 只取推测项（前端没有观察到重取的那些） */
export function inferredInvalidationKeysFor (target: WriteTarget): string[] {
  return [...resolveInvalidation(target).inferredKeys]
}
