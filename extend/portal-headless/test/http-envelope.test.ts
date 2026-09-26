import { describe, expect, it } from 'vitest'
import type { AxiosInstance, AxiosResponse } from 'axios'

import { applyEnvelope, createPortalHttp } from '../src/http/client.js'
import { PortalApiError, PortalCredentialError } from '../src/http/errors.js'
import { HTTP_INSTANCES } from '../src/context/http-instance.js'

/**
 * 四条响应包络规则，逐条钉住。
 *
 * 判据全部来自各实例响应拦截器的**原文**（出处写在 `http-instance.ts` 的
 * `HttpResponseEnvelope` 文档里）。这一份测试存在的理由：原先 SDK 只实现了
 * `portal-standard`，其余一律抛 —— 那对"没做"是对的，但用户 2026-09-21 要求
 * **按各实例自己的规则复刻**，于是这里把四条各自的边界都钉下来。
 */

const res = (body: unknown): AxiosResponse =>
  ({ data: body, status: 200, statusText: 'OK', headers: {}, config: {} }) as AxiosResponse

describe('① portal-standard（platform 那一族，14 个实例）', () => {
  it('ret === SUCCESS → 返回 data', () => {
    expect(applyEnvelope('portal-standard', res({ ret: 'SUCCESS', code: 0, data: { a: 1 } }), {})).toEqual({ a: 1 })
  })

  it('ret !== SUCCESS → PortalApiError（**不看 code 是不是 200**）', () => {
    expect(() => applyEnvelope('portal-standard', res({ ret: 'FAIL', code: 0, msg: '炸了' }), {})).toThrow(PortalApiError)
    // code 是 200 也照样失败 —— 这一族的判据只有 ret
    expect(() => applyEnvelope('portal-standard', res({ ret: 'FAIL', code: 200, msg: '炸了' }), {})).toThrow(PortalApiError)
  })

  it('凭据失效的 code 单独归类', () => {
    for (const code of [401, 10001, 1002015001]) {
      expect(() => applyEnvelope('portal-standard', res({ ret: 'FAIL', code, msg: '' }), {})).toThrow(PortalCredentialError)
    }
  })

  it('⚠️ **不看 pages** —— 这是它与 smart-layer 那一档的分界', () => {
    // portal-standard 的拦截器只 `return data`；漏给 data 时就是 undefined，
    // 哪怕包络里带着 pages。拿 pages 去补会让"后端没给 data"这件事被掩盖。
    expect(applyEnvelope('portal-standard', res({ ret: 'SUCCESS', code: 0, pages: { list: [1] } }), {})).toBeUndefined()
  })
})

describe('② smart-layer（smart-layer-admin / smart-layer-app）', () => {
  it('isOriginal → **原样返回整个响应体**（页面调这两页时都带它）', () => {
    const body = { code: 200, msg: 'ok', data: { a: 1 }, pages: { list: [] } }
    expect(applyEnvelope('smart-layer', res(body), { isOriginal: true })).toEqual(body)
  })

  it('code === undefined → 原样返回（智慧蛋鸡部分接口不返回 code）', () => {
    const body = { foo: 'bar' }
    expect(applyEnvelope('smart-layer', res(body), {})).toEqual(body)
  })

  it('code !== 200 → 失败；code === 200 → 返回 data', () => {
    expect(() => applyEnvelope('smart-layer', res({ code: 500, msg: '炸了' }), {})).toThrow(PortalApiError)
    expect(applyEnvelope('smart-layer', res({ code: 200, data: { a: 1 } }), {})).toEqual({ a: 1 })
  })

  it('⚠️ **完全不看 ret** —— ret 是 FAIL 但 code 是 200，照样返回 data', () => {
    // 这是最容易照抄错的一处：这一族的判据是 code，不是 ret。
    // 按 portal-standard 去套会把这里判成失败。
    expect(applyEnvelope('smart-layer', res({ ret: 'FAIL', code: 200, data: { a: 1 } }), {})).toEqual({ a: 1 })
  })

  it('⚠️ **没有 data 时退到 pages**（不是返回 undefined）', () => {
    // 拦截器最后一句是 `return data ? data : pages`。少了这一条，分页接口会整个变空。
    expect(applyEnvelope('smart-layer', res({ code: 200, pages: { list: [1, 2], total: 2 } }), {})).toEqual({
      list: [1, 2],
      total: 2,
    })
  })

  it('data 是假值（0 / 空串）时也退到 pages —— 判据是 `data ?`，不是 `data !== undefined`', () => {
    expect(applyEnvelope('smart-layer', res({ code: 200, data: 0, pages: { list: [] } }), {})).toEqual({ list: [] })
  })
})

describe('③ zhdj-sms（两段判据；**"谁先谁后"是等价变异，别去钉它**）', () => {
  it('ret !== SUCCESS 且 code !== 200 → 失败', () => {
    expect(() => applyEnvelope('zhdj-sms', res({ ret: 'FAIL', code: 500, msg: '炸了' }), {})).toThrow(PortalApiError)
  })

  it('⚠️ ret !== SUCCESS 但 **code === 200** → **不抛**，继续走 code 分支', () => {
    // `zhdj-sms.js:47-53`：`if (ret !== 'SUCCESS') { if (code !== 200) {...throw} ... }`
    // —— code 是 200 时那个 if 整个不进去，于是往下走、最后返回 data。
    // 与 portal-standard 正相反（那边 ret 一失败就抛）。
    //
    // 反证时试过把两段对调：**穷举 7 种 ret/code 组合行为完全一致**，是个等价变异。
    // 所以"两段顺序"不是契约，**这一条（code===200 时不抛）才是**。
    expect(applyEnvelope('zhdj-sms', res({ ret: 'FAIL', code: 200, data: { a: 1 } }), {})).toEqual({ a: 1 })
  })

  it('ret === SUCCESS 且 code === 200 → 返回 data', () => {
    expect(applyEnvelope('zhdj-sms', res({ ret: 'SUCCESS', code: 200, data: { a: 1 } }), {})).toEqual({ a: 1 })
  })

  it('isOriginal → 原样返回整个响应体', () => {
    const body = { ret: 'SUCCESS', code: 200, data: { a: 1 } }
    expect(applyEnvelope('zhdj-sms', res(body), { isOriginal: true })).toEqual(body)
  })

  it('⚠️ 没有 code 时**不是无条件放行** —— 先看 ret', () => {
    // 与 smart-layer 那一档**不一样**：smart-layer 的 `code === undefined` 直接放行，
    // 而 zhdj-sms 的 `code === undefined` 是**排在 ret 判据后面**的第二道。
    // 所以没有 ret 又没有 code 的裸响应，在 zhdj-sms 下是**失败**（先撞 ret 那一关）。
    expect(() => applyEnvelope('zhdj-sms', res({ foo: 1 }), {})).toThrow(PortalApiError)
    // 只有 `ret === 'SUCCESS'` 时，那个 `code === undefined` 的放行才够得着
    expect(applyEnvelope('zhdj-sms', res({ ret: 'SUCCESS', foo: 1 }), {})).toEqual({ ret: 'SUCCESS', foo: 1 })
  })

  it('没有 data 时同样退到 pages', () => {
    expect(applyEnvelope('zhdj-sms', res({ ret: 'SUCCESS', code: 200, pages: { list: [1] } }), {})).toEqual({ list: [1] })
  })

  it('凭据失效的 code 也归类（401 / 10001）', () => {
    expect(() => applyEnvelope('zhdj-sms', res({ ret: 'FAIL', code: 401, msg: '' }), {})).toThrow(PortalCredentialError)
    expect(() => applyEnvelope('zhdj-sms', res({ ret: 'FAIL', code: 10001, msg: '' }), {})).toThrow(PortalCredentialError)
  })
})

describe('④ mall-app（判据是 `Number(code) !== 0`）', () => {
  it('code === 0 → 返回 data', () => {
    expect(applyEnvelope('mall-app', res({ code: 0, data: { a: 1 } }), {})).toEqual({ a: 1 })
  })

  it('**code 是字符串 "0" 也算成功** —— 判据里套了 Number()', () => {
    expect(applyEnvelope('mall-app', res({ code: '0', data: { a: 1 } }), {})).toEqual({ a: 1 })
  })

  it('code !== 0 → 失败；**不看 ret**', () => {
    expect(() => applyEnvelope('mall-app', res({ ret: 'SUCCESS', code: 200, msg: '炸了' }), {})).toThrow(PortalApiError)
    expect(() => applyEnvelope('mall-app', res({ code: -1, msg: '炸了' }), {})).toThrow(PortalApiError)
  })

  it('没有 code 字段时按 `Number(undefined) !== 0` 判 —— 也就是**失败**', () => {
    expect(() => applyEnvelope('mall-app', res({ data: { a: 1 } }), {})).toThrow(PortalApiError)
  })

  it('⚠️ **不退到 pages** —— 它的拦截器只 `return data`', () => {
    expect(applyEnvelope('mall-app', res({ code: 0, pages: { list: [1] } }), {})).toBeUndefined()
  })
})

describe('实例表：四条规则各有实例在用，没有一条是摆设', () => {
  it('18 个实例的包络取值都在四档之内', () => {
    const allowed = new Set(['portal-standard', 'smart-layer', 'zhdj-sms', 'mall-app'])
    for (const profile of HTTP_INSTANCES) {
      expect(allowed.has(profile.responseEnvelope), `${profile.id} 的包络值不认识`).toBe(true)
    }
  })

  it('四个非 portal-standard 的实例各自落在对的那一档', () => {
    const byId = new Map(HTTP_INSTANCES.map((p) => [p.id, p.responseEnvelope]))
    expect(byId.get('smart-layer-admin')).toBe('smart-layer')
    expect(byId.get('smart-layer-app')).toBe('smart-layer')
    expect(byId.get('zhdj-sms')).toBe('zhdj-sms')
    expect(byId.get('mall-app')).toBe('mall-app')
  })
})

describe('端到端：经 createPortalHttp 真的按实例规则拆（不只是单测那个纯函数）', () => {
  function make (body: unknown, httpInstance?: string) {
    const http: AxiosInstance = createPortalHttp({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 7 },
    })
    http.defaults.adapter = async (config) => ({
      data: body,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
    return http.request({ url: '/x', method: 'get', httpInstance } as never)
  }

  it('smart-layer-admin → 按它自己的规则拆（data 优先、pages 兜底）', async () => {
    const body = { code: 200, msg: '', data: { page: { results: [1], totalRecord: 1 }, header: { ret: 'SUCCESS' } } }
    const result = await make(body, 'smart-layer-admin')
    // 注意：这里**没有**传 isOriginal，所以走的是 data ? data : pages 那一支
    expect(result).toEqual({ page: { results: [1], totalRecord: 1 }, header: { ret: 'SUCCESS' } })
  })

  it('换一个实例（smart-layer-admin → platform）结论会不一样：同一份 body 被判成失败', async () => {
    // 这条是**反证**：body 里没有 `ret`，而 platform 那一族的判据是 `ret !== 'SUCCESS'`，
    // 所以同一份响应在 platform 下是失败、在 smart-layer 下是成功。
    // 这说明"按实例自己的规则拆"不是可选项。
    await expect(make({ code: 200, data: { a: 1 } }, 'smart-layer-admin')).resolves.toEqual({ a: 1 })
    await expect(make({ code: 200, data: { a: 1 } }, undefined)).rejects.toBeInstanceOf(PortalApiError)
  })
})
