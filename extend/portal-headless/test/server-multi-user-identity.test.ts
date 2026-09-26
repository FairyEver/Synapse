import { describe, expect, it } from 'vitest'

import {
  createPortalServer,
  createRequestId,
  IdempotencyKeyReuseError,
} from '../src/index.js'
import type { PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequestFactory } from '../src/session/index.js'

/**
 * 多用户门面里，防重身份（`identity`）必须含 `userId`。
 *
 * 为什么单独一个文件：这条保障**只看代码看不出来有没有坏**。
 * 实测（2026-09-20）：把 `src/server.ts` 里 `assignment.createIdempotent` 的
 * `identity` 改成 `() => ({})`，整套 583 例**全绿**——两个用户撞同一个 `requestId`
 * 时，后来者会拿到前一个人的回执（载荷不同还会抛 `IdempotencyKeyReuseError`），
 * 而没有任何一条断言会响。
 *
 * 根因是「桩不掉」：`createPortalServer` 一份会话造一个 axios 实例，实例不对外暴露，
 * 所以请求层到不了。这里用 `sessionOptions.createRequest`（`src/server.ts` 的接缝）
 * 把请求层换成桩，才谈得上断言。
 *
 * 本文件**不碰** `src/capabilities/**`，走的是 `assignment.createIdempotent`
 * 这条已经接好线的写能力——测的正是 server.ts 里那两行 identity 接线。
 */

type Sent = { token: string; userIdHint: string; url: string; body: unknown }

/** 请求层桩：按凭据 token 记下这次请求，并按 token 回一个**可区分**的结果 */
function stubFactory (sent: Sent[]): PortalRequestFactory {
  return ({ credential }) =>
    <T = unknown>(requestConfig: PortalRequestConfig): Promise<T> => {
      sent.push({
        token: String(credential.token),
        userIdHint: String(credential.token),
        url: String(requestConfig.url ?? ''),
        body: requestConfig.data,
      })
      const value = String(requestConfig.url ?? '').includes('/sys/menu/nav')
        ? []
        : { id: `回执-${String(credential.token)}` }
      return Promise.resolve(value as T)
    }
}

/** 与 test/assignment.test.ts 同一份本地校验能过的载荷 */
const draft = {
  title: 'SDK-TEST-多用户身份',
  demand: 'SDK-TEST 多用户防重身份，可删除',
  type: 4,
  endTime: '2026-09-30 21:19:10',
}

function makeServer (sent: Sent[]) {
  return createPortalServer({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    // 唯一的改口：换掉请求层，其余（TTL / 容量 / 事件）全走默认
    sessionOptions: { createRequest: stubFactory(sent) },
  })
}

async function twoUsers (sent: Sent[]) {
  const server = makeServer(sent)
  // 同一个租户、不同用户：**只有** userId 能把这两份会话的身份分开
  const first = await server.forSession({
    userId: 'u1',
    credential: { token: 'tk-u1', tenantId: 7 },
    capabilities: [],
  })
  const second = await server.forSession({
    userId: 'u2',
    credential: { token: 'tk-u2', tenantId: 7 },
    capabilities: [],
  })
  return { server, first, second }
}

describe('多用户防重身份 —— 同一个 requestId 在两个用户上不互相命中', () => {
  it('正控制：同一份会话 + 同一个 requestId，只发一次、第二次是回放', async () => {
    const sent: Sent[] = []
    const { first } = await twoUsers(sent)
    const requestId = createRequestId()

    const one = await first.assignment.createIdempotent({ ...draft, requestId })
    const two = await first.assignment.createIdempotent({ ...draft, requestId })

    expect(sent).toHaveLength(1)
    expect(two).toEqual(one)
  })

  it('两个用户、同一租户、同一个 requestId：各自发一次，各自拿自己的回执', async () => {
    const sent: Sent[] = []
    const { first, second } = await twoUsers(sent)
    const requestId = createRequestId()

    const a = await first.assignment.createIdempotent({ ...draft, requestId })
    const b = await second.assignment.createIdempotent({ ...draft, requestId })

    // 少了 userId 时这里只会有 1 次请求，且 b 拿到的是 a 的回执（= 越权 + 假成功）
    expect(sent.map((one) => one.token)).toEqual(['tk-u1', 'tk-u2'])
    expect(a).toEqual({ id: '回执-tk-u1' })
    expect(b).toEqual({ id: '回执-tk-u2' })
  })

  it('两个用户撞同一个 requestId、载荷还不同时，不许抛 IdempotencyKeyReuseError', async () => {
    const sent: Sent[] = []
    const { first, second } = await twoUsers(sent)
    const requestId = createRequestId()

    await first.assignment.createIdempotent({ ...draft, requestId })
    // 串了键就会抛「同 key 不同载荷」——B 的写会被 A 的载荷挡住，且他自己什么也没写成
    await expect(
      second.assignment.createIdempotent({ ...draft, requestId, title: '另一个用户的另一份作业' }),
    ).resolves.toEqual({ id: '回执-tk-u2' })

    expect(sent).toHaveLength(2)
  })

  it('同一份会话换了载荷仍然是「键复用」——上一条不是因为防重坏了（反方向的对照）', async () => {
    const sent: Sent[] = []
    const { first } = await twoUsers(sent)
    const requestId = createRequestId()

    await first.assignment.createIdempotent({ ...draft, requestId })
    await expect(
      first.assignment.createIdempotent({ ...draft, requestId, title: '同一份会话换了载荷' }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError)

    expect(sent).toHaveLength(1)
  })

  it('同一会话跨多次 forSession 复用带本地缓存的公共能力实例', async () => {
    const sent: Sent[] = []
    const { server, first } = await twoUsers(sent)

    const firstTree = await first.baseShell.getMenuNav({ project: 2 })
    const second = await server.forSession({
      userId: 'u1',
      credential: { token: 'tk-u1', tenantId: 7 },
      capabilities: [],
    })
    const secondTree = await second.baseShell.getMenuNav({ project: 2 })

    expect(firstTree).toEqual(secondTree)
    expect(sent.filter((item) => item.url.includes('/sys/menu/nav'))).toHaveLength(1)
  })

  it('公共缓存只在已登记写入成功后失效：读POST不清、失败写不清', async () => {
    const sent: Sent[] = []
    let failWrite = false
    const server = createPortalServer({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      sessionOptions: {
        createRequest: ({ credential }) => async <T = unknown>(requestConfig: PortalRequestConfig): Promise<T> => {
          const url = String(requestConfig.url ?? '')
          sent.push({ token: String(credential.token), userIdHint: String(credential.token), url, body: requestConfig.data })
          if (url.includes('/dict-data/grouped-list')) {
            return [{ dictType: 'demo', dataList: [{ dictValue: 1, dictLabel: '演示' }] }] as T
          }
          if (url === '/sys/dict/data' && failWrite) {
            throw new Error('写入失败')
          }
          return true as T
        },
      },
    })
    const scoped = await server.forSession({
      userId: 'cache-user',
      credential: { token: 'tk-cache', tenantId: 7 },
      capabilities: [],
    })

    await scoped.baseData.getDict('demo')
    await scoped.call('/dashboard/flow/form/edit', { url: '/hr/meeting-application/prepare', method: 'post', data: {} })
    await scoped.baseData.getDict('demo')
    expect(sent.filter((item) => item.url.includes('/dict-data/grouped-list'))).toHaveLength(1)

    failWrite = true
    await expect(scoped.call('/dashboard/hr/setting/dict/data/items', { url: '/sys/dict/data', method: 'post', data: {} })).rejects.toThrow('写入失败')
    failWrite = false
    await scoped.baseData.getDict('demo')
    expect(sent.filter((item) => item.url.includes('/dict-data/grouped-list'))).toHaveLength(1)

    await scoped.call('/dashboard/hr/setting/dict/data/items', { url: '/sys/dict/data', method: 'post', data: {} })
    await scoped.baseData.getDict('demo')
    expect(sent.filter((item) => item.url.includes('/dict-data/grouped-list'))).toHaveLength(2)
  })

  it('长期复用同一 server/session 时，成功写入不会继续消费旧 scoped 字典索引', async () => {
    const sent: Sent[] = []
    let groupedLoads = 0
    const server = createPortalServer({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      sessionOptions: {
        createRequest: () => async <T = unknown>(requestConfig: PortalRequestConfig): Promise<T> => {
          const url = String(requestConfig.url ?? '')
          sent.push({ token: 'tk-scoped', userIdHint: 'scoped-user', url, body: requestConfig.data })
          if (url.includes('/dict-data/grouped-list')) {
            groupedLoads += 1
            return [{ dictType: 'demo', dataList: [{ label: `版本-${groupedLoads}`, value: groupedLoads }] }] as T
          }
          return true as T
        },
      },
    })
    const input = { userId: 'scoped-user', credential: { token: 'tk-scoped', tenantId: 7 }, capabilities: ['dict-hr'] }
    const first = await server.forSession(input)
    expect((await first.baseData.getDict('demo')).entries[0]?.label).toBe('版本-1')

    await first.call('/dashboard/hr/setting/dict/data/items', { url: '/sys/dict/data', method: 'post', data: {} })
    const second = await server.forSession(input)
    expect((await second.baseData.getDict('demo')).entries[0]?.label).toBe('版本-2')
    expect(sent.filter((item) => item.url.includes('/dict-data/grouped-list'))).toHaveLength(2)
  })

  it('显式 sessions.invalidateCapability 后，旧 scoped 字典索引不会被复用', async () => {
    const sent: Sent[] = []
    let groupedLoads = 0
    const server = createPortalServer({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      sessionOptions: {
        createRequest: () => async <T = unknown>(requestConfig: PortalRequestConfig): Promise<T> => {
          const url = String(requestConfig.url ?? '')
          sent.push({ token: 'tk-explicit', userIdHint: 'explicit-user', url, body: requestConfig.data })
          if (url.includes('/dict-data/grouped-list')) {
            groupedLoads += 1
            return [{ dictType: 'demo', dataList: [{ label: `版本-${groupedLoads}`, value: groupedLoads }] }] as T
          }
          return true as T
        },
      },
    })
    const input = { userId: 'explicit-user', credential: { token: 'tk-explicit', tenantId: 7 }, capabilities: ['dict-hr'] }
    const first = await server.forSession(input)
    expect((await first.baseData.getDict('demo')).entries[0]?.label).toBe('版本-1')

    expect(server.sessions.invalidateCapability({ userId: input.userId, tenantId: input.credential.tenantId }, 'dict-hr')).toBe(true)
    const second = await server.forSession(input)
    expect((await second.baseData.getDict('demo')).entries[0]?.label).toBe('版本-2')
    expect(sent.filter((item) => item.url.includes('/dict-data/grouped-list'))).toHaveLength(2)
  })
})
