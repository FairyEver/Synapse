import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPageCall } from '../src/call.js'
import {
  createPortalHttp,
  type PortalRequestConfig,
} from '../src/http/client.js'
import {
  HttpInstanceResolutionError,
  resolveHttpInstance,
  type HttpInstanceResolutionError as HttpInstanceResolutionErrorType,
} from '../src/context/http-instance.js'

/**
 * 「页面 → http 实例」在**请求层**的落地。
 *
 * 两个回归底线：
 * 1. 页面没规则 / 规则是默认实例时，发出的请求与 SDK 改造前**逐字段一致**
 *    （`test/baseline.test.ts` 拿真实浏览器抓的请求钉着，这里补上 call() 这一层）
 * 2. 解析不到实例时**不发请求**——这是与 module-type 的 D34 刻意相反的地方
 */

type Captured = InternalAxiosRequestConfig & PortalRequestConfig

const SALE_BASE = 'https://biz-api-test.wodecorp.cn/admin-shop-api'

function makeCall (options?: Parameters<typeof createPageCall>[2]) {
  const calls: Captured[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 7 },
  })
  http.defaults.adapter = async (config) => {
    calls.push(config as Captured)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(
    <T>(requestConfig: PortalRequestConfig) =>
      http.request(requestConfig as never) as unknown as Promise<T>,
    undefined,
    options,
  )
  return { call, calls }
}

describe('默认实例：与改造前逐字段一致', () => {
  it('没有页面规则的页面，url / 头 / 序列化方式一个字节都不变', async () => {
    const { call, calls } = makeCall()
    await call('/dashboard/meeting-room/list', {
      url: '/hr/meeting-room/page',
      method: 'get',
      params: { order: '', orderField: '', name: '', pageNo: 1, pageSize: 20 },
    })

    const config = calls[0]
    expect(config?.baseURL).toBe('https://biz-api-test.wodecorp.cn')
    // platform.js 的补前缀 + qs 序列化（key 顺序也保持）
    expect(String(config?.url)).toMatch(
      /^\/admin-api\/hr\/meeting-room\/page\?order=&orderField=&name=&pageNo=1&pageSize=20&_t=\d+$/,
    )
    expect(config?.params).toEqual({})
    expect(config?.httpInstance).toBeUndefined()

    const headers = config?.headers as unknown as Record<string, string>
    expect(headers['tenant-id']).toBe('7')
    expect(headers.token).toBe('tk-test')
    expect(headers['Accept-Language']).toBe('zh-CN')
    expect(headers).not.toHaveProperty('module-type')
  })

  it('页面规则指向默认实例时也走同一条路（显式传 platform 的页面）', async () => {
    const { call, calls } = makeCall()
    await call('/dashboard/hr/setting/menu/list', { url: '/sys/menu/page', method: 'get' })
    expect(String(calls[0]?.url)).toMatch(/^\/admin-api\/sys\/menu\/page\?/)
    expect(calls[0]?.httpInstance).toBeUndefined()
  })

  it('已上线的两个能力所在页面都解析到默认实例——所以它们一个字节都没动', async () => {
    // 这两个页面一旦落进页面规则表，既有能力就会开始要求 baseUrls，那是回归
    for (const pagePath of ['/dashboard/meeting-room/list', '/dashboard/flow/form/edit']) {
      const result = resolveHttpInstance({ pagePath })
      expect(result, pagePath).toMatchObject({ matchedBy: 'global-default', instance: { id: 'platform' } })
    }
  })
})

describe('解析不到实例：失败关闭，不发请求', () => {
  it('页面规则指向 sale，但没配 base URL → 抛，且一个请求都没发', () => {
    const { call, calls } = makeCall()
    expect(() =>
      call('/dashboard/sale/goods/classification/list', { url: '/goods/classification/page', method: 'get' }),
    ).toThrow(HttpInstanceResolutionError)
    expect(calls).toHaveLength(0)
  })

  it('错误里说清是哪个实例、base 该配在哪', () => {
    const { call } = makeCall()
    try {
      call('/dashboard/sale/goods/classification/list', { url: '/x', method: 'get' })
      expect.unreachable('应当抛')
    } catch (error) {
      const err = error as HttpInstanceResolutionErrorType
      expect(err.reason).toBe('missing-base-url')
      expect(err.message).toContain('sale')
      expect(err.message).toContain("baseUrls['sale']")
      expect(err.message).toContain('app/portal/utils/http/sale.js')
    }
  })

  it('未知实例 id → 抛 unknown-instance-id', () => {
    const { call, calls } = makeCall()
    try {
      call('/dashboard/meeting-room/list', {
        url: '/x',
        method: 'get',
        httpInstance: 'sale-mall',
      })
      expect.unreachable('应当抛')
    } catch (error) {
      expect((error as HttpInstanceResolutionErrorType).reason).toBe('unknown-instance-id')
    }
    expect(calls).toHaveLength(0)
  })

  it('onUnresolvedInstance: "assume-default" 是唯一的退路，且是显式开的', async () => {
    const { call, calls } = makeCall({ onUnresolvedInstance: 'assume-default' })
    await call('/dashboard/sale/goods/classification/list', {
      url: '/goods/classification/page',
      method: 'get',
      params: { pageSize: 20 },
    })
    // 静默打到默认实例——这正是那条规则想避免的结果，所以必须显式 opt-in
    expect(calls[0]?.baseURL).toBe('https://biz-api-test.wodecorp.cn')
    expect(calls[0]?.httpInstance).toBeUndefined()
  })
})

describe('sale 实例：baseURL / 不补前缀 / pageSize 改名', () => {
  const options = { baseUrls: { sale: SALE_BASE } }

  it('打到 admin-shop-api，路径**不**补 /admin-api，pageSize 改名成 limit', async () => {
    const { call, calls } = makeCall(options)
    await call('/dashboard/sale/goods/classification/list', {
      url: '/admin/goods/classification/page',
      method: 'get',
      params: { order: '', orderField: '', pageNo: 1, pageSize: 20 },
    })

    const config = calls[0]
    expect(config?.baseURL).toBe(SALE_BASE)
    expect(config?.httpInstance).toBe('sale')
    // 关键：sale.js 没有补前缀拦截器，url 原样
    expect(String(config?.url)).toBe('/admin/goods/classification/page')
    // sale.js 的拦截器把 pageSize 改名成 limit（sale.js:38-41）
    expect(config?.params).toEqual({
      order: '',
      orderField: '',
      pageNo: 1,
      limit: 20,
      _t: expect.any(Number),
    })
  })

  it('sale 实例不用 qs 把 params 拼进 url——params 留在 config.params，交给 axios 序列化器', async () => {
    const { call, calls } = makeCall(options)
    await call('/dashboard/sale/goods/classification/list', {
      url: '/admin/goods/classification/page',
      method: 'get',
      params: { pageNo: 1, pageSize: 20 },
    })
    expect(calls[0]?.params).toEqual({ pageNo: 1, limit: 20, _t: expect.any(Number) })
    // 与默认实例形成对照：platform 会把 params 序列化进 url 并把 params 清空
    expect(String(calls[0]?.url)).not.toContain('?')
  })

  it('POST 的 body 里 pageSize 也会被改名（sale.js:48-51）', async () => {
    const { call, calls } = makeCall(options)
    await call('/dashboard/sale/goods/classification/list', {
      url: '/admin/goods/classification/page',
      method: 'post',
      data: { pageNo: 1, pageSize: 50, name: 'x' },
    })
    // 适配器拿到的是 axios transformRequest 之后的 body（JSON 串）
    expect(JSON.parse(String(calls[0]?.data))).toEqual({ pageNo: 1, name: 'x', limit: 50 })
  })

  it('请求级显式声明实例优先于页面规则：非规则页也能走 sale', async () => {
    const { call, calls } = makeCall(options)
    await call('/dashboard/meeting-room/list', {
      url: '/admin/x/page',
      method: 'get',
      httpInstance: 'sale',
    })
    expect(calls[0]?.baseURL).toBe(SALE_BASE)
    expect(calls[0]?.httpInstance).toBe('sale')
  })

  it('请求上直接给 baseURL 也能走通，不必配在 options 里', async () => {
    const { call, calls } = makeCall()
    await call('/dashboard/sale/goods/classification/list', {
      url: '/admin/x/page',
      method: 'get',
      baseURL: SALE_BASE,
    })
    expect(calls[0]?.baseURL).toBe(SALE_BASE)
  })
})

describe('其余实例的画像也真的生效', () => {
  it('product：额外发 devicetype: PC', async () => {
    const { call, calls } = makeCall({ baseUrls: { product: 'https://fmtest.zhihuidanji.com/flockSimu' } })
    await call('/dashboard/meeting-room/list', {
      url: '/x/page',
      method: 'get',
      httpInstance: 'product',
    })
    const headers = calls[0]?.headers as unknown as Record<string, string>
    expect(headers.devicetype).toBe('PC')
  })

  it('platform-mall-mes：只有 token 与 Accept-Language，**没有** tenant-id / module-type', async () => {
    const { call, calls } = makeCall({ baseUrls: { 'platform-mall-mes': 'https://ptmtest.wodecorp.cn/PoultryMes' } })
    await call('/dashboard/platform/market/user-log/list', {
      url: '/x/list',
      method: 'get',
      moduleType: 41,
    })
    const headers = calls[0]?.headers as unknown as Record<string, string>
    expect(headers.token).toBe('tk-test')
    expect(headers['Accept-Language']).toBe('zh-CN')
    expect(headers).not.toHaveProperty('tenant-id')
    expect(headers).not.toHaveProperty('module-type')
  })

  it('mall-app 那条路已经按它自己的规则复刻：`Number(code) !== 0` 判失败，能发出去', async () => {
    // 这一条原来钉的是「SDK 直接拒绝 mall-app（没复刻它的包络）」。
    // 用户 2026-09-21 要求**按各实例自己的规则复刻**，所以它变成了"确实发出去、
    // 并按 mall-app 的判据拆包络"。四条规则各自的用例在 `test/http-envelope.test.ts`。
    const { call, calls } = makeCall({ baseUrls: { 'mall-app': 'https://biz-api-test.wodecorp.cn/mall-api' } })
    const result = await call('/dashboard/meeting-room/list', {
      url: '/x',
      method: 'get',
      httpInstance: 'mall-app',
    })
    expect(calls).toHaveLength(1)
    expect(result).toEqual({ list: [], total: 0 }) // makeCall 的默认包络 data 就是它
  })
})
