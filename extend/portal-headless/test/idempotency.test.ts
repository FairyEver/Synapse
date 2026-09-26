import { describe, expect, it, vi } from 'vitest'

import { PortalApiError, PortalCredentialError } from '../src/http/errors.js'
import {
  DEFAULT_IDEMPOTENCY_TTL_MS,
  IdempotencyKeyReuseError,
  IdempotencyRequestIdError,
  IdempotencyStore,
  MAX_REQUEST_ID_LENGTH,
  NotDispatchedError,
  PayloadFingerprintError,
  canonicalPayloadString,
  createRequestId,
  fingerprintPayload,
  idempotencyKey,
  normalizeRequestId,
  withIdempotency,
  type IdempotencyEvent,
  type IdempotencyScope,
} from '../src/idempotency/index.js'

/**
 * 写操作短窗口防重（设计 D12）。
 *
 * 这些用例同时是「边界声明」的抓手：把 SDK 做不到的事（进程重启、TTL 过后、
 * 多实例）钉成断言，免得后来的人以为它是幂等。
 *
 * TTL 一律用注入时钟推进，**没有真实 sleep**。
 */

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

/** 可推进的时钟 */
function createClock (start = 1_760_000_000_000) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => { current += ms },
  }
}

function deferred<T> () {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const SCOPE: IdempotencyScope = {
  requestId: 'req-0001',
  capabilityId: 'meeting-application-submit',
  tenantId: 1001,
  userId: 7,
}

const PAYLOAD = { meetingName: '周会', meetingRoomId: 12 }

/** 计数的 task 替身：返回一个对象，方便断言「是不是同一份结果」 */
function countingTask (value: unknown = { id: 42 }) {
  const calls: unknown[] = []
  const task = (payload: unknown = PAYLOAD) => {
    calls.push(payload)
    return Promise.resolve(value)
  }
  return { calls, task }
}

// ---------------------------------------------------------------------------
// 键的组成
// ---------------------------------------------------------------------------

describe('幂等键的组成', () => {
  it('键里能看出各段：namespace|tenant|user|能力|目标|requestId', () => {
    expect(idempotencyKey(SCOPE)).toBe(
      '|1001|7|meeting-application-submit||req-0001'
    )
    expect(idempotencyKey({ ...SCOPE, namespace: 'prod', target: 88 })).toBe(
      'prod|1001|7|meeting-application-submit|88|req-0001'
    )
  })

  it('身份/能力/目标/请求号 任一不同就是不同的键', () => {
    const base = idempotencyKey(SCOPE)
    const variants = [
      { ...SCOPE, tenantId: 2002 },
      { ...SCOPE, userId: 8 },
      { ...SCOPE, capabilityId: 'meeting-application-cancel' },
      { ...SCOPE, target: 99 },
      { ...SCOPE, namespace: 'staging' },
      { ...SCOPE, requestId: 'req-0002' },
    ]
    for (const variant of variants) {
      expect(idempotencyKey(variant)).not.toBe(base)
    }
  })

  it('段内出现分隔符也不会撞键（逐段转义）', () => {
    // 若不做转义，这两个会是同一个键
    const a = idempotencyKey({ ...SCOPE, capabilityId: 'cap', target: 'x|y' })
    const b = idempotencyKey({ ...SCOPE, capabilityId: 'cap', target: 'x' })
    const c = idempotencyKey({ ...SCOPE, capabilityId: 'cap|x', target: 'y' })
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('缺 capabilityId 直接报错（否则不同写操作会混成一个键）', () => {
    expect(() => idempotencyKey({ ...SCOPE, capabilityId: '' })).toThrow(/capabilityId/)
  })

  it('requestId 的规格与后端列对齐：非空、≤64、字符集受限', () => {
    expect(normalizeRequestId('  req-abc  ')).toBe('req-abc')
    expect(() => normalizeRequestId('')).toThrow(IdempotencyRequestIdError)
    expect(() => normalizeRequestId('   ')).toThrow(IdempotencyRequestIdError)
    expect(() => normalizeRequestId('a'.repeat(MAX_REQUEST_ID_LENGTH + 1))).toThrow(/64/)
    expect(() => normalizeRequestId('req 有空格')).toThrow(/字符/)
    expect(() => normalizeRequestId(undefined)).toThrow(/字符串/)
    expect(() => normalizeRequestId(12345)).toThrow(/字符串/)
  })

  it('createRequestId 生成的值可用、够长、不重复', () => {
    const first = createRequestId()
    const second = createRequestId()
    expect(normalizeRequestId(first)).toBe(first)
    expect(first).not.toBe(second)
    expect(first.startsWith('req_')).toBe(true)
    expect(() => createRequestId('bad prefix')).toThrow(IdempotencyRequestIdError)
  })
})

// ---------------------------------------------------------------------------
// 短窗口去重
// ---------------------------------------------------------------------------

describe('短窗口去重', () => {
  it('同 key 重复调用只发一次请求，并返回第一次的结果', async () => {
    const store = new IdempotencyStore()
    const result = { id: 42 }
    const send = vi.fn(() => Promise.resolve(result))

    const first = await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    const second = await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })

    expect(send).toHaveBeenCalledTimes(1)
    expect(first).toBe(result)
    expect(second).toBe(result)
  })

  it('不同 key 各自发一次', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn(() => Promise.resolve({ id: 1 }))

    await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    await store.run({ scope: { ...SCOPE, requestId: 'req-0002' }, payload: PAYLOAD, task: send })
    await store.run({ scope: { ...SCOPE, userId: 8 }, payload: PAYLOAD, task: send })

    expect(send).toHaveBeenCalledTimes(3)
    expect(store.size).toBe(3)
  })

  it('并发同 key：只发一次，两个调用拿到同一份结果', async () => {
    const store = new IdempotencyStore()
    const gate = deferred<void>()
    const result = { id: 42 }
    const send = vi.fn(() => gate.promise.then(() => result))

    const first = store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    const second = store.run({ scope: SCOPE, payload: PAYLOAD, task: send })

    // task 的同步阶段在 run() 里就跑完了 → 登记已经生效
    expect(send).toHaveBeenCalledTimes(1)
    gate.resolve()
    expect(await first).toBe(result)
    expect(await second).toBe(result)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('并发同 key 里第一个失败，第二个也失败（共享同一个 Promise）', async () => {
    const store = new IdempotencyStore()
    const gate = deferred<string>()
    const boom = new PortalApiError({ msg: '该时段已被占用', ret: 'FAIL', code: 500 })
    const send = vi.fn(() => gate.promise)

    const first = store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    const second = store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    gate.reject(boom)

    await expect(first).rejects.toBe(boom)
    await expect(second).rejects.toBe(boom)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('TTL 过期后可以重发（时钟注入，没有 sleep）', async () => {
    const clock = createClock()
    const store = new IdempotencyStore({ ttlMs: 60_000, now: clock.now })
    const send = vi.fn(() => Promise.resolve({ id: 1 }))

    await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    clock.advance(59_999)
    await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    expect(send).toHaveBeenCalledTimes(1)

    clock.advance(1) // 正好到期
    await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('TTL 从调用结束时刻起算，不是从发起时刻', async () => {
    const clock = createClock()
    const store = new IdempotencyStore({ ttlMs: 60_000, now: clock.now })
    const gate = deferred<string>()
    const send = vi.fn(() => gate.promise)

    const first = store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    clock.advance(50_000) // 请求飞了 50 秒
    gate.resolve('done')
    await first

    clock.advance(59_999)
    await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    expect(send).toHaveBeenCalledTimes(1)
    clock.advance(1)
    await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('默认 TTL 是 10 分钟', () => {
    expect(DEFAULT_IDEMPOTENCY_TTL_MS).toBe(600_000)
  })

  it('进行中的记录不按 TTL 清理：过期的 pending 也不会被重发（防双写）', async () => {
    const clock = createClock()
    const store = new IdempotencyStore({ ttlMs: 1_000, now: clock.now })
    const gate = deferred<string>()
    const send = vi.fn(() => gate.promise)

    const first = store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    clock.advance(10 * 60_000) // 远超 TTL，但请求还在飞
    const second = store.run({ scope: SCOPE, payload: PAYLOAD, task: send })

    expect(send).toHaveBeenCalledTimes(1)
    gate.resolve('done')
    expect(await first).toBe('done')
    expect(await second).toBe('done')
  })

  it('forget() 能把卡住的键解开', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn(() => Promise.resolve({ id: 1 }))
    await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    expect(store.has(SCOPE)).toBe(true)
    expect(store.forget(SCOPE)).toBe(true)
    await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('forget() 后旧任务成功收尾不能覆盖新 entry', async () => {
    const store = new IdempotencyStore()
    const oldGate = deferred<string>()
    const newGate = deferred<string>()
    const send = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => oldGate.promise)
      .mockImplementationOnce(() => newGate.promise)

    const old = store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    expect(store.forget(SCOPE)).toBe(true)
    const current = store.run({ scope: SCOPE, payload: PAYLOAD, task: send })

    oldGate.resolve('old')
    await expect(old).resolves.toBe('old')
    expect(store.stats.pending).toBe(1)

    newGate.resolve('new')
    await expect(current).resolves.toBe('new')
    expect(await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).toBe('new')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('forget() 后旧任务失败收尾不能删除或覆盖新 entry', async () => {
    const store = new IdempotencyStore()
    const oldGate = deferred<string>()
    const newGate = deferred<string>()
    const oldError = new PortalApiError({ msg: '旧任务失败', ret: 'FAIL', code: 500 })
    const send = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => oldGate.promise)
      .mockImplementationOnce(() => newGate.promise)

    const old = store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    expect(store.forget(SCOPE)).toBe(true)
    const current = store.run({ scope: SCOPE, payload: PAYLOAD, task: send })

    oldGate.reject(oldError)
    await expect(old).rejects.toBe(oldError)
    expect(store.stats.pending).toBe(1)

    newGate.resolve('new')
    await expect(current).resolves.toBe('new')
    expect(await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).toBe('new')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('不同的 store 之间互不知道（进程重启 = 防重失效，这是已知边界）', async () => {
    const send = vi.fn(() => Promise.resolve({ id: 1 }))
    const before = new IdempotencyStore()
    await before.run({ scope: SCOPE, payload: PAYLOAD, task: send })

    const afterRestart = new IdempotencyStore()
    await afterRestart.run({ scope: SCOPE, payload: PAYLOAD, task: send })

    expect(send).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// 同 key 不同载荷
// ---------------------------------------------------------------------------

describe('同 key 不同载荷', () => {
  const OTHER_PAYLOAD = { meetingName: '周会', meetingRoomId: 13 }

  it('抛错、不发请求、不覆盖记录', async () => {
    const store = new IdempotencyStore()
    const first = { id: 42 }
    const send = vi.fn(() => Promise.resolve(first))
    await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })

    const error = await store
      .run({ scope: SCOPE, payload: OTHER_PAYLOAD, task: send })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(IdempotencyKeyReuseError)
    expect(send).toHaveBeenCalledTimes(1)
    expect((error as IdempotencyKeyReuseError).requestId).toBe('req-0001')

    // 记录还在，且仍然是第一次那份：原载荷再来一次还是回放旧结果
    const again = await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    expect(again).toBe(first)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('键顺序不同不算换载荷（规范化序列化）', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn(() => Promise.resolve({ id: 42 }))
    await store.run({ scope: SCOPE, payload: { a: 1, b: { c: 2, d: 3 } }, task: send })
    await store.run({ scope: SCOPE, payload: { b: { d: 3, c: 2 }, a: 1 }, task: send })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('载荷真的不同就抛错（不是静默回放）', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn(() => Promise.resolve({ id: 42 }))
    await store.run({ scope: SCOPE, payload: PAYLOAD, task: send })
    await expect(
      store.run({ scope: SCOPE, payload: { ...PAYLOAD, meetingRoomId: 99 }, task: send })
    ).rejects.toThrow(IdempotencyKeyReuseError)
  })
})

// ---------------------------------------------------------------------------
// 失败与释放
// ---------------------------------------------------------------------------

describe('失败之后能不能重试', () => {
  it('业务失败（后端明确答复否定）→ 释放键，同 requestId 立刻可重试', async () => {
    const store = new IdempotencyStore()
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new PortalApiError({ msg: '该时段已被占用', ret: 'FAIL', code: 500 }))
      .mockResolvedValueOnce('ok')

    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).rejects.toThrow(/占用/)
    expect(store.size).toBe(0)

    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).resolves.toBe('ok')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('凭据被拒（401）→ 释放键', async () => {
    const store = new IdempotencyStore()
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new PortalCredentialError(401))
      .mockResolvedValueOnce('ok')

    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).rejects.toThrow(/凭据/)
    expect(store.size).toBe(0)
    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).resolves.toBe('ok')
  })

  it('标了 NotDispatchedError 的失败 → 释放键（请求没发出去）', async () => {
    const store = new IdempotencyStore()
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new NotDispatchedError(new Error('会议名称必填')))
      .mockResolvedValueOnce('ok')

    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).rejects.toThrow(
      NotDispatchedError
    )
    expect(store.size).toBe(0)
    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).resolves.toBe('ok')
  })

  it('同步抛出也按确知失败释放（同 requestId 可重试）', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn(() => { throw new NotDispatchedError(new Error('参数不合法')) })

    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).rejects.toThrow(
      /参数不合法/
    )
    expect(store.size).toBe(0)
  })

  it('task 没返回 Promise（接线写错了）→ 显式失败，不把 undefined 记成结果', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn(() => undefined as unknown as Promise<string>)

    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).rejects.toThrow(
      /不是 Promise/
    )
    // 不能落成"成功"：否则后续同键调用会命中一个假结果
    expect(store.stats.succeeded).toBe(0)
    expect(store.stats.pending).toBe(0)
  })

  it('超时 → 保留键：同 key 抛回原错误，且不再发请求', async () => {
    const store = new IdempotencyStore()
    const timeout = Object.assign(new Error('timeout of 180000ms exceeded'), {
      code: 'ECONNABORTED',
    })
    const send = vi.fn(() => Promise.reject(timeout))

    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).rejects.toBe(timeout)
    expect(store.size).toBe(1)

    // 关键：重试不会重发，也不会变成成功——把不确定性交还调用方
    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).rejects.toBe(timeout)
    expect(send).toHaveBeenCalledTimes(1)
    expect(store.stats.inDoubt).toBe(1)
  })

  it('连接断开 / HTTP 5xx / 未知异常 一律保守地按 in-doubt 处理', async () => {
    for (const error of [
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      new Error('Request failed with status code 500'),
      'not even an error object',
    ]) {
      const store = new IdempotencyStore()
      const send = vi.fn(() => Promise.reject(error))
      await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).rejects.toBe(error)
      expect(store.size).toBe(1)
    }
  })

  it('in-doubt 也只在 TTL 内保留：窗口过后仍会重发（能力边界）', async () => {
    const clock = createClock()
    const store = new IdempotencyStore({ ttlMs: 60_000, now: clock.now })
    const timeout = new Error('timeout')
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce('ok')

    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).rejects.toBe(timeout)
    clock.advance(60_000)
    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).resolves.toBe('ok')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('失败归类可注入（某个接口的 5xx 其实确知没写）', async () => {
    const store = new IdempotencyStore({
      classifyFailure: (error) =>
        error instanceof Error && error.message.includes('500') ? 'not-written' : 'unknown',
    })
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Request failed with status code 500'))
      .mockResolvedValueOnce('ok')

    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).rejects.toThrow(/500/)
    await expect(store.run({ scope: SCOPE, payload: PAYLOAD, task: send })).resolves.toBe('ok')
  })

  it('观测事件能回答「这次到底重发没有」', async () => {
    const clock = createClock()
    const events: IdempotencyEvent[] = []
    const store = new IdempotencyStore({
      ttlMs: 60_000,
      now: clock.now,
      onEvent: (event) => events.push(event),
    })
    const timeout = new Error('timeout')
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValue('ok')
    const call = () => store.run({ scope: SCOPE, payload: PAYLOAD, task: send })

    await expect(call()).rejects.toBe(timeout) // 超时：保留
    await expect(call()).rejects.toBe(timeout) // 窗口内重试：只回放，不重发
    expect(send).toHaveBeenCalledTimes(1)

    clock.advance(60_000) // 窗口过后才允许真的重发
    await expect(call()).resolves.toBe('ok')
    await expect(call()).resolves.toBe('ok')
    expect(send).toHaveBeenCalledTimes(2)

    expect(events.map((event) => event.type)).toEqual([
      'retain-in-doubt',
      'replay-in-doubt',
      'recorded-success',
      'replay-success',
    ])
  })

  it('观测回调自己抛异常不会把成功的写变成失败（诊断用，可事后取回）', async () => {
    const store = new IdempotencyStore({
      onEvent: () => { throw new Error('日志系统挂了') },
    })
    const result = { id: 42 }
    await expect(
      store.run({ scope: SCOPE, payload: PAYLOAD, task: () => Promise.resolve(result) })
    ).resolves.toBe(result)
    expect(store.observerErrors).toHaveLength(1)
  })

  it('ttlMs 非法直接报错', () => {
    expect(() => new IdempotencyStore({ ttlMs: 0 })).toThrow(/正数/)
    expect(() => new IdempotencyStore({ ttlMs: Number.NaN })).toThrow(/正数/)
  })
})

// ---------------------------------------------------------------------------
// 指纹
// ---------------------------------------------------------------------------

describe('载荷指纹', () => {
  it('同一份载荷稳定；键顺序无关；undefined 值的键被跳过', () => {
    expect(fingerprintPayload({ a: 1, b: 2 })).toBe(fingerprintPayload({ b: 2, a: 1 }))
    expect(fingerprintPayload({ a: 1 })).toBe(fingerprintPayload({ a: 1, b: undefined }))
    expect(canonicalPayloadString({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  it('内容不同则指纹不同（含嵌套与数组）', () => {
    const base = fingerprintPayload({ a: [1, 2, { c: 'x' }] })
    expect(fingerprintPayload({ a: [1, 2, { c: 'y' }] })).not.toBe(base)
    expect(fingerprintPayload({ a: [1, 2] })).not.toBe(base)
    expect(fingerprintPayload({ a: [2, 1, { c: 'x' }] })).not.toBe(base)
  })

  it('与 JSON.stringify 的语义对齐：数组里的 undefined、Date', () => {
    expect(canonicalPayloadString({ a: [1, undefined] })).toBe('{"a":[1,null]}')
    expect(canonicalPayloadString({ d: new Date('2026-09-22T14:00:00.000Z') })).toBe(
      '{"d":"2026-09-22T14:00:00.000Z"}'
    )
    expect(canonicalPayloadString({ n: Number.NaN, i: Infinity })).toBe('{"i":null,"n":null}')
  })

  it('Map / Set 与插入序无关', () => {
    const a = fingerprintPayload(new Map([['x', 1], ['y', 2]]))
    const b = fingerprintPayload(new Map([['y', 2], ['x', 1]]))
    expect(a).toBe(b)
    expect(fingerprintPayload(new Set([1, 2]))).toBe(fingerprintPayload(new Set([2, 1])))
    expect(fingerprintPayload(new Set([1, 2]))).not.toBe(fingerprintPayload(new Set([1, 3])))
  })

  it('同一个对象被引用两次不算循环引用（有向无环）', () => {
    const shared = { c: 1 }
    expect(() => fingerprintPayload({ a: shared, b: shared })).not.toThrow()
  })

  it('算不出来的载荷宁可报错，也不退化成常量指纹', () => {
    expect(() => fingerprintPayload({ fn: () => 1 })).toThrow(PayloadFingerprintError)
    expect(() => fingerprintPayload({ s: Symbol('x') })).toThrow(PayloadFingerprintError)
    expect(() => fingerprintPayload(new (class Room { room = 1 })())).toThrow(/实例/)
    expect(() => fingerprintPayload(new Date('nope'))).toThrow(PayloadFingerprintError)

    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    expect(() => fingerprintPayload(cyclic)).toThrow(/循环引用/)
  })

  it('超深嵌套报错而不是栈溢出', () => {
    let deep: Record<string, unknown> = { leaf: 1 }
    for (let i = 0; i < 40; i++) deep = { child: deep }
    expect(() => fingerprintPayload(deep)).toThrow(/嵌套/)
  })
})

// ---------------------------------------------------------------------------
// 包装器
// ---------------------------------------------------------------------------

type SubmitParams = {
  meetingName: string
  meetingRoomId: number
  startUserSelectAssignees?: Record<string, number[]>
}

describe('withIdempotency 包装器', () => {
  it('剥掉 requestId，不把它漏进请求', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn((params: SubmitParams) => Promise.resolve(params))

    const submit = withIdempotency<SubmitParams, SubmitParams>({
      store,
      capabilityId: 'meeting-application-submit',
      send,
    })

    await submit({ meetingName: '周会', meetingRoomId: 12, requestId: 'req-1' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toEqual({ meetingName: '周会', meetingRoomId: 12 })
    expect('requestId' in (send.mock.calls[0]?.[0] ?? {})).toBe(false)
  })

  it('同 requestId 重试只发一次；换 requestId 就是新意图', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn((_params: SubmitParams) => Promise.resolve({ id: 42 }))
    const submit = withIdempotency<SubmitParams, { id: number }>({
      store,
      capabilityId: 'meeting-application-submit',
      send,
    })

    const params = { meetingName: '周会', meetingRoomId: 12 }
    expect(await submit({ ...params, requestId: 'req-1' })).toEqual({ id: 42 })
    expect(await submit({ ...params, requestId: 'req-1' })).toEqual({ id: 42 })
    expect(send).toHaveBeenCalledTimes(1)

    await submit({ ...params, requestId: 'req-2' })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('身份每次调用现取：换了用户就不命中', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn(() => Promise.resolve({ id: 42 }))
    let userId = 7
    const submit = withIdempotency<SubmitParams, { id: number }>({
      store,
      capabilityId: 'meeting-application-submit',
      identity: () => ({ tenantId: 1001, userId }),
      send,
    })

    const params = { meetingName: '周会', meetingRoomId: 12, requestId: 'req-1' }
    await submit(params)
    await submit(params)
    expect(send).toHaveBeenCalledTimes(1)

    userId = 8 // 换人，同一个 requestId 也不能命中别人的结果
    await submit(params)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('target 进键：撤销不同的单据是两次写', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn(() => Promise.resolve('ok'))
    const cancel = withIdempotency<{ id: number }, string>({
      store,
      capabilityId: 'meeting-application-cancel',
      target: (params) => params.id,
      send,
    })

    await cancel({ id: 1, requestId: 'req-1' })
    await cancel({ id: 1, requestId: 'req-1' })
    expect(send).toHaveBeenCalledTimes(1)
    await cancel({ id: 2, requestId: 'req-1' })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('payload 里抛错（本地校验失败）不留记录，重试能过', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn((_params: SubmitParams) => Promise.resolve('ok'))
    let roomId = 0
    const submit = withIdempotency<SubmitParams, string>({
      store,
      capabilityId: 'meeting-application-submit',
      payload: (params) => {
        if (!params.meetingRoomId) throw new Error('会议室必选')
        return { meetingRoomId: params.meetingRoomId }
      },
      send,
    })

    const params = { meetingName: '周会', meetingRoomId: 0, requestId: 'req-1' }
    await expect(submit(params)).rejects.toThrow(/会议室必选/)
    expect(store.size).toBe(0)
    expect(send).not.toHaveBeenCalled()

    roomId = 12
    await expect(submit({ ...params, meetingRoomId: roomId })).resolves.toBe('ok')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('send 拿到的是被算指纹的那一份 payload（不是又构建了一份）', async () => {
    const store = new IdempotencyStore()
    let builds = 0
    let lastBuilt: unknown
    let sentCount = 0
    const submit = withIdempotency<SubmitParams, string>({
      store,
      capabilityId: 'meeting-application-submit',
      payload: (params) => {
        builds += 1
        lastBuilt = { name: params.meetingName }
        return lastBuilt
      },
      send: (_params, context) => {
        sentCount += 1
        expect(context.payload).toBe(lastBuilt)
        return Promise.resolve('ok')
      },
    })

    const params = { meetingName: '周会', meetingRoomId: 12, requestId: 'req-1' }
    await submit(params)
    expect(sentCount).toBe(1)

    await submit(params) // 命中记录：不发请求
    expect(sentCount).toBe(1)
    // payload 每次调用都会构建一次（这是"本地校验失败不留记录"的代价，见 writer.ts），
    // 但只有第一次那一份会真的发出去
    expect(builds).toBe(2)
    expect(store.size).toBe(1)
  })

  it('send 里的本地失败可以用 NotDispatchedError 换到重试机会', async () => {
    const store = new IdempotencyStore()
    const send = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new NotDispatchedError(new Error('服务端预检说不让写')))
      .mockResolvedValueOnce('ok')
    const submit = withIdempotency<SubmitParams, string>({
      store,
      capabilityId: 'meeting-application-submit',
      send,
    })

    const params = { meetingName: '周会', meetingRoomId: 12, requestId: 'req-1' }
    await expect(submit(params)).rejects.toThrow(NotDispatchedError)
    await expect(submit(params)).resolves.toBe('ok')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('requestId 不合法时直接抛错，且不发请求', async () => {
    const store = new IdempotencyStore()
    const send = vi.fn(() => Promise.resolve('ok'))
    const submit = withIdempotency<SubmitParams, string>({
      store,
      capabilityId: 'meeting-application-submit',
      send,
    })

    await expect(
      submit({ meetingName: '周会', meetingRoomId: 12, requestId: '有 空格' })
    ).rejects.toThrow(IdempotencyRequestIdError)
    expect(send).not.toHaveBeenCalled()
    expect(store.size).toBe(0)
  })

  it('构造时就拦住缺 capabilityId', () => {
    expect(() =>
      withIdempotency<SubmitParams, string>({
        store: new IdempotencyStore(),
        capabilityId: '  ',
        send: () => Promise.resolve('ok'),
      })
    ).toThrow(/capabilityId/)
  })
})
