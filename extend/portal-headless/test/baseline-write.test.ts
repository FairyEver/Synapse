import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'
import type { MeetingApplicationDraft } from '../src/index.js'

/**
 * 写链路的逐字段基准回归（设计 D20）。
 *
 * 基准来自真实浏览器：用 bsk 在测试环境的会议室预定表单上把会议名称、会议室、
 * 时间段、参会人数全部填好后点击「提交」，抓下的那次 create（token 已在页面内脱敏，
 * 从未离开浏览器）。抓取手法见 tools/baseline/README.md。
 *
 * 这条测试的作用与读链路相同：SDK 发出的请求必须与浏览器发出的**逐字段一致**。
 * 与 test/meeting-application-write.test.ts 的分工：那份管«载荷构造与业务规则»，
 * 这份管«与浏览器基准的逐字段一致性»。
 */

type Baseline = {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  via: string
  表单填写值: {
    meetingName: string
    meetingRoomId: number
    startTime: string
    endTime: string
    attendeeCount: number
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline: Baseline = JSON.parse(
  readFileSync(join(here, '../baseline/meeting-application-write.browser.json'), 'utf8'),
)

/**
 * 与基准同一份表单填写值。**写死**而不是从基准里读：基准是「浏览器发出去的」，
 * 这里是「SDK 发出去的」，两边各自独立取值才叫对照。下面的
 * «写死的表单填写值与基准里记的表单值一致» 负责兜住两边漂移。
 */
const draft: MeetingApplicationDraft = {
  meetingName: '无头SDK写基准-可删除',
  meetingRoomId: 5,
  startTime: '2026-09-22 14:00:00',
  endTime: '2026-09-22 15:00:00',
  attendeeCount: 2,
}

/** 基准里浏览器发的是空对象（会议室流程没有需要人工指定审批人的节点） */
const assignees = {}

/** 取 path + query；POST 不带 _t，但仍沿用与读链路相同的归一化写法 */
function normalizeUrl (rawUrl: string): string {
  const withoutHost = rawUrl.replace(/^https?:\/\/[^/]+/, '')
  return withoutHost.replace(/([?&]_t=)\d+/, '$1<ts>')
}

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
      data: { ret: 'SUCCESS', code: 0, msg: '', data: 51 },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  return { sdk, calls }
}

/** axios 在到达 adapter 前已按 transformRequest 把 body 序列化成字符串，这里原样取出 */
function rawBodyOf (config: InternalAxiosRequestConfig | undefined): string {
  const raw = config?.data
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

describe('会议室预定提交 —— 与浏览器基准逐字段一致（D20）', () => {
  it('上面写死的表单填写值与基准里记的表单值一致（两边不会各自漂移）', () => {
    expect(draft).toEqual({
      meetingName: baseline.表单填写值.meetingName,
      meetingRoomId: baseline.表单填写值.meetingRoomId,
      startTime: baseline.表单填写值.startTime,
      endTime: baseline.表单填写值.endTime,
      attendeeCount: baseline.表单填写值.attendeeCount,
    })
  })

  it('URL 与基准完全相同（path、query、无 _t 时间戳）', async () => {
    const { sdk, calls } = captureSdkRequest()

    await sdk.meetingApplication.submit(draft, assignees)

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(baseline.url))
    expect(queryPairs(actual)).toEqual(queryPairs(baseline.url))
    expect(actual).not.toContain('_t=')
  })

  it('方法一致', async () => {
    const { sdk, calls } = captureSdkRequest()
    await sdk.meetingApplication.submit(draft, assignees)
    expect(String(calls[0]?.method).toUpperCase()).toBe(baseline.method.toUpperCase())
  })

  it('请求体逐字段一致，且键顺序与浏览器相同', async () => {
    const { sdk, calls } = captureSdkRequest()
    await sdk.meetingApplication.submit(draft, assignees)

    const actual = rawBodyOf(calls[0])

    // 逐字段（含嵌套的 startUserSelectAssignees）
    expect(JSON.parse(actual)).toEqual(JSON.parse(baseline.body))
    // 键顺序：浏览器的 create body 是 id, meetingName, meetingRoomId, startTime,
    // endTime, attendeeCount, attendees, startUserSelectAssignees —— 顺序不同也算不一致
    expect(actual).toBe(baseline.body)
  })

  it('请求头与基准同一个集合（token 值不参与比对，基准里已脱敏）', async () => {
    const { sdk, calls } = captureSdkRequest()
    await sdk.meetingApplication.submit(draft, assignees)

    const actual = calls[0]?.headers as unknown as Record<string, string>
    const expected = baseline.headers

    // 浏览器发的每个头 SDK 都要发，且值一致
    expect(actual['tenant-id']).toBe(expected['tenant-id'])
    expect(actual['Accept-Language']).toBe(expected['Accept-Language'])
    expect(actual['Accept']).toBe(expected['Accept'])
    expect(String(actual['Content-Type'] ?? actual['content-type'])).toContain('application/json')

    // 反过来也不能多发：键集合要相同（token 存在即可，值不比对）
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort())

    // 该页面在规则表里算不出 module-type，浏览器与 SDK 都不发这个头（设计 D34）
    expect(actual).not.toHaveProperty('module-type')
    expect(expected).not.toHaveProperty('module-type')
  })
})
