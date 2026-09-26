import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'

/**
 * 逐字段基准回归（设计 D20）。
 *
 * 基准来自真实浏览器：用 bsk 在测试环境的会议室列表页点击「查询」时抓下的
 * 那一次请求（token 已在页面内脱敏，从未离开浏览器）。
 * 这条测试的作用是：SDK 发出的请求必须与浏览器发出的**逐字段一致**。
 */

type Baseline = {
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
  via: string
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline: Baseline = JSON.parse(
  readFileSync(join(here, '../baseline/meeting-room-page.browser.json'), 'utf8'),
)

/** 取 path + query，并把一次性时间戳参数归一化 */
function normalizeUrl (rawUrl: string): string {
  const withoutHost = rawUrl.replace(/^https?:\/\/[^/]+/, '')
  return withoutHost.replace(/([?&]_t=)\d+/, '$1<ts>')
}

/** 拆成有序的 [key, value] 列表，这样键顺序的差异也能被发现 */
function queryPairs (rawUrl: string): Array<[string, string]> {
  const query = rawUrl.split('?')[1] ?? ''
  if (!query) return []
  return query.split('&').map((part) => {
    const index = part.indexOf('=')
    const key = index === -1 ? part : part.slice(0, index)
    const value = index === -1 ? '' : part.slice(index + 1)
    return [key, key === '_t' ? '<ts>' : value] as [string, string]
  })
}

function captureSdkRequest () {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  return { sdk, calls }
}

describe('会议室列表 —— 与浏览器基准逐字段一致（D20）', () => {
  it('URL 的 path 与 query 与基准完全相同（含键顺序）', async () => {
    const { sdk, calls } = captureSdkRequest()

    await sdk.meetingRoom.list({ pageNo: 1, pageSize: 20 })

    const actual = String(calls[0]?.url)
    expect(queryPairs(actual)).toEqual(queryPairs(baseline.url))
    expect(normalizeUrl(actual)).toBe(normalizeUrl(baseline.url))
  })

  it('方法一致', async () => {
    const { sdk, calls } = captureSdkRequest()
    await sdk.meetingRoom.list({ pageNo: 1, pageSize: 20 })
    expect(String(calls[0]?.method).toUpperCase()).toBe(baseline.method.toUpperCase())
  })

  it('请求头一致（token 值不参与比对，基准里已脱敏）', async () => {
    const { sdk, calls } = captureSdkRequest()
    await sdk.meetingRoom.list({ pageNo: 1, pageSize: 20 })

    const actual = calls[0]?.headers as unknown as Record<string, string>
    const expected = baseline.headers

    // tenant-id / Accept-Language 必须一致
    expect(actual['tenant-id']).toBe(expected['tenant-id'])
    expect(actual['Accept-Language']).toBe(expected['Accept-Language'])

    // 浏览器与 SDK 都不发 module-type（该页面在规则表里算不出值，设计 D34）
    expect(actual).not.toHaveProperty('module-type')
    expect(expected).not.toHaveProperty('module-type')
  })

  it('GET 请求没有 body', async () => {
    const { sdk, calls } = captureSdkRequest()
    await sdk.meetingRoom.list({ pageNo: 1, pageSize: 20 })
    expect(baseline.body).toBeNull()
    expect(calls[0]?.data).toBeUndefined()
  })
})
