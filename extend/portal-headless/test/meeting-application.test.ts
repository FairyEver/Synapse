import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import { createPortalHeadless } from '../src/index.js'

/**
 * 会议室预定表单（/simple/hr/form/033）—— 第二条业务线。
 *
 * 基准是打开该表单时浏览器真实发出的请求序列（bsk 抓取，token 页面内脱敏）。
 */

type BaselineRequest = { 于: string; u: string; via: string; headers: Record<string, string>; 次数?: number }
type Baseline = { 请求: BaselineRequest[] }

const here = dirname(fileURLToPath(import.meta.url))
const baseline: Baseline = JSON.parse(
  readFileSync(join(here, '../baseline/meeting-application-form.browser.json'), 'utf8'),
)

/** 去掉主机与一次性时间戳，只留 path + query */
function normalize (rawUrl: string): string {
  return rawUrl
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/([?&]_t=)\d+/, '$1<ts>')
}

const baselineUrls = new Set(baseline.请求.map((r) => normalize(r.u)))

function captureSdk () {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: {} },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  return { sdk, calls }
}

describe('会议室预定表单 —— 与浏览器基准一致', () => {
  it('流程定义请求与基准一致', async () => {
    const { sdk, calls } = captureSdk()
    await sdk.meetingApplication.definition()

    const actual = normalize(String(calls[0]?.url))
    expect(actual).toBe('/admin-api/bpm/process-definition/get?key=meeting_application&_t=<ts>')
    expect(baselineUrls.has(actual)).toBe(true)
  })

  it('会议室占用请求打的是 meeting-application 下的路径，不是 meeting-room 下的', async () => {
    const { sdk, calls } = captureSdk()
    await sdk.meetingApplication.roomUsage()

    const actual = normalize(String(calls[0]?.url))
    expect(actual).toBe('/admin-api/hr/meeting-application/meeting-room-usage?_t=<ts>')
    expect(baselineUrls.has(actual)).toBe(true)
    // 曾经的错误写法，必须不再出现
    expect(actual).not.toContain('/hr/meeting-room-usage')
  })

  it('用户下拉走的是 simple-page', async () => {
    const { sdk, calls } = captureSdk()
    await sdk.meetingApplication.searchUsers({ keyword: '李' })

    const actual = normalize(String(calls[0]?.url))
    expect(actual).toContain('/admin-api/system/user/simple-page')
    expect(actual).toContain('nickname=')
  })
})

describe('长选项参数的保护（设计 D6 / H35）', () => {
  it('无关键字、无部门时拒绝调用', async () => {
    const { sdk, calls } = captureSdk()
    await expect(sdk.meetingApplication.searchUsers({})).rejects.toThrow(/长选项参数/)
    expect(calls).toHaveLength(0)
  })

  it('pageSize = -1（全量拉取）被拒绝', async () => {
    const { sdk, calls } = captureSdk()
    await expect(
      sdk.meetingApplication.searchUsers({ keyword: '李', pageSize: -1 }),
    ).rejects.toThrow(/全量拉取/)
    expect(calls).toHaveLength(0)
  })

  it('给了部门也可以查（用户不知道关键字时的兜底路径）', async () => {
    const { sdk, calls } = captureSdk()
    await sdk.meetingApplication.searchUsers({ deptId: 100 })
    expect(normalize(String(calls[0]?.url))).toContain('deptId=100')
  })
})

describe('基准本身记录了页面「全量拉用户」的行为', () => {
  it('基准里存在 pageSize=500 的 simple-page 请求，且重复多次', () => {
    const pulls = baseline.请求.filter((r) => r.u.includes('/system/user/simple-page'))
    expect(pulls.length).toBeGreaterThan(0)
    expect(pulls[0]?.u).toContain('pageSize=500')
    expect(pulls[0]?.次数 ?? 1).toBeGreaterThan(1)
  })
})
