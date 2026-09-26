/**
 * 一份会话：一个 (用户, 租户, 语言) 组合 + 它那份凭据 + 它那一套基础数据。
 *
 * 它是 H5 `(用户, 凭据, tenantId, language)` 那个缓存键的落点，
 * 也是 F4 说的「18 个 store」在 SDK 侧的最小替代：不缓存整个 store，
 * 只缓存「被声明过、被请求过」的能力（BASE_DATA_REGISTRY 的思路）。
 *
 * 单飞落在这里而不是 Store 里：Store 只能合并「同一个会话键的并发 acquire」，
 * 而两个并发调用完全可能请求**不同**的能力集合（一个有重叠），
 * 那也必须是同一个 Promise，否则 F4 的十几次请求照样翻倍。
 */

import type { PortalCredential, PortalCredentialSnapshot } from '../config.js'
import type { PortalRequestConfig } from '../http/client.js'
import { PortalCredentialError, isCredentialFailureCode } from '../http/errors.js'
import { BaseDataRegistry } from './registry.js'
import { SingleFlight } from './single-flight.js'
import {
  BaseDataLoadError,
  SessionConfigurationError,
  SessionDisposedError,
  type BaseDataCapability,
  type BaseDataFailure,
  type BaseDataLoadContext,
  type PortalRequest,
  type SessionDescriptor,
  type SessionErrorInfo,
  type SessionEvictionReason,
  type SessionExpiryReason,
  type SessionInvalidationReason,
  type SessionKey,
} from './types.js'

export type SessionDisposeReason =
  | SessionInvalidationReason
  | SessionExpiryReason
  | SessionEvictionReason

export type PortalSessionHooks = {
  /** 一次真实的基础数据加载即将发起（用于统计「真发了几个请求」） */
  onLoad?: (session: PortalSession, capabilityKey: string) => void
  /** 一个非 critical 能力降级了 */
  onDegraded?: (session: PortalSession, failure: BaseDataFailure) => void
  /** 会话被实际使用时通知 Store 更新 LRU 顺序 */
  onUse?: (session: PortalSession, at: number) => void
  /** 能力级失效完成后通知 Store 发出可观察事件 */
  onCapabilityInvalidated?: (session: PortalSession, capabilityKey: string) => void
}

export type PortalSessionInit = {
  key: SessionKey
  storeKey: string
  credential: PortalCredentialSnapshot
  /**
   * 凭据身份（H5 要求缓存键里含凭据的那一位）。
   *
   * 它**不进存储键字符串**，而是拿来做「同键换凭据」的比较：
   * 若把它拼进键里，一次 token 轮换就会留下一份到 TTL 才死的僵尸会话；
   * 做成比较则效果等价——换了凭据就整份作废重建（见 store.ts 的 credentialFingerprint）。
   */
  credentialIdentity: string
  /** 已绑定这份凭据的请求函数 */
  request: PortalRequest
  registry: BaseDataRegistry
  /** 绝对过期：不管用不用，到点就废 */
  absoluteTtlMs: number
  /** 空闲过期：多久没用就废 */
  idleTtlMs: number
  /** 基础数据请求默认带的 module-type；不传则不带（设计 D34） */
  baseDataModuleType?: number
  now: () => number
  hooks?: PortalSessionHooks
}

/**
 * 在会话边界复制并冻结凭据。
 *
 * PortalRequestFactory 会把这份对象闭包绑定到请求函数；如果直接保存调用方传入的
 * 可变对象，调用方原地轮换 token 后，旧会话的请求头会悄悄变成新 token，但缓存身份、
 * 已加载数据和诊断信息仍属于旧 token。会话必须绑定创建时的快照。
 */
export function snapshotCredential (credential: PortalCredential): PortalCredentialSnapshot {
  return Object.freeze({
    token: credential.token,
    tenantId: credential.tenantId,
  })
}

export class PortalSession implements SessionDescriptor {
  readonly key: SessionKey
  readonly storeKey: string
  readonly credential: PortalCredentialSnapshot
  readonly credentialIdentity: string
  readonly createdAt: number
  /** 凭据绑定、同时受会话生命周期保护的请求函数。会话外想复用这份凭据，也应该走它，别自己造 */
  readonly request: PortalRequest
  readonly registry: BaseDataRegistry

  private readonly absoluteTtlMs: number
  private readonly idleTtlMs: number
  private readonly baseDataModuleType: number | undefined
  private readonly now: () => number
  private readonly hooks: PortalSessionHooks

  private readonly values = new Map<string, unknown>()
  private readonly failures = new Map<string, BaseDataFailure>()
  /** 与这份会话绑定的可复用能力实例（例如菜单树索引），会话失效时一并丢弃。 */
  private readonly scopedValues = new Map<string, unknown>()
  /** scoped 能力声明自己受哪些基础数据键影响，避免一次写入刷新无关索引。 */
  private readonly scopedInvalidationKeys = new Map<string, ReadonlySet<string>>()
  private readonly flight = new SingleFlight<void>()
  /** 每次失效自增。加载完成后代不匹配就说明「加载期间被失效了」，结果必须丢弃 */
  private readonly generations = new Map<string, number>()

  private usedAt: number
  private disposeReason: SessionDisposeReason | null = null

  constructor (init: PortalSessionInit) {
    this.key = init.key
    this.storeKey = init.storeKey
    this.credential = snapshotCredential(init.credential)
    this.credentialIdentity = init.credentialIdentity
    this.registry = init.registry
    this.createdAt = init.now()
    this.usedAt = this.createdAt
    this.absoluteTtlMs = init.absoluteTtlMs
    this.idleTtlMs = init.idleTtlMs
    this.baseDataModuleType = init.baseDataModuleType
    this.now = init.now
    this.hooks = init.hooks ?? {}
    this.request = async <T = unknown>(config: PortalRequestConfig): Promise<T> => {
      this.assertUsable()
      this.touch()
      return init.request<T>(config)
    }
  }

  get lastUsedAt (): number {
    return this.usedAt
  }

  /** 绝对过期与空闲过期取先到者（H5 的建议：两者都设） */
  get expiresAt (): number {
    return Math.min(
      this.createdAt + this.absoluteTtlMs,
      this.usedAt + this.idleTtlMs,
    )
  }

  get isDisposed (): boolean {
    return this.disposeReason !== null
  }

  /** 到点的原因。两个都到点时报 'absolute'——它是更硬的那个界限 */
  expiryReason (at: number = this.now()): SessionExpiryReason | null {
    if (at >= this.createdAt + this.absoluteTtlMs) {
      return 'absolute'
    }
    if (at >= this.usedAt + this.idleTtlMs) {
      return 'idle'
    }
    return null
  }

  /** 记一次使用。时间只前进不后退，避免注入的时钟抖动把空闲窗口推长 */
  touch (at: number = this.now()): void {
    this.assertUsable()
    if (at > this.usedAt) {
      this.usedAt = at
    }
    this.hooks.onUse?.(this, at)
  }

  has (capabilityKey: string): boolean {
    this.assertUsable()
    return this.values.has(capabilityKey)
  }

  get (capabilityKey: string): unknown {
    this.assertUsable()
    return this.values.get(capabilityKey)
  }

  /** 当前已加载的能力值快照 */
  baseData (): Readonly<Record<string, unknown>> {
    this.assertUsable()
    return Object.fromEntries(this.values)
  }

  loadedKeys (): string[] {
    this.assertUsable()
    return [...this.values.keys()]
  }

  /** 降级记录。空数组代表没有降级过 */
  failureList (): BaseDataFailure[] {
    this.assertUsable()
    return [...this.failures.values()]
  }

  /**
   * 复用一个会话级的有状态能力实例。
   *
   * `SessionStore` 只负责复用 PortalSession；如果每次 `forSession()` 都重新创建
   * 菜单树、租户等带本地缓存的能力，实例自己的 single-flight 会被拆开，跨门面并发
   * 仍会重复请求。实例跟会话一起保存，凭据轮换/淘汰时由 dispose 清掉。
   */
  getOrCreateScoped<T> (
    key: string,
    create: () => T,
    invalidationKeys: readonly string[] = [],
  ): T {
    this.assertUsable()
    if (this.scopedValues.has(key)) {
      const watchedKeys = new Set(this.scopedInvalidationKeys.get(key) ?? [])
      for (const invalidationKey of invalidationKeys) {
        watchedKeys.add(invalidationKey)
      }
      this.scopedInvalidationKeys.set(key, watchedKeys)
      return this.scopedValues.get(key) as T
    }
    const value = create()
    this.scopedValues.set(key, value)
    this.scopedInvalidationKeys.set(key, new Set(invalidationKeys))
    return value
  }

  isLoading (capabilityKey: string): boolean {
    return this.flight.has(this.flightKey(capabilityKey))
  }

  /**
   * 按需加载一批能力（含依赖闭包）。已经加载过的直接跳过。
   *
   * 失败语义：
   * - critical 能力失败 → 抛 BaseDataLoadError，整次 ensure 失败（调用方应把会话拆掉重来）；
   * - 非 critical 能力失败 → 记入 failureList 并回调 onDegraded，其余能力照常可用；
   * - 依赖未注册 / 依赖成环 → 抛 SessionConfigurationError（接线 bug，不降级）。
   */
  async ensure (requestedKeys: readonly string[] = []): Promise<void> {
    this.assertUsable()
    if (requestedKeys.length === 0) {
      this.touch()
      return
    }

    const ordered = this.registry.resolve(requestedKeys)
    for (const capability of ordered) {
      await this.loadCapability(capability)
    }

    this.assertUsable()
    this.touch()
  }

  /**
   * 丢掉单个能力（写操作污染缓存时用）。下次 ensure 会重新拉。
   *
   * 注意：正在飞的那次请求不会被取消（HTTP 层没有 AbortController 接线），
   * 但它返回后不会再写进缓存——靠的是 generations 代际检查。
   */
  invalidate (capabilityKey: string): boolean {
    const invalidationKeys = this.invalidationKeysFor(capabilityKey)
    let invalidated = false

    for (const key of invalidationKeys) {
      const hadValue = this.values.delete(key)
      const hadInflight = this.flight.forget(this.flightKey(key))
      this.failures.delete(key)
      this.bumpGeneration(key)
      const keyInvalidated = hadValue || hadInflight
      invalidated ||= keyInvalidated
      if (keyInvalidated) {
        this.hooks.onCapabilityInvalidated?.(this, key)
      }
    }

    // scoped 能力可能只把索引缓存留在自身（例如没有预加载 session 基础数据时），
    // 所以即使 values 中没有对应 key，也必须通知受影响的 scoped 对象。
    // 不清除对象本身，避免已经发给调用方的门面引用失效；调用其公开 invalidate()。
    this.invalidateScopedValues(invalidationKeys)
    return invalidated
  }

  /** 一次性失效多个能力；重复 key 只处理一次，返回真的从缓存/在途请求中清掉的 key。 */
  invalidateCapabilities (capabilityKeys: readonly string[]): string[] {
    const invalidated: string[] = []
    const seen = new Set<string>()
    for (const capabilityKey of capabilityKeys) {
      if (seen.has(capabilityKey)) {
        continue
      }
      seen.add(capabilityKey)
      if (this.invalidate(capabilityKey)) {
        invalidated.push(capabilityKey)
      }
    }
    return invalidated
  }

  /** 会话作废。清掉缓存与降级记录，之后任何 ensure 都会抛 SessionDisposedError */
  dispose (reason: SessionDisposeReason): void {
    if (this.disposeReason !== null) {
      return
    }
    this.disposeReason = reason
    this.invalidateScopedValues()
    this.values.clear()
    this.failures.clear()
    this.scopedValues.clear()
    this.scopedInvalidationKeys.clear()
    this.flight.clear()
  }

  private assertUsable (): void {
    if (this.disposeReason !== null) {
      throw new SessionDisposedError(this.disposeReason)
    }
    const expiry = this.expiryReason()
    if (expiry !== null) {
      throw new SessionDisposedError(expiry)
    }
  }

  private generationOf (capabilityKey: string): number {
    return this.generations.get(capabilityKey) ?? 0
  }

  private bumpGeneration (capabilityKey: string): void {
    this.generations.set(capabilityKey, this.generationOf(capabilityKey) + 1)
  }

  /** 返回目标能力及依赖它的所有已注册能力，按稳定注册顺序去重。 */
  private invalidationKeysFor (capabilityKey: string): string[] {
    const keys = [capabilityKey]
    const seen = new Set(keys)
    let changed = true

    while (changed) {
      changed = false
      for (const capability of this.registry.list()) {
        if (seen.has(capability.key)) {
          continue
        }
        if ((capability.deps ?? []).some((dependency) => seen.has(dependency))) {
          seen.add(capability.key)
          keys.push(capability.key)
          changed = true
        }
      }
    }

    return keys
  }

  private invalidateScopedValues (capabilityKeys?: readonly string[]): void {
    for (const [key, value] of this.scopedValues.entries()) {
      const watchedKeys = this.scopedInvalidationKeys.get(key)
      if (capabilityKeys !== undefined && watchedKeys && watchedKeys.size > 0 && !capabilityKeys.some((item) => watchedKeys.has(item))) {
        continue
      }
      const invalidate = (value as { invalidate?: unknown } | null | undefined)?.invalidate
      if (typeof invalidate === 'function') {
        invalidate.call(value)
      }
    }
  }

  private flightKey (capabilityKey: string): string {
    return `${capabilityKey}\u0000${this.generationOf(capabilityKey)}`
  }

  /**
   * 单飞的入口。同一个能力键在同一时刻只会真正跑一次 load，
   * 不管有多少个并发 ensure 请求它（含被别的能力当依赖请求的情况）。
   */
  private loadCapability (capability: BaseDataCapability): Promise<void> {
    this.assertUsable()
    if (this.values.has(capability.key)) {
      return Promise.resolve()
    }
    const generation = this.generationOf(capability.key)
    return this.flight.run(this.flightKey(capability.key), () => this.runLoad(capability, generation))
  }

  private async runLoad (capability: BaseDataCapability, generation: number): Promise<void> {
    try {
      await this.loadDependencies(capability)
      this.hooks.onLoad?.(this, capability.key)

      const value = await capability.load(this.createLoadContext(capability))

      if (this.isDisposed || generation !== this.generationOf(capability.key) || this.expiryReason() !== null) {
        // 加载期间被失效/淘汰：结果已经过期，不能写回（写回等于把刚清掉的缓存又填上）
        return
      }

      this.values.set(capability.key, value)
      this.failures.delete(capability.key)
    } catch (error) {
      // 失效/淘汰期间完成的旧请求不能再把失败记录写回新会话状态；调用方随后
      // 会由 ensure 的 assertUsable 收到 SessionDisposedError。成功路径和失败路径
      // 必须使用同一条代际检查，否则旧请求仍会污染 failureList。
      if (this.isDisposed || generation !== this.generationOf(capability.key) || this.expiryReason() !== null) {
        return
      }

      // 凭据失效不是「某个能力坏了」，而是**整份会话都不可用**（设计 H6）：
      // token 没有续期流程、吊销也不通知，401 之后同一个 token 的其它能力一样会失败。
      // 所以不管这个能力是不是 critical，都要向上抛、让 store 把会话拆掉，
      // 而不是降级继续用一份注定失败的基础数据。
      if (capability.critical === true || isCredentialFailure(error)) {
        throw new BaseDataLoadError(capability.key, true, error)
      }

      const failure: BaseDataFailure = {
        key: capability.key,
        error: summarizeSessionError(error),
        at: this.now(),
        critical: false,
      }
      this.failures.set(capability.key, failure)
      this.hooks.onDegraded?.(this, failure)
    }
  }

  private async loadDependencies (capability: BaseDataCapability): Promise<void> {
    for (const dependencyKey of capability.deps ?? []) {
      const dependency = this.registry.get(dependencyKey)
      if (!dependency) {
        throw new SessionConfigurationError(
          `基础数据能力 ${capability.key} 依赖的能力未注册：${dependencyKey}`,
        )
      }

      await this.loadCapability(dependency)

      if (capability.critical === true && this.failures.has(dependencyKey)) {
        // 依赖降级了却还要跑 critical 能力，只会产出一份看着像成功、其实缺数据的会话。
        // 宁可在这里失败（H6：无头下没有登录页可跳，那就明确失败）。
        throw new Error(
          `依赖 ${dependencyKey} 已降级，critical 能力 ${capability.key} 不再继续`,
        )
      }
    }
  }

  private createLoadContext (capability: BaseDataCapability): BaseDataLoadContext {
    const moduleType = capability.moduleType ?? this.baseDataModuleType

    const request: PortalRequest = <T = unknown>(config: PortalRequestConfig): Promise<T> => {
      const withModuleType = config.moduleType !== undefined || moduleType === undefined
        ? config
        : { ...config, moduleType }

      return this.request<T>({
        ...withModuleType,
        capabilityId: config.capabilityId ?? `base-data:${capability.key}`,
      })
    }

    return {
      key: capability.key,
      credential: this.credential,
      request,
      now: this.now(),
      get: (capabilityKey) => this.values.get(capabilityKey),
      has: (capabilityKey) => this.values.has(capabilityKey),
      session: this,
    }
  }
}

/**
 * 这个错误是不是「凭据不可用」。
 *
 * 两种来源都要认：SDK 自己抛的 `PortalCredentialError`（`src/http/client.ts` 在
 * `ret !== 'SUCCESS'` 且 code 命中 `AUTH_FAILURE_CODES` 时抛），
 * 以及任何带同样 code 的错误（例如上游把包络拆开抛出来的）。
 */
export function isCredentialFailure (error: unknown): boolean {
  if (error instanceof PortalCredentialError) {
    return true
  }
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === 'number' && isCredentialFailureCode(code)
}

/**
 * 供 failureList / degraded event 使用的安全错误摘要。
 *
 * 不复制 Error 的 responseData、config、cause 等扩展对象；消息里的常见凭据字段
 * 也做脱敏。原始错误仍作为普通调用的异常向上抛出，但不进入会话诊断面。
 */
export function summarizeSessionError (error: unknown): SessionErrorInfo {
  const record = error !== null && typeof error === 'object'
    ? error as { name?: unknown; message?: unknown; code?: unknown }
    : undefined
  const rawMessage = error instanceof Error
    ? error.message
    : typeof record?.message === 'string'
      ? record.message
      : String(error)
  const code = typeof record?.code === 'number' ? record.code : undefined
  return {
    name: redactSensitiveText(
      typeof record?.name === 'string' && record.name !== ''
        ? record.name
        : 'Error',
    ),
    message: redactSensitiveText(rawMessage),
    ...(code === undefined ? {} : { code }),
  }
}

function redactSensitiveText (value: string): string {
  return value
    .replace(/\b(authorization|cookie|access[_-]?token|token|password\w*|salt|secret\w*)\b\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
    .replace(/\bauthorization\s+bearer\s+[^\s,;]+/gi, 'authorization bearer <redacted>')
    .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, '<redacted>')
}

/**
 * 默认的凭据身份：token 是凭据的主体，tenantId 只决定「这份会话属于哪个租户」，
 * 而租户本身已经进了会话键。
 *
 * 比 token 字符串而不是比对象引用是有意的——调用方每次 acquire 都会新建一个对象字面量。
 * 想让 token 不以原文参与比较的，可以给 Store 传 `credentialFingerprint`（例如 sha256）。
 */
export function defaultCredentialIdentity (credential: PortalCredential): string {
  return `${String(credential.tenantId ?? '')}\u0000${credential.token ?? ''}`
}
