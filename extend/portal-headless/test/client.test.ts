import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import { PortalApiError, PortalCredentialError } from '../src/http/errors.js'

type CapturedCall = InternalAxiosRequestConfig & PortalRequestConfig

function makeHttp (envelope: Record<string, unknown> = { ret: 'SUCCESS', code: 0, msg: '', data: { ok: true } }) {
  const calls: CapturedCall[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 7 },
  })

  http.defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    return {
      data: envelope,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }

  return { http, calls }
}

describe('请求侧：与 Portal 前端逐字段对齐（设计 D20）', () => {
  it('不以 /admin-api 开头的路径自动补前缀', async () => {
    const { http, calls } = makeHttp()
    await http.request({ url: '/hr/meeting-room/page', method: 'get' })
    expect(calls[0]?.url).toContain('/admin-api/hr/meeting-room/page')
  })

  it('已带 /admin-api 的路径不重复补', async () => {
    const { http, calls } = makeHttp()
    await http.request({ url: '/admin-api/hr/meeting-room/page', method: 'get' })
    expect(calls[0]?.url).not.toContain('/admin-api/admin-api')
  })

  it('/adminmanage-api 不补前缀', async () => {
    const { http, calls } = makeHttp()
    await http.request({ url: '/adminmanage-api/system/tenant/get', method: 'get' })
    expect(String(calls[0]?.url)).toMatch(/^\/adminmanage-api\/system\/tenant\/get(\?|$)/)
  })

  it('GET 参数被 qs 序列化进 URL、并附带 _t 防缓存参数、params 被清空', async () => {
    const { http, calls } = makeHttp()
    await http.request({ url: '/hr/meeting-room/page', method: 'get', params: { name: '301', pageNo: 1 } })

    const url = String(calls[0]?.url)
    expect(url).toContain('name=301')
    expect(url).toContain('pageNo=1')
    expect(url).toMatch(/_t=\d+/)
    expect(calls[0]?.params).toEqual({})
  })

  it('页面显式指定 paramsArrayFormat=repeat 时，数组按重复键序列化', async () => {
    const { http, calls } = makeHttp()
    await http.request({
      url: '/inventory/asset-stocktaking-config/page',
      method: 'get',
      params: { createTime: ['2026-09-01 00:00:00', '2026-09-24 23:59:59'] },
      paramsArrayFormat: 'repeat',
    } as PortalRequestConfig)

    const url = String(calls[0]?.url).replace(/_t=\d+/, '_t=<ts>')
    expect(url).toBe('/admin-api/inventory/asset-stocktaking-config/page?createTime=2026-09-01%2000%3A00%3A00&createTime=2026-09-24%2023%3A59%3A59&_t=<ts>')
    expect(calls[0]?.params).toEqual({})
  })

  // 这两条锁的是「URL 自带的 query 与 params 谁先谁后、冲突时谁赢」。
  // 依据是 platform.js:57-62 的 `{ ...config.params, ...qs.parse(fixParamsString) }`，
  // 以及课程域四页的实测 URL（baseline/study-course.browser.json 里 type 排在 _t 之后）。
  it('URL 自带 query 合在 params **之后**（与 platform.js:57-62 一致）', async () => {
    const { http, calls } = makeHttp()
    await http.request({
      url: '/study/course/studycourse/courseList?type=1',
      method: 'get',
      params: { order: '', orderField: '', pageNo: 1, pageSize: 20 },
    })

    const url = String(calls[0]?.url)
    // 逐字对齐浏览器的键顺序：params 全部在前，_t 之后才是 URL 自带的 type。
    // 把 _t 的值换成一个占位符再比，免得断言里再套一层正则。
    expect(url.replace(/_t=\d+/, '_t=<ts>')).toBe(
      '/admin-api/study/course/studycourse/courseList?order=&orderField=&pageNo=1&pageSize=20&_t=<ts>&type=1',
    )
  })

  it('URL 自带 query 与 params 冲突时，URL 上一方赢（与前端 spread 顺序一致）', async () => {
    const { http, calls } = makeHttp()
    await http.request({
      url: '/study/course/studycourse/courseList?type=1',
      method: 'get',
      params: { type: '999', pageNo: 1 },
    })

    // 前端写的是 `{ ...config.params, ...qs.parse(fixParamsString) }` —— inline 在后，赢的是它。
    // 旧实现（inline 在前）会发 type=999，且**不报任何错**。
    expect(String(calls[0]?.url)).toContain('type=1')
    expect(String(calls[0]?.url)).not.toContain('type=999')
  })

  it('注入 tenant-id / token / Accept-Language', async () => {
    const { http, calls } = makeHttp()
    await http.request({ url: '/hr/meeting-room/page', method: 'get' })

    const headers = calls[0]?.headers as Record<string, string>
    expect(headers['tenant-id']).toBe('7')
    expect(headers.token).toBe('tk-test')
    expect(headers['Accept-Language']).toBe('zh-CN')
  })

  it('moduleType 覆盖会写进 module-type 头', async () => {
    const { http, calls } = makeHttp()
    await http.request({ url: '/hr/meeting-room/page', method: 'get', moduleType: 41 } as PortalRequestConfig)

    const headers = calls[0]?.headers as Record<string, string>
    expect(headers['module-type']).toBe('41')
  })

  it('未指定 moduleType 时不写 module-type 头（设计 D34）', async () => {
    const { http, calls } = makeHttp()
    await http.request({ url: '/hr/meeting-room/page', method: 'get' })

    const headers = calls[0]?.headers as Record<string, string>
    expect(headers).not.toHaveProperty('module-type')
  })
})

describe('响应侧：包络 { ret, code, msg, data }', () => {
  it('ret === SUCCESS 时返回 data，而不是整个包络', async () => {
    const { http } = makeHttp({ ret: 'SUCCESS', code: 0, msg: 'ok', data: { list: [1, 2] } })
    const result = await http.request({ url: '/x', method: 'get' })
    expect(result).toEqual({ list: [1, 2] })
  })

  it('ret !== SUCCESS 时抛 PortalApiError，并带上 code / msg', async () => {
    const { http } = makeHttp({ ret: 'FAIL', code: 500, msg: '该时间段会议室已被预定', data: null })

    await expect(http.request({ url: '/x', method: 'get' })).rejects.toBeInstanceOf(PortalApiError)

    try {
      await http.request({ url: '/x', method: 'get' })
    } catch (error) {
      const apiError = error as PortalApiError
      expect(apiError.code).toBe(500)
      expect(apiError.message).toBe('该时间段会议室已被预定')
      expect(apiError.ret).toBe('FAIL')
    }
  })

  it('凭据类错误码单独抛出 PortalCredentialError（无头下没有登录页可跳，设计 H6）', async () => {
    const { http } = makeHttp({ ret: 'FAIL', code: 401, msg: '账号未登录', data: null })
    await expect(http.request({ url: '/x', method: 'get' })).rejects.toBeInstanceOf(PortalCredentialError)
  })
})
