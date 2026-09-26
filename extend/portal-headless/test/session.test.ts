import { describe, expect, it, vi } from 'vitest'

import type { PortalRequestConfig } from '../src/http/client.js'
import { PortalCredentialError } from '../src/http/errors.js'
import {
  BaseDataLoadError,
  SessionConfigurationError,
  SessionDisposedError,
  SessionStore,
  SingleFlight,
  consoleSessionLogger,
  createBaseDataRegistry,
  createPortalBaseDataRegistry,
  normalizeSessionKey,
  type BaseDataCapability,
  type PortalCredential,
  type PortalRequestContext,
  type PortalRequestFactory,
  type SessionAcquireInput,
  type SessionKeyInput,
  type SessionStoreEvent,
  type SessionStoreOptions,
} from '../src/session/index.js'

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

class FakeClock {
  private current = 1_700_000_000_000

  now = (): number => this.current

  advance (ms: number): void {
    this.current += ms
  }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T> (): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

type RecordedCall = {
  token: string
  tenantId: string | number
  language: string
  url: string
  params: Record<string, unknown> | undefined
  moduleType: number | undefined
  capabilityId: string | undefined
}

/** 造一个满足 `PortalRequest` 泛型签名的请求函数（真实实现见 src/session/portal-http.ts） */
function makeRequestFactory (
  handler: (context: PortalRequestContext, config: PortalRequestConfig) => unknown,
): PortalRequestFactory {
  return (context) => async <T = unknown>(config: PortalRequestConfig): Promise<T> => {
    const value = await handler(context, config)
    return value as T
  }
}

type CapSpec = {
  key: string
  deps?: string[]
  critical?: boolean
  /** 不传则返回 `${key}-value` */
  behavior?: () => Promise<unknown> | unknown
}

/** 造一批能力；`order` 记录**真实跑过**的 load，顺序即断言对象 */
function makeCapabilities (specs: readonly CapSpec[], order: string[]): BaseDataCapability[] {
  return specs.map((spec) => ({
    key: spec.key,
    label: `cap-${spec.key}`,
    ...(spec.deps === undefined ? {} : { deps: spec.deps }),
    ...(spec.critical === undefined ? {} : { critical: spec.critical }),
    load: async () => {
      order.push(spec.key)
      if (spec.behavior) {
        return await spec.behavior()
      }
      return `${spec.key}-value`
    },
  }))
}

type Harness = {
  store: SessionStore
  clock: FakeClock
  calls: RecordedCall[]
  events: SessionStoreEvent[]
  warnings: string[]
  errors: string[]
  warningMeta: Array<Record<string, unknown> | undefined>
  errorMeta: Array<Record<string, unknown> | undefined>
}

function createHarness (init: {
  capabilities?: readonly BaseDataCapability[]
  respond?: (call: RecordedCall) => Promise<unknown> | unknown
  storeOptions?: Partial<SessionStoreOptions>
} = {}): Harness {
  const clock = new FakeClock()
  const calls: RecordedCall[] = []
  const events: SessionStoreEvent[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const warningMeta: Array<Record<string, unknown> | undefined> = []
  const errorMeta: Array<Record<string, unknown> | undefined> = []

  // 凭据在这里被"绑定"到请求函数上——正是 src/http/client.ts 的形态
  const createRequest = makeRequestFactory((context, config) => {
    const call: RecordedCall = {
      token: context.credential.token,
      tenantId: context.credential.tenantId,
      language: context.language,
      url: String(config.url ?? ''),
      params: config.params as Record<string, unknown> | undefined,
      moduleType: config.moduleType,
      capabilityId: config.capabilityId,
    }
    calls.push(call)
    return init.respond ? init.respond(call) : { ok: true }
  })

  const store = new SessionStore({
    createRequest,
    now: clock.now,
    onEvent: (event) => events.push(event),
    logger: {
      warn: (message, meta) => {
        warnings.push(message)
        warningMeta.push(meta)
      },
      error: (message, meta) => {
        errors.push(message)
        errorMeta.push(meta)
      },
    },
    ...init.storeOptions,
    ...(init.capabilities === undefined
      ? {}
      : { registry: init.storeOptions?.registry ?? createBaseDataRegistry(init.capabilities) }),
  })

  return { store, clock, calls, events, warnings, errors, warningMeta, errorMeta }
}

type KeyOverrides = {
  userId?: string | number
  tenantId?: string | number
  language?: string
  permissionContext?: string | number
}

/** peek / invalidate 这类只要键的入参 */
function keyOf (overrides: KeyOverrides = {}): SessionKeyInput {
  const userId = String(overrides.userId ?? 'u-1')
  const tenantId = String(overrides.tenantId ?? 1001)
  return {
    userId,
    tenantId,
    ...(overrides.language === undefined ? {} : { language: overrides.language }),
    ...(overrides.permissionContext === undefined ? {} : { permissionContext: overrides.permissionContext }),
  }
}

/** acquire 的入参：键 + 凭据 + 本次要的能力 */
function acquireInput (
  overrides: KeyOverrides & { credential?: PortalCredential; capabilities?: readonly string[] } = {},
): SessionAcquireInput {
  const key = keyOf(overrides)
  return {
    ...key,
    credential: overrides.credential ?? { token: `tk-${key.userId}-${key.tenantId}`, tenantId: key.tenantId },
    ...(overrides.capabilities === undefined ? {} : { capabilities: overrides.capabilities }),
  }
}

// ---------------------------------------------------------------------------

describe('normalizeSessionKey —— 会话键', () => {
  it('把数字 id 归一成字符串，1 与 "1" 不会各建一份缓存', () => {
    expect(normalizeSessionKey({ userId: 1, tenantId: 2 })).toEqual(
      normalizeSessionKey({ userId: '1', tenantId: '2' }),
    )
  })

  it('缺 userId / tenantId 直接报错（设计 F26：租户不能靠后端猜）', () => {
    expect(() => normalizeSessionKey({ userId: '', tenantId: 1 })).toThrow(SessionConfigurationError)
    expect(() => normalizeSessionKey({ userId: 1, tenantId: '' })).toThrow(SessionConfigurationError)
  })

  it('语言默认 zh-CN', () => {
    expect(normalizeSessionKey({ userId: 1, tenantId: 2 }).language).toBe('zh-CN')
  })

  it('权限上下文默认槽位稳定，显式上下文进入键且数字与字符串归一', () => {
    expect(normalizeSessionKey({ userId: 1, tenantId: 2 })).toEqual(
      normalizeSessionKey({ userId: '1', tenantId: '2', permissionContext: '' }),
    )
    expect(normalizeSessionKey({ userId: 1, tenantId: 2, permissionContext: 7 })).toEqual(
      expect.objectContaining({ permissionContext: '7' }),
    )
    expect(normalizeSessionKey({ userId: 1, tenantId: 2, permissionContext: ' roles:v2 ' })).toEqual(
      expect.objectContaining({ permissionContext: 'roles:v2' }),
    )
  })
})

describe('单飞 —— F4 的十几次请求不能因为并发调用翻倍', () => {
  it('task 同步重入时，先登记的占位 Promise 会合并调用', async () => {
    const flight = new SingleFlight<string>()
    let calls = 0
    let nested: Promise<string> | undefined
    let task!: () => Promise<string>
    task = () => {
      calls += 1
      nested = flight.run('same-key', task)
      return Promise.resolve('ok')
    }

    const first = flight.run('same-key', task)

    expect(nested).toBe(first)
    await expect(first).resolves.toBe('ok')
    expect(calls).toBe(1)
    expect(flight.size).toBe(0)
  })

  it('forget 后旧 Promise 收尾不会删除新一代的 Promise', async () => {
    const flight = new SingleFlight<string>()
    const firstGate = deferred<void>()
    const secondGate = deferred<void>()

    const first = flight.run('same-key', () => firstGate.promise.then(() => 'first'))
    expect(flight.forget('same-key')).toBe(true)
    const second = flight.run('same-key', () => secondGate.promise.then(() => 'second'))

    firstGate.resolve()
    await expect(first).resolves.toBe('first')
    expect(flight.has('same-key')).toBe(true)
    expect(flight.run('same-key', () => Promise.resolve('third'))).toBe(second)

    secondGate.resolve()
    await expect(second).resolves.toBe('second')
    expect(flight.size).toBe(0)
  })

  it('同一会话键并发 acquire，真实加载只跑一次，三者拿到同一个会话', async () => {
    const order: string[] = []
    const started = deferred<void>()
    const gate = deferred<void>()

    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          {
            key: 'user-basic',
            critical: true,
            behavior: async () => {
              started.resolve()
              await gate.promise
              return { name: '张三' }
            },
          },
        ],
        order,
      ),
    })

    const acquisitions = [
      harness.store.acquire(acquireInput({ capabilities: ['user-basic'] })),
      harness.store.acquire(acquireInput({ capabilities: ['user-basic'] })),
      harness.store.acquire(acquireInput({ capabilities: ['user-basic'] })),
    ]

    // 等第一次真实加载确实开始了再放开闸门——"只跑一次"因此不靠时间巧合
    await started.promise
    gate.resolve()

    const sessions = await Promise.all(acquisitions)

    expect(order).toEqual(['user-basic'])
    expect(sessions[0]).toBe(sessions[1])
    expect(sessions[1]).toBe(sessions[2])
    expect(harness.store.stats().loads).toBe(1)
    expect(harness.store.stats().created).toBe(1)
  })

  it('并发请求的能力集合有重叠时，重叠的那个能力也只跑一次', async () => {
    const order: string[] = []
    const started = deferred<void>()
    const gate = deferred<void>()

    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          {
            key: 'a',
            critical: true,
            behavior: async () => {
              started.resolve()
              await gate.promise
              return 'a'
            },
          },
          { key: 'b' },
        ],
        order,
      ),
    })

    const first = harness.store.acquire(acquireInput({ capabilities: ['a'] }))
    const second = harness.store.acquire(acquireInput({ capabilities: ['a', 'b'] }))

    await started.promise
    gate.resolve()

    const [s1, s2] = await Promise.all([first, second])

    expect(order).toEqual(['a', 'b'])
    expect(s1).toBe(s2)
    expect(s2.loadedKeys().sort()).toEqual(['a', 'b'])
  })

  it('同一份会话上并发 ensure，重叠的能力也只跑一次（能力级单飞）', async () => {
    const order: string[] = []
    const started = deferred<void>()
    const gate = deferred<void>()

    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          {
            key: 'a',
            critical: true,
            behavior: async () => {
              started.resolve()
              await gate.promise
              return 'a'
            },
          },
          { key: 'b' },
        ],
        order,
      ),
    })

    // 先拿到会话但一个能力都不加载，这样下面两次 ensure 才是真正并发的
    const session = await harness.store.acquire(acquireInput())

    const first = session.ensure(['a'])
    const second = session.ensure(['a', 'b'])

    await started.promise
    gate.resolve()
    await Promise.all([first, second])

    expect(order).toEqual(['a', 'b'])
  })

  it('能力失效后旧请求收尾不得删掉新代际的 single-flight', async () => {
    const firstStarted = deferred<void>()
    const firstGate = deferred<void>()
    const secondStarted = deferred<void>()
    const secondGate = deferred<void>()
    let loads = 0

    const harness = createHarness({
      capabilities: [
        {
          key: 'a',
          critical: true,
          load: async () => {
            loads += 1
            if (loads === 1) {
              firstStarted.resolve()
              await firstGate.promise
            } else {
              secondStarted.resolve()
              await secondGate.promise
            }
            return `value-${loads}`
          },
        },
      ],
    })

    const session = await harness.store.acquire(acquireInput())
    const first = session.ensure(['a'])
    await firstStarted.promise

    expect(harness.store.invalidateCapability(keyOf(), 'a')).toBe(true)
    const second = session.ensure(['a'])
    await secondStarted.promise

    firstGate.resolve()
    await first

    // 如果旧代际的 finally 按 capability key 误删了新代际，下面会再开第三次真实加载。
    const third = session.ensure(['a'])
    expect(loads).toBe(2)

    secondGate.resolve()
    await Promise.all([second, third])
    expect(session.get('a')).toBe('value-2')
  })

  it('并发初始化撞上 critical 失败：只建一次、只作废一次、都拿到同一个错误', async () => {
    const order: string[] = []
    const started = deferred<void>()
    const gate = deferred<void>()

    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          {
            key: 'user-basic',
            critical: true,
            behavior: async () => {
              started.resolve()
              await gate.promise
              throw new Error('凭据已失效')
            },
          },
        ],
        order,
      ),
    })

    const first = harness.store.acquire(acquireInput({ capabilities: ['user-basic'] }))
    const second = harness.store.acquire(acquireInput({ capabilities: ['user-basic'] }))

    await started.promise
    gate.resolve()

    const results = await Promise.allSettled([first, second])

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(order).toEqual(['user-basic'])
    expect(harness.store.stats().created).toBe(1)
    // 一次失败只作废一次：没有合流的话每个并发调用都会再拆一遍、再发一次事件
    expect(harness.store.stats().invalidated).toBe(1)
    expect(harness.events.filter((event) => event.type === 'invalidated')).toHaveLength(1)
  })

  it('初始化完成后再次 acquire 是纯缓存命中，不再发请求', async () => {
    const order: string[] = []
    const harness = createHarness({ capabilities: makeCapabilities([{ key: 'a' }], order) })

    const first = await harness.store.acquire(acquireInput({ capabilities: ['a'] }))
    const second = await harness.store.acquire(acquireInput({ capabilities: ['a'] }))

    expect(second).toBe(first)
    expect(order).toEqual(['a'])
    expect(harness.store.stats().misses).toBe(1)
    expect(harness.store.stats().hits).toBe(1)
  })
})

describe('TTL —— 绝对过期与空闲过期取先到者', () => {
  it('空闲到期：不再被使用就回收（过期可观察）', async () => {
    const order: string[] = []
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'a' }], order),
      storeOptions: { absoluteTtlMs: 60_000, idleTtlMs: 10_000 },
    })

    const first = await harness.store.acquire(acquireInput({ capabilities: ['a'] }))

    harness.clock.advance(9_000)
    expect(await harness.store.acquire(acquireInput())).toBe(first) // 9s < 10s，还活着

    // 上次使用是 t0+9000，空闲上限因此是 t0+19000
    harness.clock.advance(10_500)
    const second = await harness.store.acquire(acquireInput({ capabilities: ['a'] }))

    expect(second).not.toBe(first)
    expect(harness.events).toContainEqual(
      expect.objectContaining({ type: 'expired', reason: 'idle' }),
    )
    expect(harness.store.stats().expired).toBe(1)
    expect(first.isDisposed).toBe(true)
    expect(order).toEqual(['a', 'a']) // 新会话把基础数据重新拉了一遍
  })

  it('绝对到期：一直在用也会到点作废', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'a' }], []),
      storeOptions: { absoluteTtlMs: 20_000, idleTtlMs: 600_000 },
    })

    const first = await harness.store.acquire(acquireInput({ capabilities: ['a'] }))

    harness.clock.advance(9_000)
    expect(await harness.store.acquire(acquireInput())).toBe(first)
    harness.clock.advance(9_000)
    expect(await harness.store.acquire(acquireInput())).toBe(first) // 用得很勤，空闲窗口一直在刷新

    // 绝对上限是 t0+20000；此时空闲窗口还远（t0+18000 那次使用 + 600000），所以只能是绝对过期
    harness.clock.advance(3_000)
    const second = await harness.store.acquire(acquireInput())

    expect(second).not.toBe(first)
    expect(harness.events).toContainEqual(
      expect.objectContaining({ type: 'expired', reason: 'absolute' }),
    )
    expect(first.expiryReason()).toBe('absolute')
  })

  it('绝对到期发生在途请求完成时：旧结果不回填，下一次 acquire 重建', async () => {
    const started = deferred<void>()
    const gate = deferred<void>()
    let loads = 0
    const harness = createHarness({
      capabilities: [
        {
          key: 'a',
          critical: true,
          load: async () => {
            loads += 1
            if (loads === 1) {
              started.resolve()
              await gate.promise
            }
            return `value-${loads}`
          },
        },
      ],
      storeOptions: { absoluteTtlMs: 10, idleTtlMs: 10_000 },
    })

    const acquisition = harness.store.acquire(acquireInput({ capabilities: ['a'] }))
    await started.promise
    harness.clock.advance(10)
    gate.resolve()

    await expect(acquisition).rejects.toMatchObject({
      name: 'SessionDisposedError',
      reason: 'absolute',
    })
    expect(harness.store.stats().sessions).toBe(0)
    expect(harness.store.stats().expired).toBe(1)

    const fresh = await harness.store.acquire(acquireInput({ capabilities: ['a'] }))
    expect(fresh.get('a')).toBe('value-2')
    expect(loads).toBe(2)
  })

  it('过期会话的直接 request 不能继续发请求，也不能靠 touch 复活', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities([], []),
      storeOptions: { absoluteTtlMs: 10, idleTtlMs: 10_000 },
    })
    const session = await harness.store.acquire(acquireInput())

    harness.clock.advance(10)
    await expect(session.request({ url: '/must-not-send', method: 'get' })).rejects.toMatchObject({
      name: 'SessionDisposedError',
      reason: 'absolute',
    })
    expect(harness.calls).toHaveLength(0)
    expect(() => session.touch()).toThrow(SessionDisposedError)
  })

  it('expiresAt 就是两个上限里先到的那个', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'a' }], []),
      storeOptions: { absoluteTtlMs: 60_000, idleTtlMs: 10_000 },
    })

    const session = await harness.store.acquire(acquireInput({ capabilities: ['a'] }))
    expect(session.expiresAt).toBe(session.createdAt + 10_000) // 空闲更近

    harness.clock.advance(5_000)
    session.touch()
    expect(session.expiresAt).toBe(session.createdAt + 15_000)
  })

  it('reapExpired 可以主动回收，不必等到下次 acquire', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'a' }], []),
      storeOptions: { absoluteTtlMs: 60_000, idleTtlMs: 10_000 },
    })

    await harness.store.acquire(acquireInput())
    harness.clock.advance(11_000)

    expect(harness.store.reapExpired()).toHaveLength(1)
    expect(harness.store.stats().sessions).toBe(0)
    expect(harness.store.stats().expired).toBe(1)
  })
})

describe('基础数据能力表：依赖、critical、降级', () => {
  it('按依赖拓扑排序加载，不按声明顺序', async () => {
    const order: string[] = []
    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          { key: 'leaf', deps: ['mid'] },
          { key: 'mid', deps: ['root'] },
          { key: 'root' },
        ],
        order,
      ),
    })

    const session = await harness.store.acquire(acquireInput({ capabilities: ['leaf'] }))

    expect(order).toEqual(['root', 'mid', 'leaf'])
    expect(session.loadedKeys().sort()).toEqual(['leaf', 'mid', 'root'])
  })

  it('只声明叶子也拿到整条依赖链', async () => {
    const order: string[] = []
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'root' }, { key: 'leaf', deps: ['root'] }], order),
    })

    await harness.store.acquire(acquireInput({ capabilities: ['leaf'] }))
    expect(order).toEqual(['root', 'leaf'])
  })

  it('依赖成环在注册表层就报配置错，不进入加载', () => {
    const registry = createPortalBaseDataRegistry()
    registry.register({ key: 'x', deps: ['y'], load: async () => 'x' })
    registry.register({ key: 'y', deps: ['x'], load: async () => 'y' })

    expect(() => registry.resolve(['x'])).toThrow(SessionConfigurationError)
    expect(() => registry.resolve(['x'])).toThrow(/成环/)
  })

  it('依赖未注册 / 能力未注册都是配置错', () => {
    const registry = createPortalBaseDataRegistry()
    registry.register({ key: 'x', deps: ['nope'], load: async () => 'x' })

    expect(() => registry.resolve(['x'])).toThrow(/未注册：nope/)
    expect(() => registry.resolve(['ghost'])).toThrow(/未注册：ghost/)
  })

  it('重复注册同一个键直接报错，不静默覆盖', () => {
    const registry = createPortalBaseDataRegistry()
    expect(() => registry.register({ key: 'user-basic', load: async () => 1 })).toThrow(
      SessionConfigurationError,
    )
  })

  it('critical 失败向上抛，并且这份会话被拆掉', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          {
            key: 'user-basic',
            critical: true,
            behavior: () => {
              throw new Error('凭据已失效')
            },
          },
        ],
        [],
      ),
    })

    await expect(
      harness.store.acquire(acquireInput({ capabilities: ['user-basic'] })),
    ).rejects.toBeInstanceOf(BaseDataLoadError)

    // 半份数据不能留在缓存里冒充可用会话
    expect(harness.store.stats().sessions).toBe(0)
    expect(harness.store.stats().invalidated).toBe(1)
    expect(harness.events).toContainEqual(
      expect.objectContaining({ type: 'invalidated', reason: 'critical-failure' }),
    )
    expect(harness.errors).toContain('critical 基础数据加载失败，会话已作废')
  })

  it('critical 错误日志只保留脱敏摘要，不携带凭据正文', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          {
            key: 'a',
            critical: true,
            behavior: () => {
              throw new Error('Authorization: secret-token password=private salt=secret-salt')
            },
          },
        ],
        [],
      ),
    })

    await expect(harness.store.acquire(acquireInput({ capabilities: ['a'] }))).rejects.toBeInstanceOf(
      BaseDataLoadError,
    )

    const diagnosticText = JSON.stringify(harness.errorMeta)
    expect(diagnosticText).not.toContain('secret-token')
    expect(diagnosticText).not.toContain('private')
    expect(diagnosticText).not.toContain('secret-salt')
  })

  it('非 critical 失败降级：其余能力照常可用，且失败被记录下来', async () => {
    const order: string[] = []
    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          { key: 'user-basic', critical: true },
          {
            key: 'dict-hr',
            behavior: () => {
              throw new Error('Authorization: secret-token password2=private salt=secret-salt')
            },
          },
        ],
        order,
      ),
    })

    const session = await harness.store.acquire(
      acquireInput({ capabilities: ['user-basic', 'dict-hr'] }),
    )

    expect(session.get('user-basic')).toBe('user-basic-value')
    expect(session.has('dict-hr')).toBe(false)
    expect(session.failureList()).toHaveLength(1)
    expect(session.failureList()[0]?.key).toBe('dict-hr')

    // 「不要静默吞掉」：会话上的记录 + 事件 + 日志，三处都能看到
    expect(harness.events).toContainEqual(
      expect.objectContaining({ type: 'degraded', capabilityKey: 'dict-hr' }),
    )
    expect(harness.warnings).toContain('基础数据能力降级')
    const diagnosticText = JSON.stringify({
      failures: session.failureList(),
      events: harness.events,
      warnings: harness.warnings,
    })
    expect(diagnosticText).not.toContain('secret-token')
    expect(diagnosticText).not.toContain('private')
    expect(diagnosticText).not.toContain('secret-salt')
    expect(harness.store.stats().degraded).toBe(1)

    // 降级的能力下次 ensure 会重试
    await session.ensure(['dict-hr'])
    expect(order.filter((key) => key === 'dict-hr')).toHaveLength(2)
    expect(harness.store.stats().degraded).toBe(2)
  })

  it('凭据失效即使发生在非 critical 能力上也向上抛，并把整份会话拆掉（设计 H6）', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          { key: 'user-basic', critical: true },
          {
            key: 'dict-hr', // 非 critical，但凭据挂了它一样拿不到
            behavior: () => {
              throw new PortalCredentialError(401)
            },
          },
        ],
        [],
      ),
    })

    await expect(
      harness.store.acquire(acquireInput({ capabilities: ['user-basic', 'dict-hr'] })),
    ).rejects.toBeInstanceOf(BaseDataLoadError)

    // 无头下没有登录页可跳，只能明确失败；留着一份拿不到字典的会话没有意义
    expect(harness.store.stats().sessions).toBe(0)
    expect(harness.store.stats().degraded).toBe(0)
    expect(harness.store.stats().invalidated).toBe(1)
  })

  it('非 critical 能力的依赖被降级时，它照常降级（不误伤）', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          { key: 'a', behavior: () => { throw new Error('普通失败') } },
          { key: 'b', deps: ['a'] },
        ],
        [],
      ),
    })

    const session = await harness.store.acquire(acquireInput({ capabilities: ['b'] }))
    expect(session.has('b')).toBe(true)
    expect(session.failureList().map((failure) => failure.key)).toEqual(['a'])
  })

  it('critical 能力的依赖被降级时，它明确失败而不是拿半份数据继续', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          {
            key: 'tenant-context',
            behavior: () => {
              throw new Error('企业列表拿不到')
            },
          },
          { key: 'tenant-system', deps: ['tenant-context'], critical: true },
        ],
        [],
      ),
    })

    await expect(
      harness.store.acquire(acquireInput({ capabilities: ['tenant-system'] })),
    ).rejects.toBeInstanceOf(BaseDataLoadError)
    expect(harness.store.stats().sessions).toBe(0)
  })

  it('配置错（未注册的能力）不拆会话——那是接线 bug，不是数据坏了', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'a' }], []),
      storeOptions: { absoluteTtlMs: 60_000, idleTtlMs: 60_000 },
    })

    await expect(
      harness.store.acquire(acquireInput({ capabilities: ['ghost'] })),
    ).rejects.toBeInstanceOf(SessionConfigurationError)

    expect(harness.store.stats().sessions).toBe(1)
    expect(harness.store.stats().invalidated).toBe(0)
  })
})

describe('容量与 LRU 淘汰', () => {
  it('超过上限时淘汰最久未使用的会话，并发出可观察的事件', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'a' }], []),
      storeOptions: { maxSessions: 2 },
    })

    const first = await harness.store.acquire(acquireInput({ userId: 'u-1' }))
    await harness.store.acquire(acquireInput({ userId: 'u-2' }))
    await harness.store.acquire(acquireInput({ userId: 'u-3' }))

    expect(harness.store.stats().evicted).toBe(1)
    expect(harness.store.stats().sessions).toBe(2)
    expect(harness.events).toContainEqual(
      expect.objectContaining({
        type: 'evicted',
        reason: 'capacity',
        key: expect.objectContaining({ userId: 'u-1' }),
      }),
    )

    // 被淘汰的会话必须真的不能用（否则调用方拿着一个假活着的对象继续发请求）
    expect(harness.store.peek(keyOf({ userId: 'u-1' }))).toBeUndefined()
    expect(first.isDisposed).toBe(true)
    await expect(first.ensure(['a'])).rejects.toBeInstanceOf(SessionDisposedError)
  })

  it('被用过的会话挪到队尾，淘汰的是更久没用的那个', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'a' }], []),
      storeOptions: { maxSessions: 2 },
    })

    await harness.store.acquire(acquireInput({ userId: 'u-1' }))
    await harness.store.acquire(acquireInput({ userId: 'u-2' }))

    harness.clock.advance(1_000)
    await harness.store.acquire(acquireInput({ userId: 'u-1' })) // u-1 变成最近使用

    await harness.store.acquire(acquireInput({ userId: 'u-3' }))

    expect(harness.store.peek(keyOf({ userId: 'u-1' }))).toBeDefined()
    expect(harness.store.peek(keyOf({ userId: 'u-2' }))).toBeUndefined()
  })

  it('maxSessions 不合法时构造就失败', () => {
    expect(
      () => new SessionStore({ createRequest: makeRequestFactory(() => null), maxSessions: 0 }),
    ).toThrow(SessionConfigurationError)
  })
})

describe('失效', () => {
  it('主动失效一份会话，第二次失效返回 false', async () => {
    const harness = createHarness({ capabilities: makeCapabilities([{ key: 'a' }], []) })

    await harness.store.acquire(acquireInput())

    expect(harness.store.invalidate(keyOf())).toBe(true)
    expect(harness.store.invalidate(keyOf())).toBe(false)
    expect(harness.store.peek(keyOf())).toBeUndefined()
    expect(harness.store.stats().invalidated).toBe(1)
    expect(harness.events).toContainEqual(
      expect.objectContaining({ type: 'invalidated', reason: 'manual' }),
    )
  })

  it('按用户失效清掉该用户的全部租户，不碰别人的', async () => {
    const harness = createHarness({ capabilities: makeCapabilities([{ key: 'a' }], []) })

    await harness.store.acquire(acquireInput({ userId: 'u-1', tenantId: 1001 }))
    await harness.store.acquire(acquireInput({ userId: 'u-1', tenantId: 2002 }))
    await harness.store.acquire(acquireInput({ userId: 'u-2', tenantId: 1001 }))

    expect(harness.store.invalidateUser({ userId: 'u-1' })).toBe(2)
    expect(harness.store.peek(keyOf({ userId: 'u-1', tenantId: 1001 }))).toBeUndefined()
    expect(harness.store.peek(keyOf({ userId: 'u-1', tenantId: 2002 }))).toBeUndefined()
    expect(harness.store.peek(keyOf({ userId: 'u-2', tenantId: 1001 }))).toBeDefined()
  })

  it('按 tenant / language / permissionContext 失效时只命中指定维度', async () => {
    const harness = createHarness({ capabilities: makeCapabilities([], []) })

    await harness.store.acquire(acquireInput({ userId: 'u-1', tenantId: 1001, language: 'zh-CN', permissionContext: 'p1' }))
    await harness.store.acquire(acquireInput({ userId: 'u-2', tenantId: 1001, language: 'en-US', permissionContext: 'p1' }))
    await harness.store.acquire(acquireInput({ userId: 'u-1', tenantId: 2002, language: 'zh-CN', permissionContext: 'p1' }))
    await harness.store.acquire(acquireInput({ userId: 'u-2', tenantId: 2002, language: 'en-US', permissionContext: 'p2' }))

    expect(harness.store.invalidateTenant({ tenantId: 1001 })).toBe(2)
    expect(harness.store.peek(keyOf({ userId: 'u-1', tenantId: 1001, language: 'zh-CN', permissionContext: 'p1' }))).toBeUndefined()
    expect(harness.store.peek(keyOf({ userId: 'u-2', tenantId: 1001, language: 'en-US', permissionContext: 'p1' }))).toBeUndefined()
    expect(harness.store.peek(keyOf({ userId: 'u-1', tenantId: 2002, language: 'zh-CN', permissionContext: 'p1' }))).toBeDefined()
    expect(harness.store.peek(keyOf({ userId: 'u-2', tenantId: 2002, language: 'en-US', permissionContext: 'p2' }))).toBeDefined()

    expect(harness.store.invalidateLanguage({ language: 'en-US' })).toBe(1)
    expect(harness.store.peek(keyOf({ userId: 'u-2', tenantId: 2002, language: 'en-US', permissionContext: 'p2' }))).toBeUndefined()

    await harness.store.acquire(acquireInput({ userId: 'u-1', tenantId: 2002, language: 'zh-CN', permissionContext: 'p2' }))
    expect(harness.store.invalidatePermissionContext({
      userId: 'u-1',
      tenantId: 2002,
      language: 'zh-CN',
      permissionContext: 'p1',
    })).toBe(1)
    expect(harness.store.peek(keyOf({ userId: 'u-1', tenantId: 2002, language: 'zh-CN', permissionContext: 'p1' }))).toBeUndefined()
    expect(harness.store.peek(keyOf({ userId: 'u-1', tenantId: 2002, language: 'zh-CN', permissionContext: 'p2' }))).toBeDefined()

    expect(harness.events).toContainEqual(expect.objectContaining({ type: 'invalidated', reason: 'tenant-invalidated' }))
    expect(harness.events).toContainEqual(expect.objectContaining({ type: 'invalidated', reason: 'language-invalidated' }))
    expect(harness.events).toContainEqual(expect.objectContaining({ type: 'invalidated', reason: 'permission-context-invalidated' }))
  })

  it('批量能力失效去重，并为每个实际命中的能力发带 key 的事件', async () => {
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'a' }, { key: 'b' }], []),
    })
    const session = await harness.store.acquire(acquireInput({ capabilities: ['a', 'b'] }))

    expect(harness.store.invalidateCapabilities(keyOf(), ['a', 'a', 'missing', 'b'])).toEqual(['a', 'b'])
    expect(session.loadedKeys()).toEqual([])
    const capabilityEvents = harness.events.filter(
      (event): event is Extract<SessionStoreEvent, { type: 'invalidated' }> =>
        event.type === 'invalidated' && event.reason === 'capability-invalidated',
    )
    expect(capabilityEvents.map((event) => event.capabilityKey)).toEqual(['a', 'b'])
  })

  it('批量失效拒绝空筛选器，避免把条件遗漏误当成全量清空', () => {
    const harness = createHarness({ capabilities: makeCapabilities([], []) })
    expect(() => harness.store.invalidateWhere({})).toThrow(SessionConfigurationError)
  })

  it('单个能力失效：会话还在，下次 ensure 重新拉那一项', async () => {
    const order: string[] = []
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'a' }, { key: 'b' }], order),
    })

    const session = await harness.store.acquire(acquireInput({ capabilities: ['a', 'b'] }))
    expect(order).toEqual(['a', 'b'])

    expect(harness.store.invalidateCapability(keyOf(), 'b')).toBe(true)

    expect(session.has('a')).toBe(true)
    expect(session.has('b')).toBe(false)
    expect(harness.store.peek(keyOf())).toBe(session) // 会话本身没被拆掉

    await session.ensure(['b'])
    expect(order).toEqual(['a', 'b', 'b'])
    expect(session.has('b')).toBe(true)
  })

  it('能力失效会递归清掉依赖它的能力，并刷新受影响的 scoped 索引', async () => {
    const order: string[] = []
    let scopedInvalidations = 0
    const harness = createHarness({
      capabilities: makeCapabilities([
        { key: 'tenant-context' },
        { key: 'tenant-system', deps: ['tenant-context'] },
      ], order),
    })

    const session = await harness.store.acquire(acquireInput({ capabilities: ['tenant-system'] }))
    session.getOrCreateScoped(
      'test-base-data',
      () => ({ invalidate: () => { scopedInvalidations += 1 } }),
      ['tenant-context'],
    )

    expect(harness.store.invalidateCapability(keyOf(), 'tenant-context')).toBe(true)
    expect(session.loadedKeys()).toEqual([])
    expect(scopedInvalidations).toBe(1)

    await session.ensure(['tenant-system'])
    expect(order).toEqual(['tenant-context', 'tenant-system', 'tenant-context', 'tenant-system'])
  })

  it('即使基础值没有挂进 session，失效也会刷新 scoped 自有缓存', async () => {
    let scopedInvalidations = 0
    const harness = createHarness({ capabilities: makeCapabilities([], []) })
    const session = await harness.store.acquire(acquireInput())
    session.getOrCreateScoped(
      'test-local-index',
      () => ({ invalidate: () => { scopedInvalidations += 1 } }),
      ['dept-list'],
    )

    expect(harness.store.invalidateCapability(keyOf(), 'dept-list')).toBe(false)
    expect(scopedInvalidations).toBe(1)
  })

  it('同一个 scoped 能力重复注册时会合并后续声明的失效键', async () => {
    let scopedInvalidations = 0
    const harness = createHarness({ capabilities: makeCapabilities([], []) })
    const session = await harness.store.acquire(acquireInput())
    const scoped = { invalidate: () => { scopedInvalidations += 1 } }

    expect(session.getOrCreateScoped('test-merge-keys', () => scoped)).toBe(scoped)
    expect(session.getOrCreateScoped('test-merge-keys', () => ({ invalidate: () => {} }), ['dict-hr'])).toBe(scoped)

    expect(harness.store.invalidateCapability(keyOf(), 'dict-hr')).toBe(false)
    expect(scopedInvalidations).toBe(1)
  })

  it('会话 dispose 时会先失效仍被调用方持有的 scoped 门面', async () => {
    let scopedInvalidations = 0
    const harness = createHarness({ capabilities: makeCapabilities([], []) })
    const session = await harness.store.acquire(acquireInput())
    session.getOrCreateScoped('test-dispose', () => ({
      invalidate: () => { scopedInvalidations += 1 },
    }))

    session.dispose('manual')

    expect(scopedInvalidations).toBe(1)
  })

  it('加载期间被失效：回来的结果不会写回（否则等于把刚清掉的缓存又填上）', async () => {
    const order: string[] = []
    const started = deferred<void>()
    const gate = deferred<void>()

    const harness = createHarness({
      capabilities: makeCapabilities(
        [
          {
            key: 'a',
            behavior: async () => {
              started.resolve()
              await gate.promise
              return 'stale-value'
            },
          },
        ],
        order,
      ),
    })

    const acquisition = harness.store.acquire(acquireInput({ capabilities: ['a'] }))
    await started.promise

    harness.store.invalidateCapability(keyOf(), 'a')
    gate.resolve()

    const session = await acquisition
    expect(session.has('a')).toBe(false)
    expect(session.get('a')).toBeUndefined()
  })

  it('加载期间失败且被失效：旧请求不会把 failureList 污染回来', async () => {
    const started = deferred<void>()
    const gate = deferred<void>()

    const harness = createHarness({
      capabilities: [
        {
          key: 'a',
          load: async () => {
            started.resolve()
            await gate.promise
            throw new Error('stale failure')
          },
        },
      ],
    })

    const acquisition = harness.store.acquire(acquireInput({ capabilities: ['a'] }))
    await started.promise

    expect(harness.store.invalidateCapability(keyOf(), 'a')).toBe(true)
    gate.resolve()

    const session = await acquisition
    expect(session.failureList()).toEqual([])
    expect(session.has('a')).toBe(false)
  })

  it('同一会话键换了凭据：旧会话整份作废，不复用旧 token 拉来的数据', async () => {
    const harness = createHarness({ capabilities: makeCapabilities([{ key: 'a' }], []) })

    const first = await harness.store.acquire(
      acquireInput({ credential: { token: 'tk-old', tenantId: '1001' } }),
    )
    const second = await harness.store.acquire(
      acquireInput({ credential: { token: 'tk-new', tenantId: '1001' } }),
    )

    expect(second).not.toBe(first)
    expect(first.isDisposed).toBe(true)
    expect(harness.events).toContainEqual(
      expect.objectContaining({ type: 'invalidated', reason: 'credential-rotated' }),
    )
    const eventText = JSON.stringify(harness.events)
    expect(eventText).not.toContain('tk-old')
    expect(eventText).not.toContain('tk-new')
  })

  it('会话绑定凭据快照：调用方原地改 token 不会改变旧会话的请求身份', async () => {
    const harness = createHarness({ capabilities: makeCapabilities([], []) })
    const credential: PortalCredential = { token: 'tk-before', tenantId: '1001' }
    const session = await harness.store.acquire(acquireInput({ credential }))

    credential.token = 'tk-after'
    credential.tenantId = '2002'

    expect(session.credential).toEqual({ token: 'tk-before', tenantId: '1001' })
    await session.request({ url: '/session-snapshot-check', method: 'get' })
    expect(harness.calls.at(-1)).toEqual(expect.objectContaining({
      token: 'tk-before',
      tenantId: '1001',
      url: '/session-snapshot-check',
    }))
  })

  it('凭据轮换发生在初始化期间：新凭据不与旧 token 的 pending 合流', async () => {
    const oldStarted = deferred<void>()
    const oldGate = deferred<void>()

    const harness = createHarness({
      capabilities: [
        {
          key: 'a',
          critical: true,
          load: async (context) => {
            if (context.credential.token === 'tk-old') {
              oldStarted.resolve()
              await oldGate.promise
            }
            return context.credential.token
          },
        },
      ],
    })

    const oldAcquire = harness.store.acquire(
      acquireInput({
        credential: { token: 'tk-old', tenantId: '1001' },
        capabilities: ['a'],
      }),
    )
    await oldStarted.promise

    const newAcquire = harness.store.acquire(
      acquireInput({
        credential: { token: 'tk-new', tenantId: '1001' },
        capabilities: ['a'],
      }),
    )
    oldGate.resolve()

    const [oldResult, newResult] = await Promise.allSettled([oldAcquire, newAcquire])

    expect(oldResult.status).toBe('rejected')
    expect(newResult.status).toBe('fulfilled')
    if (newResult.status === 'fulfilled') {
      expect(newResult.value.credential.token).toBe('tk-new')
      expect(newResult.value.get('a')).toBe('tk-new')
    }
    expect(harness.store.stats().pending).toBe(0)
  })

  it('凭据里的租户和会话键不一致时直接拦下来（设计 F26）', async () => {
    const harness = createHarness({ capabilities: makeCapabilities([{ key: 'a' }], []) })

    await expect(
      harness.store.acquire({
        userId: 'u-1',
        tenantId: 1001,
        credential: { token: 'tk', tenantId: 9999 },
      }),
    ).rejects.toThrow(SessionConfigurationError)
  })
})

describe('多用户 / 多租户（F4：一个用户可能属于多个租户）', () => {
  it('两个用户，其中一个换租户：三份互不串味的会话', async () => {
    const order: string[] = []
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'user-basic', critical: true }], order),
    })

    const aliceA = await harness.store.acquire(
      acquireInput({
        userId: 'alice',
        tenantId: 1001,
        credential: { token: 'tk-alice', tenantId: 1001 },
        capabilities: ['user-basic'],
      }),
    )
    const aliceB = await harness.store.acquire(
      acquireInput({
        userId: 'alice',
        tenantId: 2002,
        credential: { token: 'tk-alice', tenantId: 2002 },
        capabilities: ['user-basic'],
      }),
    )
    const bob = await harness.store.acquire(
      acquireInput({
        userId: 'bob',
        tenantId: 1001,
        credential: { token: 'tk-bob', tenantId: 1001 },
        capabilities: ['user-basic'],
      }),
    )

    expect(new Set([aliceA, aliceB, bob]).size).toBe(3)
    expect(harness.store.stats().sessions).toBe(3)
    // 三份会话各拉一轮基础数据——这是租户/用户隔离的代价，也是正确性要求
    expect(order).toEqual(['user-basic', 'user-basic', 'user-basic'])

    expect(aliceA.credential.token).toBe('tk-alice')
    expect(aliceA.key.tenantId).toBe('1001')
    expect(aliceB.key.tenantId).toBe('2002')
    expect(bob.credential.token).toBe('tk-bob')
  })

  it('语言不同就是不同的会话（H5 的键里有 Accept-Language）', async () => {
    const order: string[] = []
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'a' }], order),
      storeOptions: { baseDataModuleType: undefined },
    })

    const zh = await harness.store.acquire(acquireInput({ capabilities: ['a'] }))
    const en = await harness.store.acquire(acquireInput({ language: 'en-US', capabilities: ['a'] }))

    expect(en).not.toBe(zh)
    expect(zh.key.language).toBe('zh-CN')
    expect(en.key.language).toBe('en-US')
    expect(order).toEqual(['a', 'a'])
  })

  it('权限上下文不同就是不同的会话，不复用另一套权限下的基础数据', async () => {
    const order: string[] = []
    const harness = createHarness({
      capabilities: makeCapabilities([{ key: 'a' }], order),
    })

    const v1 = await harness.store.acquire(
      acquireInput({ permissionContext: 'roles:v1', capabilities: ['a'] }),
    )
    const v2 = await harness.store.acquire(
      acquireInput({ permissionContext: 'roles:v2', capabilities: ['a'] }),
    )

    expect(v2).not.toBe(v1)
    expect(v1.key.permissionContext).toBe('roles:v1')
    expect(v2.key.permissionContext).toBe('roles:v2')
    expect(order).toEqual(['a', 'a'])
  })
})

describe('module-type（设计 D34 / F19）', () => {
  it('会话默认不传；能力自己声明了按声明的传', async () => {
    const capabilities: BaseDataCapability[] = [
      { key: 'no-module', load: (ctx) => ctx.request({ url: '/x', method: 'get' }) },
      { key: 'with-module', moduleType: 7, load: (ctx) => ctx.request({ url: '/y', method: 'get' }) },
    ]

    const plain = createHarness({ capabilities })
    await plain.store.acquire(acquireInput({ capabilities: ['no-module'] }))
    expect(plain.calls[0]?.moduleType).toBeUndefined() // 算不出就不发（D34）
    expect(plain.calls[0]?.capabilityId).toBe('base-data:no-module')

    const scoped = createHarness({ capabilities, storeOptions: { baseDataModuleType: 41 } })
    await scoped.store.acquire(acquireInput({ capabilities: ['no-module', 'with-module'] }))
    // 会话级默认 41；能力自己声明了 7 就按 7
    expect(scoped.calls.map((call) => call.moduleType)).toEqual([41, 7])
  })
})

describe('默认基础数据表（对齐 BASE_DATA_REGISTRY）', () => {
  /** 六个能力各自的回包，形状按 Portal 前端 fetch* 实际读的字段给 */
  function respondToPortal (url: string): unknown {
    switch (url) {
      case '/sys/user/info':
        return { id: 1, nickname: '张三' }
      case '/admin-api/hr/system-tenant/getUserTenantsByPage':
        return { list: [{ id: 1001, name: '甲公司' }], total: 1 }
      case '/admin-api/system/tenant/get':
        return { useSystem: '41, 42,,43 ' } // 与 system.js:683-690 一样是逗号串，含空项与空格
      case '/adminmanage-api/adminmanage/platform-config/list':
        return { password: [{ configKey: 'password.minLength', value: 8 }] }
      case '/admin-api/system/dict-data/grouped-list':
        return [{ dictType: 'hr_sex', dataList: [{ label: '男', value: '1', id: 9 }] }]
      default:
        throw new Error(`未预期的请求：${url}`)
    }
  }

  it('六个能力的接口路径、参数与关键字段解析与 Portal 前端一致', async () => {
    const harness = createHarness({
      storeOptions: { registry: createPortalBaseDataRegistry() },
      respond: (call) => respondToPortal(call.url),
    })

    const session = await harness.store.acquire(
      acquireInput({
        capabilities: [
          'user-basic',
          'tenant-context',
          'tenant-system',
          'security-config',
          'dict-hr',
          'dict-platform',
        ],
      }),
    )

    // 拓扑顺序：user-basic、tenant-context 无罪；tenant-system / security-config 依赖它
    expect(harness.calls.map((call) => call.url)).toEqual([
      '/sys/user/info',
      '/admin-api/hr/system-tenant/getUserTenantsByPage',
      '/admin-api/system/tenant/get',
      '/adminmanage-api/adminmanage/platform-config/list',
      '/admin-api/system/dict-data/grouped-list',
      '/admin-api/system/dict-data/grouped-list',
    ])

    // 企业列表分页参数与 system.js:600-606 的 loopFetch 配置一致
    expect(harness.calls[1]?.params).toEqual({ pageNo: 1, pageSize: 200 })
    expect(harness.calls[2]?.params).toEqual({ id: '1001' })

    expect(session.get('user-basic')).toEqual({ id: 1, nickname: '张三' })
    expect(session.get('tenant-system')).toEqual([41, 42, 43]) // 空项与空格被吃掉
    expect(session.get('security-config')).toEqual({
      groups: { password: [{ configKey: 'password.minLength', value: 8 }] },
      list: [{ configKey: 'password.minLength', value: 8 }],
      byKey: { 'password.minLength': { configKey: 'password.minLength', value: 8 } },
      loadedAt: session.createdAt,
    })
    expect(session.get('dict-hr')).toEqual({ hr_sex: [{ label: '男', value: '1', id: 9 }] })
    expect(session.get('dict-platform')).toEqual({ hr_sex: [{ label: '男', value: '1', id: 9 }] })

    // critical 的只有两项，与 base-data.js 一致
    const criticality = Object.fromEntries(
      createPortalBaseDataRegistry()
        .list()
        .map((capability) => [capability.key, capability.critical === true]),
    )
    expect(criticality).toEqual({
      'user-basic': true,
      'tenant-context': true,
      'tenant-system': false,
      'security-config': false,
      'dict-hr': false,
      'dict-platform': false,
    })
  })

  it('tenant-context 会校验用户确实属于这个租户', async () => {
    const harness = createHarness({
      storeOptions: { registry: createPortalBaseDataRegistry() },
      respond: () => ({ list: [{ id: 2002, name: '乙公司' }], total: 1 }), // 只有乙公司
    })

    await expect(
      harness.store.acquire({ ...acquireInput(), capabilities: ['tenant-context'] }),
    ).rejects.toBeInstanceOf(BaseDataLoadError)
  })
})

describe('与 src/http 的接线', () => {
  it('语言与 permissionContext 从会话键贯穿到请求函数工厂，不会被默认值盖掉', async () => {
    // 注意要在**造请求函数**这一层记录，而不是在发请求那一层：
    // 要断言的正是"会话建请求函数时给了什么身份"
    const contexts: PortalRequestContext[] = []
    const inner = makeRequestFactory(() => ({ ok: true }))
    const createRequest: PortalRequestFactory = (context) => {
      contexts.push(context)
      return inner(context)
    }

    const store = new SessionStore({
      createRequest,
      registry: createBaseDataRegistry([]),
      now: new FakeClock().now,
      logger: { warn: () => {}, error: () => {} },
    })

    await store.acquire({
      userId: 'u-1',
      tenantId: 1001,
      credential: { token: 'tk', tenantId: 1001 },
    })
    await store.acquire({
      userId: 'u-1',
      tenantId: 1001,
      language: 'en-US',
      credential: { token: 'tk', tenantId: 1001 },
    })
    await store.acquire({
      userId: 'u-1',
      tenantId: 1001,
      language: 'en-US',
      permissionContext: 'roles:v2',
      credential: { token: 'tk', tenantId: 1001 },
    })

    // buildHeaders 会把 language 写成 Accept-Language，所以这里必须是会话键里的那个
    expect(contexts.map((context) => context.language)).toEqual(['zh-CN', 'en-US', 'en-US'])
    expect(contexts.map((context) => context.permissionContext)).toEqual([undefined, undefined, 'roles:v2'])
    expect(contexts.map((context) => context.credential.token)).toEqual(['tk', 'tk', 'tk'])
  })

  it('每个会话用的是自己凭据造出来的请求函数', async () => {
    const seen: Array<{ url: string; token: string; tenantId: string | number }> = []
    const createRequest = makeRequestFactory((context, config) => {
      seen.push({
        url: String(config.url),
        token: context.credential.token,
        tenantId: context.credential.tenantId,
      })
      return { ok: true }
    })

    const registry = createPortalBaseDataRegistry()
    registry.replace({
      key: 'user-basic',
      label: '用户基础信息',
      critical: true,
      load: (ctx) => ctx.request({ url: '/sys/user/info', method: 'get' }),
    })

    const store = new SessionStore({
      createRequest,
      registry,
      now: new FakeClock().now,
      logger: { warn: () => {}, error: () => {} },
    })

    await store.acquire({
      userId: 'alice',
      tenantId: 1001,
      credential: { token: 'tk-alice', tenantId: 1001 },
      capabilities: ['user-basic'],
    })
    await store.acquire({
      userId: 'bob',
      tenantId: 1001,
      credential: { token: 'tk-bob', tenantId: 1001 },
      capabilities: ['user-basic'],
    })

    expect(seen).toEqual([
      { url: '/sys/user/info', token: 'tk-alice', tenantId: 1001 },
      { url: '/sys/user/info', token: 'tk-bob', tenantId: 1001 },
    ])
  })
})

describe('默认 SessionLogger', () => {
  it('输出结构化记录且不直接调用 console.warn/error', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      consoleSessionLogger.warn('降级', { capabilityKey: 'dict-hr' })
      consoleSessionLogger.error('加载失败')
    } finally {
      const records = stderr.mock.calls.map(([record]) => JSON.parse(String(record)))
      stderr.mockRestore()
      warn.mockRestore()
      error.mockRestore()

      expect(records).toEqual([
        {
          scope: 'portal-headless/session',
          level: 'warn',
          message: '降级',
          meta: { capabilityKey: 'dict-hr' },
        },
        {
          scope: 'portal-headless/session',
          level: 'error',
          message: '加载失败',
        },
      ])
      expect(warn).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
    }
  })
})
