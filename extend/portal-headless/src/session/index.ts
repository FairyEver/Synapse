/**
 * 会话与基础数据缓存（设计 §2 F4、§3 H5 / H6）。
 *
 * 独立成模块，不依赖 `src/index.ts`：接线由主会话统一做。
 * 唯一的对外耦合是 `./portal-http.ts` —— 它把「按凭据造请求函数」这件事
 * 接到 `src/http/client.ts` 的 `createPortalHttp` 上，原因写在那份文件的开头。
 */

export {
  SessionStore,
  DEFAULT_ABSOLUTE_TTL_MS,
  DEFAULT_IDLE_TTL_MS,
  DEFAULT_MAX_SESSIONS,
} from './store.js'
export type {
  SessionStoreOptions,
  SessionAcquireInput,
  InvalidateUserInput,
  InvalidateTenantInput,
  InvalidateLanguageInput,
  InvalidatePermissionContextInput,
} from './store.js'

export { PortalSession, defaultCredentialIdentity, snapshotCredential } from './session.js'
export type {
  PortalSessionInit,
  PortalSessionHooks,
  SessionDisposeReason,
} from './session.js'

export { BaseDataRegistry, createBaseDataRegistry } from './registry.js'
export { SingleFlight } from './single-flight.js'

export {
  createPortalBaseDataRegistry,
  PORTAL_BASE_DATA_CAPABILITIES,
  PORTAL_BASE_DATA_KEYS,
} from './base-data.js'

export { createPortalRequestFactory } from './portal-http.js'
export type { PortalRequestFactoryConfig } from './portal-http.js'

/** 凭据的权威定义在 src/config.ts，这里只是让 src/session 自成接线闭环 */
export type { PortalCredential, PortalCredentialSnapshot } from '../config.js'

export {
  BaseDataLoadError,
  SessionConfigurationError,
  SessionDisposedError,
  SessionError,
  consoleSessionLogger,
  normalizeSessionKey,
  normalizeSessionLanguage,
  normalizeSessionPermissionContext,
  sessionStorageKey,
} from './types.js'
export type {
  BaseDataCapability,
  BaseDataFailure,
  BaseDataLoadContext,
  PortalRequest,
  PortalRequestContext,
  PortalRequestFactory,
  SessionDescriptor,
  SessionEvictionReason,
  SessionExpiryReason,
  SessionInvalidationReason,
  SessionInvalidationFilter,
  SessionKey,
  SessionKeyInput,
  SessionPermissionContext,
  SessionLogger,
  SessionStoreEvent,
  SessionStoreStats,
  SessionErrorInfo,
} from './types.js'
