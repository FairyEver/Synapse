/**
 * 会话仓库：一个进程里同时服务多个 Portal 用户。
 *
 * 对应设计 H5 的四问四答：
 * - 键：`(SY 用户, 凭据, tenantId, Accept-Language)`。前三者分开落位——
 *   用户/租户/语言进字符串键，凭据进 `credentialIdentity` 比较（换了凭据就整份作废，
 *   而不是另开一份把内存占着到 TTL）。
 * - 内容：不无脑全量，按注册表**按需加载**（`ensure(capabilities)`）。
 * - TTL：绝对过期 + 空闲过期取先到者（H5 建议两者都设）。
 * - 上限：`maxSessions` + LRU 淘汰，淘汰与过期都发事件。
 */

import type { PortalCredential } from '../config.js'
import { BaseDataRegistry, createBaseDataRegistry } from './registry.js'
import {
  PortalSession,
  defaultCredentialIdentity,
  snapshotCredential,
  summarizeSessionError,
  type PortalSessionHooks,
} from './session.js'
import {
  BaseDataLoadError,
  SessionConfigurationError,
  SessionDisposedError,
  consoleSessionLogger,
  normalizeSessionKey,
  normalizeSessionLanguage,
  normalizeSessionPermissionContext,
  sessionStorageKey,
  type PortalRequestFactory,
  type SessionDescriptor,
  type SessionInvalidationFilter,
  type SessionInvalidationReason,
  type SessionKey,
  type SessionKeyInput,
  type SessionExpiryReason,
  type SessionPermissionContext,
  type SessionLogger,
  type SessionStoreEvent,
  type SessionStoreStats,
} from './types.js'

/**
 * 绝对过期默认 30 分钟。
 *
 * 这是设计 H5 给出的建议值（"两者都设，默认各 30 分钟"）。
 * 它存在的理由是 H6/D17：token 没有续期流程、吊销也不通知，
 * 空闲过期单独存在时，一个高频使用的用户可以让同一份缓存永远不被重建，
 * 「Portal 那边其实已经变了、SDK 这边还当成有效」这个窗口就没有上界。
 * 30 分钟的绝对上限把它压到有界，代价是每半小时一次真实请求——
 * 那次请求同时也是对凭据是否还活着的实际探测（H6 第 16 问的"保活"不需要另做机制）。
 */
export const DEFAULT_ABSOLUTE_TTL_MS = 30 * 60 * 1000

/**
 * 空闲过期默认 30 分钟。
 *
 * 与浏览器里"标签页不关就一直用"的直觉一致，也是 H5 的建议值。
 * 它管的是内存：F4 的那十几次请求里字典、组织树这类数据都不小（H5 原文），
 * 用户走了就得把这份内存还回来，否则进程里会攒下一堆再也不会被用的会话。
 */
export const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000

/**
 * 会话数上限默认 64。
 *
 * H5 明确要求"加内存上限，溢出走 LRU 淘汰并记日志"。取 64 是因为单份会话
 * 装的是基础数据（用户信息、租户上下文、两套字典、安全配置…），
 * 量级在数百 KB 到数 MB，64 份把进程占用压在几十到上百 MB 这个量级，
 * 而不是"随在线用户数线性增长"。这个值不承载业务语义，接入方按部署规模调。
 */
export const DEFAULT_MAX_SESSIONS = 64

export type SessionStoreOptions = {
  /**
   * 按凭据造请求函数。
   *
   * **必须由调用方给**：`createPortalHttp(config)` 的凭据是创建时绑定的
   * （拦截器闭包读 `config.credential`），所以"一个进程服务多个用户"在现结构下
   * 只能是一个用户一份请求函数。见 `./portal-http.ts`。
   */
  createRequest: PortalRequestFactory
  /** 基础数据能力表。缺省用 Portal 对齐的那六个（见 base-data.ts） */
  registry?: BaseDataRegistry
  /** 注入时钟。测试里换成假时钟，避免真实 sleep */
  now?: () => number
  absoluteTtlMs?: number
  idleTtlMs?: number
  maxSessions?: number
  /** 基础数据请求默认带的 module-type。缺省不传（设计 D34 / F19） */
  baseDataModuleType?: number
  /** 淘汰、过期、降级、真实加载的可观察出口 */
  onEvent?: (event: SessionStoreEvent) => void
  logger?: SessionLogger
  /**
   * 自定义凭据身份（例如 `(c) => sha256(c.token)`）。
   * 缺省把 tenantId + token 直接拼起来比较——token 本来就在内存里，不额外泄露什么。
   */
  credentialFingerprint?: (credential: PortalCredential) => string
}

export type SessionAcquireInput = SessionKeyInput & {
  credential: PortalCredential
  /**
   * 本次一定要可用的基础数据能力键（含依赖闭包）。
   * 已经加载过的会被跳过，所以重复 acquire 不会重复发请求。
   */
  capabilities?: readonly string[]
}

/** 按 userId 批量失效时的过滤条件 */
export type InvalidateUserInput = {
  userId: string | number
  tenantId?: string | number
}

/** 按 tenantId 批量失效，可选地再限定用户。 */
export type InvalidateTenantInput = {
  tenantId: string | number
  userId?: string | number
}

/** 按 language 批量失效，可选地限定用户、租户、权限上下文。 */
export type InvalidateLanguageInput = {
  language: string
  userId?: string | number
  tenantId?: string | number
  permissionContext?: SessionPermissionContext
}

/** 按权限上下文批量失效，可选地限定用户、租户、语言。 */
export type InvalidatePermissionContextInput = {
  permissionContext: SessionPermissionContext
  userId?: string | number
  tenantId?: string | number
  language?: string
}

type PendingSession = {
  promise: Promise<PortalSession>
  /** createSession 的同步段装入 Map 的会话；构造请求抛错时可能没有。 */
  session?: PortalSession
}

type NormalizedInvalidationFilter = {
  userId?: string
  tenantId?: string
  language?: string
  /** 空字符串表示「未设置权限上下文」这一默认槽位。 */
  permissionContext?: string
}

export class SessionStore {
  private readonly createRequest: PortalRequestFactory
  private readonly registry: BaseDataRegistry
  private readonly absoluteTtlMs: number
  private readonly idleTtlMs: number
  private readonly maxSessions: number
  private readonly baseDataModuleType: number | undefined
  private readonly now: () => number
  private readonly onEvent: ((event: SessionStoreEvent) => void) | undefined
  private readonly logger: SessionLogger
  private readonly credentialFingerprint: ((credential: PortalCredential) => string) | undefined

  /** Map 的插入顺序就是 LRU 顺序：队首最旧，队尾最新 */
  private readonly sessions = new Map<string, PortalSession>()
  /**
   * 正在初始化（单飞中）的会话：只有同一会话键、同一凭据身份的 acquire 才能合流。
   *
   * 凭据身份不放进 sessions 的存储键，是为了轮换时能把旧会话整份淘汰；但它必须
   * 放进 pending 的合流键，否则新 token 在旧 token 首次加载尚未结束时会拿到旧会话。
   */
  private readonly pending = new Map<string, Map<string, PendingSession>>()

  private readonly counters = {
    created: 0,
    hits: 0,
    misses: 0,
    expired: 0,
    evicted: 0,
    invalidated: 0,
    degraded: 0,
    loads: 0,
  }

  constructor (options: SessionStoreOptions) {
    if (typeof options?.createRequest !== 'function') {
      throw new SessionConfigurationError('SessionStore 需要 createRequest（按凭据造请求函数）')
    }

    const absoluteTtlMs = options.absoluteTtlMs ?? DEFAULT_ABSOLUTE_TTL_MS
    const idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS
    const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS

    if (!(absoluteTtlMs > 0)) {
      throw new SessionConfigurationError('absoluteTtlMs 必须大于 0')
    }
    if (!(idleTtlMs > 0)) {
      throw new SessionConfigurationError('idleTtlMs 必须大于 0')
    }
    if (!Number.isInteger(maxSessions) || maxSessions < 1) {
      throw new SessionConfigurationError('maxSessions 必须是 >= 1 的整数')
    }

    this.createRequest = options.createRequest
    this.registry = options.registry ?? createBaseDataRegistry()
    this.absoluteTtlMs = absoluteTtlMs
    this.idleTtlMs = idleTtlMs
    this.maxSessions = maxSessions
    this.baseDataModuleType = options.baseDataModuleType
    this.now = options.now ?? Date.now
    this.onEvent = options.onEvent
    this.logger = options.logger ?? consoleSessionLogger
    this.credentialFingerprint = options.credentialFingerprint
  }

  /**
   * 取一份会话，必要时把 `capabilities` 加载齐。
   *
   * 并发语义（这是 F4 那 14 个请求不被放大的关键）：
   * - 同一个会话键在初始化中，后来者等同一个 Promise，不会各建一份、各拉一轮；
   * - 后来者要的能力是第一批的超集时，缺的那些补拉，已有的复用；
   * - 能力级的单飞在 PortalSession 里，所以交叉的能力集合也只跑一次。
   */
  async acquire (input: SessionAcquireInput): Promise<PortalSession> {
    const key = normalizeSessionKey(input)
    this.assertCredentialTenantMatches(key, input.credential)

    const storeKey = sessionStorageKey(key)
    const capabilities = input.capabilities ?? []
    const at = this.now()
    const credentialIdentity = this.credentialIdentityOf(input.credential)

    // 必须先回收，再看 pending：旧会话可能正停在一次慢加载上，到了 TTL 以后
    // 不能再把新的 acquire 合流到那份已过期的 promise。
    this.reapExpired(at)

    const pendingEntry = this.pending.get(storeKey)?.get(credentialIdentity)
    if (pendingEntry) {
      const pendingSession = pendingEntry.session
      if (
        pendingSession &&
        (pendingSession.isDisposed || pendingSession.expiryReason(at) !== null)
      ) {
        this.removePending(storeKey, credentialIdentity, pendingEntry)
      } else {
        this.counters.hits += 1
        const session = await pendingEntry.promise
        await this.ensureOrDrop(session, capabilities)
        return session
      }
    }

    const live = this.sessions.get(storeKey)
    if (live) {
      if (live.credentialIdentity !== credentialIdentity) {
        // 同一个会话键换了凭据（重新授权 / token 轮换）：旧的整份作废。
        // 复用等于拿旧 token 拉来的数据冒充新凭据的（H5 要求凭据进键，就是这个意思）。
        this.drop(live, 'credential-rotated')
      } else {
        this.counters.hits += 1
        this.touch(live, at)
        this.emit({ type: 'hit', storeKey, key, at })
        await this.ensureOrDrop(live, capabilities)
        return live
      }
    }

    this.counters.misses += 1
    // 注意：createSession 是 async，但它的同步段就把会话装进 Map 了，
    // 所以随后并发进来的 acquire 已经能在 sessions 里看到它（并在能力级单飞里合流）。
    const creating = this.createSession(key, storeKey, input.credential, capabilities)
    const pendingByCredential = this.pending.get(storeKey) ?? new Map<string, PendingSession>()
    const pending: PendingSession = {
      promise: creating,
      session: this.sessions.get(storeKey),
    }
    pendingByCredential.set(credentialIdentity, pending)
    this.pending.set(storeKey, pendingByCredential)
    try {
      return await creating
    } finally {
      this.removePending(storeKey, credentialIdentity, pending)
    }
  }

  /** 只看不取：不加载、不刷新 LRU；过期项返回 undefined，下一次生命周期操作会回收它。 */
  peek (input: SessionKeyInput): PortalSession | undefined {
    const key = normalizeSessionKey(input)
    const session = this.sessions.get(sessionStorageKey(key))
    if (!session) {
      return undefined
    }
    return session.expiryReason(this.now()) === null ? session : undefined
  }

  /** 当前存活会话的只读描述，按 LRU 顺序（最旧在前）；同时回收已到期项。 */
  list (): SessionDescriptor[] {
    this.reapExpired()
    return [...this.sessions.values()]
  }

  /**
   * 主动失效一份会话（用户断开连接、或凭据被换掉）。
   * 返回是否真的删掉了东西。
   */
  invalidate (
    input: SessionKeyInput,
    reason: SessionInvalidationReason = 'manual',
  ): boolean {
    const key = normalizeSessionKey(input)
    this.reapExpired()
    const storeKey = sessionStorageKey(key)
    const session = this.sessions.get(storeKey)
    if (!session) {
      return false
    }
    return this.drop(session, reason)
  }

  /** 按任意身份维度批量失效；空筛选器拒绝，整体清空请显式调用 clear。 */
  invalidateWhere (
    filter: SessionInvalidationFilter,
    reason: SessionInvalidationReason = 'manual',
  ): number {
    const normalized = normalizeInvalidationFilter(filter)
    this.reapExpired()

    let count = 0
    for (const session of [...this.sessions.values()]) {
      if (!matchesInvalidationFilter(session, normalized)) {
        continue
      }
      if (this.drop(session, reason)) {
        count += 1
      }
    }
    return count
  }

  /** 按用户失效（该用户的所有租户，或指定租户）。返回失效的会话数 */
  invalidateUser (
    input: InvalidateUserInput,
    reason: SessionInvalidationReason = 'user-invalidated',
  ): number {
    return this.invalidateWhere(
      { userId: input.userId, ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }) },
      reason,
    )
  }

  /** 按租户失效，可选地只影响某个用户。 */
  invalidateTenant (
    input: InvalidateTenantInput,
    reason: SessionInvalidationReason = 'tenant-invalidated',
  ): number {
    return this.invalidateWhere(
      { tenantId: input.tenantId, ...(input.userId === undefined ? {} : { userId: input.userId }) },
      reason,
    )
  }

  /** 按语言失效，可选地限定用户、租户和权限上下文。 */
  invalidateLanguage (
    input: InvalidateLanguageInput,
    reason: SessionInvalidationReason = 'language-invalidated',
  ): number {
    return this.invalidateWhere(
      {
        language: input.language,
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
        ...(input.permissionContext === undefined ? {} : { permissionContext: input.permissionContext }),
      },
      reason,
    )
  }

  /** 按权限上下文失效，可选地限定用户、租户和语言。 */
  invalidatePermissionContext (
    input: InvalidatePermissionContextInput,
    reason: SessionInvalidationReason = 'permission-context-invalidated',
  ): number {
    return this.invalidateWhere(
      {
        permissionContext: input.permissionContext,
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
        ...(input.language === undefined ? {} : { language: input.language }),
      },
      reason,
    )
  }

  /**
   * 丢掉某个会话里的多个基础数据能力；重复 key 只处理一次。
   * 返回真的从缓存或在途请求中清掉的 key，能力级事件由 PortalSession 统一发出。
   */
  invalidateCapabilities (input: SessionKeyInput, capabilityKeys: readonly string[]): string[] {
    const key = normalizeSessionKey(input)
    this.reapExpired()
    const session = this.sessions.get(sessionStorageKey(key))
    if (!session || session.isDisposed) {
      return []
    }
    return session.invalidateCapabilities(capabilityKeys)
  }

  /**
   * 丢掉某个会话里的单个基础数据能力（写操作污染了缓存时用）。
   * 会话本身保留——这也是 H5「不缓存全量」的收益：污染面就是那一个能力。
   */
  invalidateCapability (input: SessionKeyInput, capabilityKey: string): boolean {
    return this.invalidateCapabilities(input, [capabilityKey]).length > 0
  }

  /** 清空所有会话（进程收尾、或整体降级） */
  clear (reason: SessionInvalidationReason = 'manual'): number {
    const count = this.sessions.size
    for (const session of [...this.sessions.values()]) {
      this.drop(session, reason)
    }
    return count
  }

  /**
   * 回收已过期的会话。acquire 每次都会先跑一遍，
   * 也可以由调用方定期跑（避免没人来访时过期会话一直占着内存）。
   */
  reapExpired (at: number = this.now()): SessionDescriptor[] {
    const reaped: SessionDescriptor[] = []
    for (const session of [...this.sessions.values()]) {
      const reason = session.expiryReason(at)
      if (reason === null) {
        continue
      }
      if (this.expire(session, reason, at)) {
        reaped.push(session)
      }
    }
    return reaped
  }

  stats (): SessionStoreStats {
    return {
      sessions: this.sessions.size,
      pending: [...this.pending.values()].reduce((count, entries) => count + entries.size, 0),
      ...this.counters,
    }
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private async createSession (
    key: SessionKey,
    storeKey: string,
    credential: PortalCredential,
    capabilities: readonly string[],
  ): Promise<PortalSession> {
    const boundCredential = snapshotCredential(credential)
    const hooks: PortalSessionHooks = {
      onLoad: (_session, capabilityKey) => {
        this.counters.loads += 1
        this.emit({ type: 'load', storeKey, key, capabilityKey, at: this.now() })
      },
      onUse: (session) => {
        // PortalSession.touch 已经更新过 usedAt；这里仅移动 LRU，不能再次 touch，
        // 否则会递归回调 onUse。
        this.reorder(session)
      },
      onCapabilityInvalidated: (session, capabilityKey) => {
        this.emit({
          type: 'invalidated',
          storeKey: session.storeKey,
          key: session.key,
          reason: 'capability-invalidated',
          capabilityKey,
          at: this.now(),
        })
      },
      onDegraded: (_session, failure) => {
        this.counters.degraded += 1
        // 降级不静默：日志 + 事件 + 会话上的 failureList，三处都能看到
        this.logger.warn('基础数据能力降级', {
          capabilityKey: failure.key,
          label: this.registry.get(failure.key)?.label,
          userId: key.userId,
          tenantId: key.tenantId,
          error: failure.error,
        })
        this.emit({
          type: 'degraded',
          storeKey,
          key,
          capabilityKey: failure.key,
          error: failure.error,
          at: failure.at,
        })
      },
    }

    const session = new PortalSession({
      key,
      storeKey,
      credential: boundCredential,
      credentialIdentity: this.credentialIdentityOf(boundCredential),
      request: this.createRequest({
        credential: boundCredential,
        language: key.language,
        ...(key.permissionContext === undefined ? {} : { permissionContext: key.permissionContext }),
      }),
      registry: this.registry,
      absoluteTtlMs: this.absoluteTtlMs,
      idleTtlMs: this.idleTtlMs,
      baseDataModuleType: this.baseDataModuleType,
      now: this.now,
      hooks,
    })

    this.install(session)
    this.counters.created += 1
    this.emit({ type: 'created', storeKey, key, at: session.createdAt })

    await this.ensureOrDrop(session, capabilities)
    return session
  }

  private async ensureOrDrop (
    session: PortalSession,
    capabilities: readonly string[],
  ): Promise<void> {
    try {
      await session.ensure(capabilities)
    } catch (error) {
      if (
        error instanceof SessionDisposedError &&
        (error.reason === 'absolute' || error.reason === 'idle')
      ) {
        this.expire(session, error.reason, this.now())
      }

      if (error instanceof BaseDataLoadError && error.critical) {
        // critical 失败 = 这份会话不可用。留着它只会让后续调用继续拿到半份数据，
        // 所以拆掉，让下一次 acquire 重新建（H6：无头下没有登录页可跳，只能明确失败）。
        this.logger.error('critical 基础数据加载失败，会话已作废', {
          capabilityKey: error.capabilityKey,
          userId: session.key.userId,
          tenantId: session.key.tenantId,
          error: summarizeSessionError(error.cause),
        })
        this.drop(session, 'critical-failure')
      }
      throw error
    }
  }

  /** 装进 LRU 的队尾，并按容量淘汰队首 */
  private install (session: PortalSession): void {
    this.sessions.delete(session.storeKey)
    this.sessions.set(session.storeKey, session)

    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next()
      if (oldest.done === true) {
        break
      }

      const victim = this.sessions.get(oldest.value)
      this.sessions.delete(oldest.value)
      victim?.dispose('capacity')
      this.counters.evicted += 1

      if (victim) {
        this.logger.warn('会话数超过上限，按 LRU 淘汰', {
          storeKey: victim.storeKey,
          maxSessions: this.maxSessions,
        })
        this.emit({
          type: 'evicted',
          storeKey: victim.storeKey,
          key: victim.key,
          reason: 'capacity',
          at: this.now(),
        })
      }
    }
  }

  private touch (session: PortalSession, at: number): void {
    session.touch(at)
  }

  private reorder (session: PortalSession): void {
    if (this.sessions.get(session.storeKey) !== session) {
      return
    }
    // 重插到队尾 = 最近使用
    this.sessions.delete(session.storeKey)
    this.sessions.set(session.storeKey, session)
  }

  private expire (session: PortalSession, reason: SessionExpiryReason, at: number): boolean {
    if (session.isDisposed || this.sessions.get(session.storeKey) !== session) {
      return false
    }
    this.sessions.delete(session.storeKey)
    session.dispose(reason)
    this.counters.expired += 1
    this.emit({ type: 'expired', storeKey: session.storeKey, key: session.key, reason, at })
    return true
  }

  private drop (session: PortalSession, reason: SessionInvalidationReason): boolean {
    if (session.isDisposed || this.sessions.get(session.storeKey) !== session) {
      return false
    }
    this.sessions.delete(session.storeKey)
    session.dispose(reason)
    this.counters.invalidated += 1
    this.emit({ type: 'invalidated', storeKey: session.storeKey, key: session.key, reason, at: this.now() })
    return true
  }

  private removePending (storeKey: string, credentialIdentity: string, pending: PendingSession): void {
    const pendingByCredential = this.pending.get(storeKey)
    if (!pendingByCredential || pendingByCredential.get(credentialIdentity) !== pending) {
      return
    }
    pendingByCredential.delete(credentialIdentity)
    if (pendingByCredential.size === 0) {
      this.pending.delete(storeKey)
    }
  }

  private credentialIdentityOf (credential: PortalCredential): string {
    return this.credentialFingerprint
      ? this.credentialFingerprint(credential)
      : defaultCredentialIdentity(credential)
  }

  /**
   * 凭据里的 tenantId 必须和会话键里的租户一致。
   *
   * 不一致时 `buildHeaders` 会把凭据里的那个租户写进 `tenant-id` 头，
   * 于是「以为在查 A 租户、实际查的是 B 租户」——设计 F26 说的正是后端在部分路径会静默选错租户。
   * 这种错误不该靠运气发现，直接拦下来。
   */
  private assertCredentialTenantMatches (key: SessionKey, credential: PortalCredential): void {
    const credentialTenant = String(credential.tenantId ?? '').trim()
    if (credentialTenant === '') {
      throw new SessionConfigurationError(
        '凭据缺少 tenantId（设计 F26：租户必须显式传入，否则后端可能静默选错租户）',
      )
    }
    if (credentialTenant !== key.tenantId) {
      throw new SessionConfigurationError(
        `凭据的 tenantId (${credentialTenant}) 与会话键的 tenantId (${key.tenantId}) 不一致`,
      )
    }
  }

  private emit (event: SessionStoreEvent): void {
    if (!this.onEvent) {
      return
    }
    try {
      this.onEvent(event)
    } catch (error) {
      // 观察者抛错不该影响会话本身；错误摘要不能把观察者自己的 secret 带进日志。
      this.logger.error('onEvent 回调抛错（已忽略）', { error: summarizeSessionError(error) })
    }
  }
}

function normalizeInvalidationFilter (filter: SessionInvalidationFilter): NormalizedInvalidationFilter {
  const userId = normalizeOptionalIdentity(filter.userId, 'userId')
  const tenantId = normalizeOptionalIdentity(filter.tenantId, 'tenantId')
  const language = filter.language === undefined ? undefined : normalizeSessionLanguage(filter.language)
  const permissionContext = filter.permissionContext === undefined
    ? undefined
    : (normalizeSessionPermissionContext(filter.permissionContext) ?? '')

  if (
    userId === undefined &&
    tenantId === undefined &&
    language === undefined &&
    permissionContext === undefined
  ) {
    throw new SessionConfigurationError('批量失效至少需要一个身份筛选条件；整体清空请调用 clear()')
  }

  return { userId, tenantId, language, permissionContext }
}

function normalizeOptionalIdentity (input: string | number | undefined, label: string): string | undefined {
  if (input === undefined) {
    return undefined
  }
  const normalized = String(input).trim()
  if (!normalized) {
    throw new SessionConfigurationError(`批量失效的 ${label} 不能为空`)
  }
  return normalized
}

function matchesInvalidationFilter (
  session: PortalSession,
  filter: NormalizedInvalidationFilter,
): boolean {
  return (
    (filter.userId === undefined || session.key.userId === filter.userId) &&
    (filter.tenantId === undefined || session.key.tenantId === filter.tenantId) &&
    (filter.language === undefined || session.key.language === filter.language) &&
    (
      filter.permissionContext === undefined ||
      (session.key.permissionContext ?? '') === filter.permissionContext
    )
  )
}
