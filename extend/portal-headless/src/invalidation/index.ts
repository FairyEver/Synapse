/**
 * 写操作 → 基础数据失效（设计 §3 H5、决策 D4）。
 *
 * 独立成模块，与 `src/session/` 不互相依赖：这里只**读**会话的
 * `invalidate(capabilityKey)`，失效本身仍然归会话实现。接线由主会话统一做。
 */

export { ORG_TREE_KEY, WRITE_INVALIDATION_RULES } from './rules.js'

export {
  confirmedInvalidationKeysFor,
  inferredInvalidationKeysFor,
  invalidationKeysFor,
  isAuditedWriteTarget,
  matchingRules,
  normalizeEndpointPath,
  resolveInvalidation,
  sameEndpoint,
} from './lookup.js'

export { applyInvalidation } from './apply.js'
export type {
  AppliedInvalidation,
  ApplyInvalidationOptions,
  InvalidationSink,
} from './apply.js'

export type {
  EndpointMatcher,
  InvalidationConfidence,
  InvalidationEvidence,
  InvalidationResolution,
  WriteInvalidationRule,
  WriteTarget,
} from './types.js'
