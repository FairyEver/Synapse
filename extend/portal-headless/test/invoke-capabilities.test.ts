import { describe, expect, it } from 'vitest'
import type { AxiosInstance } from 'axios'

import {
  CapabilityInvokeError,
  CAPABILITY_BINDINGS,
  createPortalHeadless,
  createPortalServer,
  createRequestId,
} from '../src/index.js'

/**
 * G1：`capabilityId` 是唯一的调用句柄。
 *
 * 评测报告的原话：`describe()` 能让人想清楚"该做什么"，但 452 KB 的目录输出里
 * `meetingRoom` / `meetingApplication` 零出现——**没有任何一处告诉它这一次调用怎么发出去**。
 * 这组用例钉住两件事：
 * 1. `sdk.capabilities.invoke(id, args)` 真的把请求发出去了（走页面上下文、带 module-type）
 * 2. `describe().invoke.sdkPath` 与绑定表是同一份数据，不会各写一套
 */

type Stub = { calls: Array<{ url?: string; method?: string; headers: Record<string, string>; data?: unknown }> }

function stub (sdk: ReturnType<typeof createPortalHeadless>, data: unknown = {}): Stub {
  const calls: Stub['calls'] = []
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as never)
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  return { calls }
}

const config = { baseUrl: 'https://biz-api-test.wodecorp.cn', credential: { token: 't', tenantId: 1 } }

const draft = {
  meetingName: '周会',
  meetingRoomId: 5,
  startTime: '2026-09-22 14:00:00',
  endTime: '2026-09-22 15:00:00',
  attendeeCount: 2,
}

describe('G1 · capabilities.invoke —— 不用知道分组也能把调用发出去', () => {
  it('读能力：按能力 ID 调用，参数名就是 describe().params[].name', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, { list: [{ id: 5, name: '第一会议室' }], total: 1 })

    const page = await sdk.capabilities.invoke<{ list: Array<{ id: number }>; total: number }>(
      'meeting-room-list',
      { pageNo: 1, pageSize: 20 },
    )

    expect(page.total).toBe(1)
    expect(String(s.calls[0]?.url)).toContain('/hr/meeting-room/page')
    // renren 的默认空值参数还在（与浏览器逐字段一致，D20）——说明走的是能力那条路，
    // 不是在 invoke 里另拼了一个请求
    expect(String(s.calls[0]?.url)).toContain('order=')

    // 与手写路径发出的请求逐字段一致（`_t` 是客户端自己加的防缓存时间戳，去掉再比）
    const s2 = stub(sdk, { list: [], total: 0 })
    await sdk.meetingRoom.list({ pageNo: 1, pageSize: 20 })
    const stripCacheBuster = (url: string | undefined): string =>
      String(url).replace(/&?_t=\d+/, '')
    expect(stripCacheBuster(s2.calls[0]?.url)).toBe(stripCacheBuster(s.calls[0]?.url))
    expect(s2.calls[0]?.headers).toEqual(s.calls[0]?.headers)
  })

  it('读能力：date 这种"单参数"能力也按对象传，不用记方法签名', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, { organizationId: 1, meetingRooms: [] })

    await sdk.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })

    expect(String(s.calls[0]?.url)).toContain('/hr/meeting-application/meeting-room-usage')
    expect(String(s.calls[0]?.url)).toContain('date=2026-09-22')
  })

  it('process-definition / 用户候选这两个能力也接进来了', async () => {
    const sdk = createPortalHeadless(config)

    const s1 = stub(sdk, { key: 'meeting_application' })
    await sdk.capabilities.invoke('meeting-application-definition', { key: 'meeting_application' })
    expect(String(s1.calls[0]?.url)).toContain('/bpm/process-definition/get')

    const s2 = stub(sdk, { list: [], total: 0 })
    await sdk.capabilities.invoke('meeting-user-search', { keyword: '李', pageSize: 20 })
    expect(String(s2.calls[0]?.url)).toContain('/system/user/simple-page')
    expect(String(s2.calls[0]?.url)).toContain('nickname=')
  })

  it('prepare 归 prepare：invoke 只发只读的那一步，不会顺手提交', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, [])

    const out = await sdk.capabilities.invoke<{ tasks: unknown[] }>('meeting-application-prepare', draft)

    expect(out.tasks).toEqual([])
    expect(String(s.calls[0]?.url)).toContain('getRequiredStartUserSelectTasks')
    expect(s.calls.every((call) => !String(call.url).includes('/create'))).toBe(true)
  })
})

describe('G1 · 写能力经 invoke：幂等与三步分工不丢', () => {
  it('submit 必须带 requestId（缺了当场报错，不是静默地不做防重）', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, 42)

    await expect(sdk.capabilities.invoke('meeting-application-submit', draft)).rejects.toBeInstanceOf(
      CapabilityInvokeError,
    )
    expect(s.calls).toEqual([])
  })

  it('submit 同一个 requestId 重试：回放结果，不再发第二次请求', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, 42)
    const requestId = createRequestId()

    const first = await sdk.capabilities.invoke('meeting-application-submit', { ...draft, requestId })
    const retry = await sdk.capabilities.invoke('meeting-application-submit', { ...draft, requestId })

    expect(first).toBe(42)
    expect(retry).toBe(42)
    expect(s.calls.length).toBe(1)
    expect(String(s.calls[0]?.url)).toContain('/hr/meeting-application/create')
    // requestId 是 SDK 的元参数，不能漏进请求体（否则破坏与浏览器的逐字段一致，D20）
    expect(JSON.stringify(s.calls[0]?.data)).not.toContain(requestId)
  })

  it('同键换了载荷：直接抛错，不放过一次"看起来像重试"的新写入', async () => {
    const sdk = createPortalHeadless(config)
    stub(sdk, 42)
    const requestId = createRequestId()

    await sdk.capabilities.invoke('meeting-application-submit', { ...draft, requestId })
    await expect(
      sdk.capabilities.invoke('meeting-application-submit', { ...draft, requestId, meetingName: '别的会' }),
    ).rejects.toThrow(/requestId|载荷|键/)
  })

  it('cancel 用 submit 的返回值做 id；id 不对时给出明确错误而不是发出 /NaN', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, null)

    await sdk.capabilities.invoke('meeting-application-cancel', { id: 42 })
    expect(String(s.calls[0]?.url)).toContain('cancel-reservation/42')

    await expect(sdk.capabilities.invoke('meeting-application-cancel', {})).rejects.toBeInstanceOf(
      CapabilityInvokeError,
    )
    expect(s.calls.length).toBe(1)
  })
})

describe('G1 · 找不到 / 没接线时不能静默', () => {
  it('未登记的能力 ID：抛 CapabilityInvokeError，并把可调清单列出来', async () => {
    const sdk = createPortalHeadless(config)
    stub(sdk)

    await expect(sdk.capabilities.invoke('reimburse-submit', {})).rejects.toThrow(
      /reimburse-submit/,
    )
    await expect(sdk.capabilities.invoke('reimburse-submit', {})).rejects.toThrow(/meeting-room-list/)
  })

  it('空 ID 也报错，不会当成"调用全部能力"之类的东西', async () => {
    const sdk = createPortalHeadless(config)
    await expect(sdk.capabilities.invoke('   ')).rejects.toBeInstanceOf(CapabilityInvokeError)
  })

  it('A6 的 `xxx-llm` 写法与 describe 一样宽容', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, { organizationId: 1, meetingRooms: [] })

    await sdk.capabilities.invoke('meeting-room-usage-llm', { date: '2026-09-22' })

    expect(String(s.calls[0]?.url)).toContain('meeting-room-usage')
  })
})

describe('G1 · 两种入口是同一份实现', () => {
  it('describe().invoke.sdkPath 就是绑定表里的那条，且用它能调通同一个能力', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, { organizationId: 1, meetingRooms: [] })

    const described = sdk.catalog.describe('meeting-room-usage')
    expect(described.ok).toBe(true)
    if (!described.ok) return
    expect(described.invoke).toEqual({
      capabilityId: 'meeting-room-usage',
      sdkPath: 'meetingApplication.roomUsage',
    })

    // sdkPath 不是装饰：按它手写能拿到同一个返回
    const viaPath = await sdk.meetingApplication.roomUsage('2026-09-22')
    const viaInvoke = await sdk.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })
    expect(viaInvoke).toEqual(viaPath)
    expect(s.calls.length).toBe(2)
  })

  it('每个接线了的能力，describe 给出的 sdkPath 都与绑定表一致、且真的能在门面上解析到', () => {
    const sdk = createPortalHeadless(config)

    for (const binding of CAPABILITY_BINDINGS) {
      const described = sdk.catalog.describe(binding.capabilityId)
      expect(described.ok, `${binding.capabilityId} 在目录里不存在`).toBe(true)
      if (!described.ok) continue
      expect(described.invoke?.sdkPath, binding.capabilityId).toBe(binding.sdkPath)

      // sdkPath 是给人抄的：它必须真的能在门面上解析成一个方法（写错不会有运行时症状）
      const resolved = binding.sdkPath
        .split('.')
        .reduce<unknown>((host, key) => (host as Record<string, unknown> | undefined)?.[key], sdk)
      expect(typeof resolved, `${binding.sdkPath} 在门面上不是函数`).toBe('function')
    }
    // 反向：目录里没有"说能调、实际没接线"的能力（7 个定义 = 7 条绑定）
    expect(CAPABILITY_BINDINGS.map((binding) => binding.capabilityId).sort()).toEqual(
      sdk.capabilities.map((capability) => capability.id).sort(),
    )
  })

  it('capabilities 仍然是个数组：挂在上面的是不可枚举属性', () => {
    const sdk = createPortalHeadless(config)

    expect(Array.isArray(sdk.capabilities)).toBe(true)
    expect([...sdk.capabilities].length).toBeGreaterThan(0)
    expect(Object.keys(sdk.capabilities)).toEqual(sdk.capabilities.map((_, index) => String(index)))
    expect(typeof sdk.capabilities.invoke).toBe('function')
  })
})

/**
 * `docs/usage.md` §2.1 / §2.2 / §3 / §4 里新增的 invoke 用法，照着跑一遍。
 *
 * 为什么单独放（而不是并进 `test/usage-examples.test.ts`）：那是别人的文件，
 * 这次不动它；文档里的调用一旦过期，这组会先红。
 */
describe('G1 · docs/usage.md 里的 invoke 用例', () => {
  it('§2.1 两种入口是同一份实现', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, { organizationId: 1, meetingRooms: [] })

    const described = sdk.catalog.describe('meeting-room-usage')
    expect(described.ok).toBe(true)
    if (!described.ok) return
    expect(described.invoke).toEqual({
      capabilityId: 'meeting-room-usage',
      sdkPath: 'meetingApplication.roomUsage',
    })

    await sdk.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })
    await sdk.meetingApplication.roomUsage('2026-09-22')
    expect(s.calls.length).toBe(2)
  })

  it('§2.2 next[0] 就是首选边，且带 role', () => {
    const described = createPortalHeadless(config).catalog.describe('meeting-room-usage')
    expect(described.ok).toBe(true)
    if (!described.ok) return

    expect(described.next[0]?.role).toBe('next')
    expect(described.next[0]?.args?.capabilityId).toBe('meeting-application-prepare')
  })

  it('§3 写链路仍然是三步，且 submit 经 invoke 必须带 requestId', async () => {
    const sdk = createPortalHeadless(config)
    const s = stub(sdk, [])

    await sdk.capabilities.invoke('meeting-application-prepare', draft)
    expect(String(s.calls[0]?.url)).toContain('getRequiredStartUserSelectTasks')

    const requestId = createRequestId()
    await sdk.capabilities.invoke('meeting-application-submit', { ...draft, requestId })
    await sdk.capabilities.invoke('meeting-application-submit', { ...draft, requestId })
    expect(s.calls.length).toBe(2) // prepare + 一次真提交（第二次是回放）

    await sdk.capabilities.invoke('meeting-application-cancel', { id: 42 })
    expect(String(s.calls[2]?.url)).toContain('cancel-reservation/42')
  })

  it('§4 会话门面上的等价入口', async () => {
    const server = createPortalServer({ baseUrl: 'https://biz-api-test.wodecorp.cn' })
    const scoped = await server.forSession({
      userId: 'u1',
      credential: { token: 't', tenantId: 1 },
      capabilities: [],
    })

    expect(typeof scoped.capabilities.invoke).toBe('function')
    // 真的调用形状由下面「多用户门面等价」那一组覆盖（替换成桩方法，不发网络）
    const seen: string[] = []
    scoped.meetingApplication.roomUsage = async (date?: string) => {
      seen.push(String(date))
      return { meetingRooms: [] }
    }
    await scoped.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })
    expect(seen).toEqual(['2026-09-22'])
  })
})

describe('G1 · 多用户门面等价', () => {
  it('scoped.capabilities.invoke 走的是这份会话的能力方法', async () => {
    const server = createPortalServer({ baseUrl: 'https://biz-api-test.wodecorp.cn' })
    const scoped = await server.forSession({
      userId: 'u1',
      credential: { token: 't', tenantId: 1 },
      capabilities: [],
    })

    // 替换这份会话的能力方法：invoke 必须分发到**它**，而不是服务级或别人的
    const seen: string[] = []
    scoped.meetingApplication.roomUsage = async (date?: string) => {
      seen.push(String(date))
      return { meetingRooms: [] }
    }

    const out = await scoped.capabilities.invoke('meeting-room-usage', { date: '2026-09-22' })

    expect(seen).toEqual(['2026-09-22'])
    expect(out).toEqual({ meetingRooms: [] })
    expect(Array.isArray(scoped.capabilities)).toBe(true)
    expect(Object.keys(scoped.capabilities).length).toBe(scoped.capabilities.length)
  })

  it('另一份会话的同名能力互不影响（invoke 绑的是自己的那份）', async () => {
    const server = createPortalServer({ baseUrl: 'https://biz-api-test.wodecorp.cn' })
    const first = await server.forSession({
      userId: 'u1',
      credential: { token: 't1', tenantId: 1 },
      capabilities: [],
    })
    const second = await server.forSession({
      userId: 'u2',
      credential: { token: 't2', tenantId: 1 },
      capabilities: [],
    })

    const calls: string[] = []
    first.meetingApplication.roomUsage = async () => {
      calls.push('u1')
      return { meetingRooms: [] }
    }
    second.meetingApplication.roomUsage = async () => {
      calls.push('u2')
      return { meetingRooms: [] }
    }

    await first.capabilities.invoke('meeting-room-usage', {})
    await second.capabilities.invoke('meeting-room-usage', {})

    expect(calls).toEqual(['u1', 'u2'])
  })

  it('scoped 上未登记的能力同样抛错', async () => {
    const server = createPortalServer({ baseUrl: 'https://biz-api-test.wodecorp.cn' })
    const scoped = await server.forSession({
      userId: 'u1',
      credential: { token: 't', tenantId: 1 },
      capabilities: [],
    })

    await expect(scoped.capabilities.invoke('meeting-rom-list', {})).rejects.toBeInstanceOf(
      CapabilityInvokeError,
    )
  })
})
