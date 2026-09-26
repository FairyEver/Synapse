/**
 * 会话与基础数据缓存的公共类型（设计 §2 F4、§3 H5、H6）。
 *
 * 这里的每一条都对着设计文档里的一个事实，不是凭空抽象：
 * - 一次「会话」= 十几到二十几个基础数据请求 + 强绑租户（F4）
 * - 缓存键至少是 (SY 用户, 凭据, tenantId, Accept-Language, 权限上下文)（H5）
 * - 缓存内容不无脑全量，复用 BASE_DATA_REGISTRY 的声明式按需加载（H5）
 * - token 无续期、吊销不通知，401 直接失败，无头下没有登录页可跳（H6）
 * - module-type 算不出就不发，此时后端取该用户全部模块数据权限的并集（D34 / F19）
 */

import { DEFAULT_LANGUAGE, type PortalCredentialSnapshot } from '../config.js'
import type { PortalRequestConfig } from '../http/client.js'

/**
 * 权限上下文的稳定标识。
 *
 * 这里故意收的是调用方计算好的指纹/版本号，而不是权限数组或原始凭据：
 * 权限上下文会进入会话身份比较与事件诊断面，不能把权限正文或 secret 带到那里。
 */
export type SessionPermissionContext = string | number

/** 归一化后的会话键。userId / tenantId 统一成字符串，避免 `1` 与 `'1'` 各建一份缓存。 */
export type SessionKey = {
  userId: string
  tenantId: string
  language: string
  /** 调用方提供的非敏感权限上下文指纹/版本号；省略表示默认上下文。 */
  permissionContext?: string
}

/** 调用方传入的会话键（宽松形态）。 */
export type SessionKeyInput = {
  userId: string | number
  tenantId: string | number
  /** 缺省 zh-CN，与 buildHeaders 的默认值一致 */
  language?: string
  /** 非敏感的权限上下文指纹/版本号；权限变更时应更换它或主动失效旧会话。 */
  permissionContext?: SessionPermissionContext
}

export const DEFAULT_SESSION_LANGUAGE = DEFAULT_LANGUAGE

/**
 * 凭据绑定的请求函数。签名与 `createPortalHttp(config).request` 对齐，
 * 这样会话层既能被测试替身替换，也能直接接 `src/http/client.ts`。
 */
export type PortalRequest = <T = unknown>(config: PortalRequestConfig) => Promise<T>

/**
 * 造一个请求函数所需要的「会话身份」。
 *
 * 凭据与语言都在这里，因为 `buildHeaders` 把它们写进请求头
 * （`tenant-id` / `token` / `Accept-Language`，见 `src/http/headers.ts`），
 * 而这两项都是**按会话**不同的——H5 的缓存键正是 `(用户, 凭据, tenantId, Accept-Language)`。
 * 少传语言就会出现「会话键是 en-US、请求头还是 zh-CN」这种静默错配。
 */
export type PortalRequestContext = {
  credential: PortalCredentialSnapshot
  language: string
  /** 与会话键一致的权限上下文指纹；请求工厂可用它选择对应的认证上下文。 */
  permissionContext?: string
}

/**
 * 按会话身份造一个请求函数。
 *
 * **这是与现有 `src/http` 的关键接缝**：`createPortalHttp(config)` 的凭据是创建时绑定的
 * （见 `src/http/client.ts`，拦截器闭包读 `config.credential`），所以「一个进程服务多个用户」
 * 只能靠「一份会话一个请求函数」实现。见 `./portal-http.ts`。
 */
export type PortalRequestFactory = (context: PortalRequestContext) => PortalRequest

// ---------------------------------------------------------------------------
// 基础数据能力（对齐 BASE_DATA_REGISTRY，app/portal/utils/router/base-data.js:57-104）
// ---------------------------------------------------------------------------

/**
 * 一个基础数据能力的描述。
 *
 * 字段刻意与 BASE_DATA_REGISTRY 一一对应，便于逐项比对：
 * `load` ↔ load、`deps` ↔ deps、`critical` ↔ critical、`label` ↔ debugLabel、
 * `onlySimpleForm` ↔ onlySimpleForm。多出来的只有 `moduleType`（见 D34 / F19）。
 */
export type BaseDataCapability<T = unknown> = {
  /** 能力键，如 'user-basic'。会话内唯一 */
  key: string
  /** 真实加载。失败语义完全由 critical 决定 */
  load: (context: BaseDataLoadContext) => Promise<T>
  /** 依赖的能力键。加载前按依赖拓扑排序，依赖先于本能力完成 */
  deps?: readonly string[]
  /**
   * 对齐 BASE_DATA_REGISTRY.critical：
   * true —— 失败向上抛，整次 acquire/ensure 失败（该会话不可用，会被拆掉）；
   * false/缺省 —— 降级：该能力记为 undefined 并记录失败，其余能力照常可用。
   */
  critical?: boolean
  /** 中文名，给日志用（对齐 debugLabel） */
  label?: string
  /** 对齐 BASE_DATA_REGISTRY.onlySimpleForm：只有「简洁表单」profile 才需要 */
  onlySimpleForm?: boolean
  /**
   * 该能力请求要带的 module-type。缺省用会话级默认（SessionStoreOptions.baseDataModuleType）。
   *
   * 基础数据是「按租户」而不是「按页面」的，浏览器里它们由 init 链路发出、不带页面上下文，
   * 因此默认不传（D34），代价是继承 F19 说的那份更宽的并集范围。
   */
  moduleType?: number
}

/** 加载上下文。给的是「已经绑定好凭据与 module-type 的」请求函数，能力实现不用管这两件事。 */
export type BaseDataLoadContext = {
  key: string
  credential: PortalCredentialSnapshot
  /** 已注入 module-type / capabilityId 的请求函数 */
  request: PortalRequest
  /** 本次加载开始时刻（来自注入的时钟） */
  now: number
  /** 读一个已完成依赖的值；依赖被降级时为 undefined */
  get: (capabilityKey: string) => unknown
  has: (capabilityKey: string) => boolean
  /** 会话自身，供能力读取 key / tenantId 等 */
  session: SessionDescriptor
}

/** 会话的只读描述。`PortalSession` 实现它。 */
export type SessionDescriptor = {
  readonly key: SessionKey
  readonly storeKey: string
  readonly createdAt: number
  readonly lastUsedAt: number
  /** min(创建 + 绝对 TTL, 最近使用 + 空闲 TTL)，取先到者 */
  readonly expiresAt: number
}

/** 一次降级记录。非 critical 能力失败时写入，绝不静默丢。 */
export type BaseDataFailure = {
  key: string
  /** 仅保留可诊断的错误摘要；不携带原始响应、请求配置或凭据。 */
  error: SessionErrorInfo
  at: number
  /** 固定为 false：critical 的失败不会变成记录，而是直接抛 */
  critical: false
}

export type SessionErrorInfo = {
  name: string
  message: string
  code?: number
}

// ---------------------------------------------------------------------------
// 过期 / 淘汰 / 失效
// ---------------------------------------------------------------------------

export type SessionExpiryReason = 'absolute' | 'idle'
export type SessionEvictionReason = 'capacity'
export type SessionInvalidationReason =
  /** 主动失效（用户断开连接等） */
  | 'manual'
  /** 同一会话键换了凭据（token 轮换 / 重新授权） */
  | 'credential-rotated'
  /** critical 基础数据加载失败，会话不可用 */
  | 'critical-failure'
  /** 按 userId 批量失效 */
  | 'user-invalidated'
  /** 按 tenantId 批量失效 */
  | 'tenant-invalidated'
  /** 按 language 批量失效 */
  | 'language-invalidated'
  /** 按权限上下文批量失效 */
  | 'permission-context-invalidated'
  /** 写操作污染了单个基础数据能力 */
  | 'capability-invalidated'

/** 按身份维度筛选会话；空筛选器不允许用于批量失效，清空全部请显式调用 `clear()`。 */
export type SessionInvalidationFilter = {
  userId?: string | number
  tenantId?: string | number
  language?: string
  permissionContext?: SessionPermissionContext
}

/** 淘汰与过期的可观察出口。默认什么都不接也不会静默：降级另有 BaseDataFailure 记录。 */
export type SessionStoreEvent =
  | { type: 'created'; storeKey: string; key: SessionKey; at: number }
  | { type: 'hit'; storeKey: string; key: SessionKey; at: number }
  | { type: 'load'; storeKey: string; key: SessionKey; capabilityKey: string; at: number }
  | { type: 'degraded'; storeKey: string; key: SessionKey; capabilityKey: string; error: SessionErrorInfo; at: number }
  | { type: 'expired'; storeKey: string; key: SessionKey; reason: SessionExpiryReason; at: number }
  | { type: 'evicted'; storeKey: string; key: SessionKey; reason: SessionEvictionReason; at: number }
  | {
      type: 'invalidated'
      storeKey: string
      key: SessionKey
      reason: SessionInvalidationReason
      /** 能力级失效时给出具体 key；整份会话失效时省略。 */
      capabilityKey?: string
      at: number
    }

export type SessionStoreStats = {
  /** 当前存活会话数 */
  sessions: number
  /** 正在初始化（单飞中）的会话数 */
  pending: number
  created: number
  hits: number
  misses: number
  expired: number
  evicted: number
  invalidated: number
  degraded: number
  /** 真实发起过的基础数据加载次数。用于核对 F4 说的那十几次请求没被并发放大 */
  loads: number
}

/** 最小日志接口。默认输出无依赖的结构化记录，设计要求降级「不要静默吞掉」。 */
export type SessionLogger = {
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
}

type SessionLogRecord = {
  scope: 'portal-headless/session'
  level: 'warn' | 'error'
  message: string
  meta?: Record<string, unknown>
}

function writeSessionLog (level: SessionLogRecord['level'], message: string, meta?: Record<string, unknown>): void {
  const record: SessionLogRecord = {
    scope: 'portal-headless/session',
    level,
    message,
    ...(meta === undefined ? {} : { meta }),
  }
  if (typeof process !== 'undefined' && typeof process.stderr?.write === 'function') {
    process.stderr.write(`${JSON.stringify(record)}\n`)
  }
}

/** 保留旧导出名；默认实现改为无外部依赖的结构化日志适配器。 */
export const consoleSessionLogger: SessionLogger = {
  warn: (message, meta) => writeSessionLog('warn', message, meta),
  error: (message, meta) => writeSessionLog('error', message, meta),
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export class SessionError extends Error {
  constructor (message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SessionError'
  }
}

/** 用法/注册配置错误（键缺失、依赖未注册、依赖成环）。是调用方的 bug，不做降级。 */
export class SessionConfigurationError extends SessionError {
  constructor (message: string) {
    super(message)
    this.name = 'SessionConfigurationError'
  }
}

/** 会话已被淘汰/失效，不应再被使用。 */
export class SessionDisposedError extends SessionError {
  readonly reason: SessionInvalidationReason | SessionExpiryReason | SessionEvictionReason
  constructor (reason: SessionDisposedError['reason']) {
    super(`会话已失效（${reason}），请重新 acquire`)
    this.name = 'SessionDisposedError'
    this.reason = reason
  }
}

/** critical 基础数据加载失败。无头下没有登录页可跳，只能明确失败（H6）。 */
export class BaseDataLoadError extends SessionError {
  readonly capabilityKey: string
  readonly critical: boolean
  constructor (capabilityKey: string, critical: boolean, cause: unknown) {
    super(
      `基础数据能力 ${capabilityKey} 加载失败${critical ? '（critical，会话不可用）' : '（已降级）'}`,
      { cause },
    )
    this.name = 'BaseDataLoadError'
    this.capabilityKey = capabilityKey
    this.critical = critical
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 把宽松入参归一化成会话键。租户必须显式给：后端在部分路径会静默选错租户（设计 F26）。 */
export function normalizeSessionKey (input: SessionKeyInput): SessionKey {
  const userId = String(input.userId ?? '').trim()
  if (!userId) {
    throw new SessionConfigurationError('会话键缺少 userId')
  }

  const tenantId = String(input.tenantId ?? '').trim()
  if (!tenantId) {
    throw new SessionConfigurationError('会话键缺少 tenantId（设计 F26：租户必须显式指定，不能靠后端猜）')
  }

  const language = normalizeSessionLanguage(input.language)
  const permissionContext = normalizeSessionPermissionContext(input.permissionContext)
  return {
    userId,
    tenantId,
    language,
    ...(permissionContext === undefined ? {} : { permissionContext }),
  }
}

/** 归一化 Accept-Language；空值与不传保持同一会话。 */
export function normalizeSessionLanguage (input: string | undefined): string {
  return String(input ?? '').trim() || DEFAULT_SESSION_LANGUAGE
}

/** 归一化权限上下文；数字只接受有限值，空字符串表示默认上下文。 */
export function normalizeSessionPermissionContext (
  input: SessionPermissionContext | undefined,
): string | undefined {
  if (input === undefined) {
    return undefined
  }
  if (typeof input === 'number' && !Number.isFinite(input)) {
    throw new SessionConfigurationError('权限上下文必须是有限数字或非空字符串')
  }
  const normalized = String(input).trim()
  return normalized === '' ? undefined : normalized
}

/**
 * 存储键是内部 opaque key。用 JSON 数组而不是分隔符，避免身份字段里出现分隔符时撞键。
 * credential 不放进这个字符串：它由 SessionStore 单独比较并在轮换时淘汰旧会话，
 * 因而 token 原文不会出现在 storeKey 或事件里。
 */
export function sessionStorageKey (key: SessionKey): string {
  return JSON.stringify([
    key.userId,
    key.tenantId,
    key.language,
    key.permissionContext ?? null,
  ])
}
