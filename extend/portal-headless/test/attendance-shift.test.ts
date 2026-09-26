import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import {
  assertClockTime,
  assertNoStatusParam,
  ATTENDANCE_SHIFT_MODULE_TYPE,
  ATTENDANCE_SHIFT_PAGE_PATH,
  attendanceShiftCapabilities,
  buildShiftPayload,
  createAttendanceShiftCapability,
  SHIFT_NAME_MAX_LENGTH,
  type AttendanceShiftDraft,
} from '../src/capabilities/attendance-shift.js'
import { createPortalHeadless } from '../src/index.js'

/**
 * 班次管理（`/dashboard/attendance/attendance-shift/list`）的回归测试。
 *
 * 分工与前面几条线一致：这份管«载荷构造、参数契约、与浏览器基准的逐字段一致性»；
 * 真实环境的读写验证在 `smoke/read-attendance-shift.mjs` 与
 * `smoke/attendance-shift-crud.mjs`（后者会真的建记录并清理）。
 *
 * 基准：`baseline/attendance-shift.browser.json` —— 同一份文件里同时有读 2 条与写 3 条，
 * 按「能力」字段取用。
 */

type BaselineRequest = {
  name: string
  能力: string
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline = JSON.parse(
  readFileSync(join(here, '../baseline/attendance-shift.browser.json'), 'utf8'),
) as { requests: BaselineRequest[] }

const LIST = baseline.requests[0]!
const LIST_BY_NAME = baseline.requests[1]!
const CREATE = baseline.requests[2]!
const UPDATE = baseline.requests[3]!
const REMOVE = baseline.requests[4]!

/** 取 path + query，并把一次性时间戳参数归一化 */
function normalizeUrl (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

/** 拆成有序的 [key, value] 列表：键顺序的差异也要能被发现（renren 靠同序做到逐字段一致） */
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

/** axios 在到达 adapter 前已按 transformRequest 把 body 序列化成字符串 */
function rawBodyOf (config: InternalAxiosRequestConfig | undefined): string {
  const raw = config?.data
  if (typeof raw === 'string') return raw
  return JSON.stringify(raw)
}

function makeSdk (data: unknown = { list: [], total: 0 }) {
  const calls: InternalAxiosRequestConfig[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config)
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  const capability = createAttendanceShiftCapability((config) =>
    sdk.call(ATTENDANCE_SHIFT_PAGE_PATH, config),
  )
  return { sdk, calls, capability }
}

/** 与写基准同一份填写值。**写死**而不是从基准里读：基准是「浏览器发出去的」， */
/** 拿它反推载荷就等于用答案验答案。 */
const DRAFT: AttendanceShiftDraft = {
  name: 'SDK-TEST-班次基准',
  morningStartTime: '08:00:00',
  morningEndTime: '11:30:00',
  afternoonStartTime: '13:00:00',
  afternoonEndTime: '17:00:00',
}

describe('班次列表 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选条件时的 URL：path 与 query 与基准完全相同（含键顺序）', async () => {
    const { capability, calls } = makeSdk()

    await capability.list()

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(LIST.url))
    expect(queryPairs(actual)).toEqual(queryPairs(LIST.url))
  })

  it('表单初值为 null 的 name 不发（qs 的 skipNulls）——浏览器在没填时也不发', async () => {
    const { capability, calls } = makeSdk()

    await capability.list()

    expect(String(calls[0]?.url)).not.toContain('name=')
  })

  it('按名称查询时的 URL 与基准一致（name 落在 orderField 之后、pageNo 之前）', async () => {
    const { capability, calls } = makeSdk()

    await capability.list({ name: '班' })

    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(LIST_BY_NAME.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(LIST_BY_NAME.url))
  })

  it('参数顺序由契约决定，不随调用方实参的书写顺序改变', async () => {
    const { capability, calls } = makeSdk()

    // 故意倒着写实参
    await capability.list({ pageSize: 20, pageNo: 1, name: '班' })

    expect(queryPairs(String(calls[0]?.url)).map(([key]) => key)).toEqual([
      'order',
      'orderField',
      'name',
      'pageNo',
      'pageSize',
      '_t',
    ])
  })

  it('方法、请求头与基准一致（module-type 由页面推导出 11，浏览器在列表页发的也是 11）', async () => {
    const { capability, calls } = makeSdk()

    await capability.list()

    expect(String(calls[0]?.method).toUpperCase()).toBe(LIST.method)

    // axios 的 header bag 里会多带一个值为 undefined 的 `Content-Type` 槽位
    // （own key 里有，但不会真的发出去，见 `test/http-wire-headers.test.ts`）。
    // 要比对的是**真正发出去的那一组**，所以走 toJSON()。
    const bag = calls[0]?.headers as unknown as {
      toJSON: () => Record<string, string>
      [key: string]: unknown
    }
    const sent: Record<string, string> = { ...bag.toJSON(), token: '<redacted>' }
    expect(sent).toEqual(LIST.headers)
    expect(sent['module-type']).toBe('11')
    for (const key of Object.keys(bag)) {
      if (key in sent) continue
      expect(bag[key], `多余的头 ${key} 有值，会真的发出去`).toBeUndefined()
    }
  })

  it('页面在规则表里算得出 module-type = 11 组织管理', () => {
    const { sdk } = makeSdk()
    const resolved = sdk.resolveModuleType(ATTENDANCE_SHIFT_PAGE_PATH)
    expect(resolved.moduleType).toBe(ATTENDANCE_SHIFT_MODULE_TYPE)
    expect(resolved.moduleType).toBe(11)
    expect(resolved.label).toBe('组织管理')
  })

  it('GET 请求没有 body', async () => {
    const { capability, calls } = makeSdk()
    await capability.list()
    expect(calls[0]?.data).toBeUndefined()
  })
})

describe('status 不是这一页的参数：页面声明了它，却没有任何控件绑定', () => {
  it('参数契约里没有 status —— 调用方看不见它，也就改不了它', () => {
    const definition = attendanceShiftCapabilities.find((item) => item.id === 'attendance-shift-list')
    expect(definition?.params.map((param) => param.name)).toEqual(['name', 'pageNo', 'pageSize'])
  })

  it('硬传 status 会被拒，且一个请求都不发', async () => {
    const { capability, calls } = makeSdk()

    await expect(capability.list({ status: 1 } as never)).rejects.toThrow(/status/)
    expect(calls).toHaveLength(0)
  })

  it('assertNoStatusParam 只认 status 这一个键，不影响其它参数', async () => {
    expect(() => assertNoStatusParam({ name: '班' })).not.toThrow()
    expect(() => assertNoStatusParam({})).not.toThrow()
    expect(() => assertNoStatusParam({ status: undefined })).toThrow(/status/)
  })
})

describe('新建：请求体与浏览器抓下来的那一条一字不差', () => {
  it('URL / 方法 / body 与基准完全相同（含键顺序，逐字节比对）', async () => {
    const { capability, calls } = makeSdk()

    await capability.create(DRAFT)

    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(CREATE.url))
    expect(String(calls[0]?.method).toUpperCase()).toBe(CREATE.method)
    expect(rawBodyOf(calls[0])).toBe(CREATE.body)
  })

  it('body 里没有 id（新建态的表单就是这五个键）', async () => {
    const { capability, calls } = makeSdk()

    await capability.create(DRAFT)

    expect(JSON.parse(rawBodyOf(calls[0]))).not.toHaveProperty('id')
  })

  it('名称必填、且不超过页面规则里的 20 字', async () => {
    const { capability, calls } = makeSdk()

    await expect(capability.create({ ...DRAFT, name: '' })).rejects.toThrow(/名称/)
    await expect(capability.create({ ...DRAFT, name: 'x'.repeat(SHIFT_NAME_MAX_LENGTH + 1) })).rejects.toThrow(
      /20/,
    )
    expect(calls).toHaveLength(0)
  })

  it('恰好 20 字是允许的（边界不能多挡一个字）', async () => {
    const { capability, calls } = makeSdk()

    await capability.create({ ...DRAFT, name: 'x'.repeat(SHIFT_NAME_MAX_LENGTH) })

    expect(calls).toHaveLength(1)
  })
})

describe('四个时间字段：格式由页面的时间选择器决定，传错挡在本地', () => {
  it('合法格式直接放行', () => {
    for (const value of ['00:00:00', '08:30:00', '13:00:00', '23:59:59']) {
      expect(() => assertClockTime('时间', value)).not.toThrow()
    }
  })

  it.each(['8:00', '08:00', '08:00:0', '24:00:00', '08:60:00', '08:00:60', '08.00.00', '', null, 80000])(
    '非法值「%s」抛错（后端字段是 Time 类型，格式不对整条写请求会失败）',
    (bad) => {
      expect(() => assertClockTime('时间', bad)).toThrow(/HH:mm:ss/)
    },
  )

  it.each(['morningStartTime', 'morningEndTime', 'afternoonStartTime', 'afternoonEndTime'] as const)(
    'create 传非法 %s 时不发请求',
    async (field) => {
      const { capability, calls } = makeSdk()

      await expect(capability.create({ ...DRAFT, [field]: '8:00' })).rejects.toThrow(/HH:mm:ss/)
      expect(calls).toHaveLength(0)
    },
  )

  it('不校验"开始早于结束"：页面自己没写这条规则，后端也不校验（实测数据里有 13:00~05:00）', async () => {
    const { capability, calls } = makeSdk()

    await capability.create({ ...DRAFT, afternoonEndTime: '05:00:00' })

    expect(calls).toHaveLength(1)
  })
})

describe('修改：整单替换，载荷是「五个业务键 + id」', () => {
  it('body 的前 6 个键与浏览器那条 PUT 逐字相同（浏览器多带的是 bridge 带进去的服务端字段）', async () => {
    const { capability, calls } = makeSdk()

    await capability.update({ id: '9', ...DRAFT })

    const actual = rawBodyOf(calls[0])
    const actualBody = JSON.parse(actual) as Record<string, unknown>
    const browserBody = JSON.parse(UPDATE.body ?? '{}') as Record<string, unknown>

    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(UPDATE.url))
    expect(String(calls[0]?.method).toUpperCase()).toBe(UPDATE.method)
    // 键顺序：五个业务字段 + id —— 与浏览器那份的前缀逐字一致
    expect(Object.keys(actualBody)).toEqual(['name', 'morningStartTime', 'morningEndTime', 'afternoonStartTime', 'afternoonEndTime', 'id'])
    expect(Object.keys(browserBody).slice(0, 6)).toEqual(Object.keys(actualBody))
    // 值也一致 —— 除了 name：浏览器那一条是**改名之后**发的（基准里的名字是
    // `SDK-TEST-班次改名`，创建时叫 `SDK-TEST-班次基准`），名字本来就不该相同。
    for (const key of ['morningStartTime', 'morningEndTime', 'afternoonStartTime', 'afternoonEndTime', 'id']) {
      expect(actualBody[key], key).toEqual(browserBody[key])
    }
    expect(browserBody.name).toBe('SDK-TEST-班次改名')
    // ⚠️ 少发的就是那六个服务端字段 —— 这条**如实锁住差异**，不是"我们和浏览器一样"
    expect(actualBody).not.toHaveProperty('status')
    expect(actualBody).not.toHaveProperty('createTime')
  })

  it('id 归一成字符串（后端把 Long 序列化成字符串，浏览器回传的也是 "9"）', async () => {
    const { capability, calls } = makeSdk()

    await capability.update({ id: 9, ...DRAFT })

    expect((JSON.parse(rawBodyOf(calls[0])) as { id: unknown }).id).toBe('9')
    expect(rawBodyOf(calls[0])).toContain('"id":"9"')
  })

  it('id 为空时不发请求', async () => {
    const { capability, calls } = makeSdk()

    await expect(capability.update({ id: '  ', ...DRAFT })).rejects.toThrow(/id/)
    expect(calls).toHaveLength(0)
  })
})

describe('详情与删除：URL 形状', () => {
  it('详情：GET /org/hrWorkShift/{id}（这条没有浏览器基准 —— 编辑页走 bridge，不按 id 取详情）', async () => {
    const { capability, calls } = makeSdk({ id: '5', name: '沃德博创考勤班次' })

    const one = await capability.get(5)

    // 只看 path：SDK 会给 GET 加一个 `_t` 时间戳（与浏览器一致），这里不比对它
    expect(String(calls[0]?.url).split('?')[0]).toBe('/admin-api/org/hrWorkShift/5')
    expect(String(calls[0]?.method).toUpperCase()).toBe('GET')
    expect(one.name).toBe('沃德博创考勤班次')
  })

  it('删除：DELETE /org/hrWorkShift/{id}，与基准一字不差，且没有 body', async () => {
    const { capability, calls } = makeSdk()

    await capability.remove(9)

    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(REMOVE.url))
    expect(String(calls[0]?.method).toUpperCase()).toBe(REMOVE.method)
    expect(calls[0]?.data).toBeUndefined()
    expect(REMOVE.body).toBeNull()
  })
})

describe('能力定义：五个能力都绑在同一页上，写标志正确', () => {
  it('id 唯一、pagePath 一致、权限码一致', () => {
    const ids = attendanceShiftCapabilities.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'attendance-shift-list',
      'attendance-shift-get',
      'attendance-shift-create',
      'attendance-shift-update',
      'attendance-shift-remove',
    ])
    for (const definition of attendanceShiftCapabilities) {
      expect(definition.pagePath).toBe(ATTENDANCE_SHIFT_PAGE_PATH)
      expect(definition.permission).toBe('/dashboard/attendance/attendance-shift')
    }
  })

  it('只有 list / get 是读，三个写能力 write=true', () => {
    const write = attendanceShiftCapabilities.filter((item) => item.write).map((item) => item.id)
    expect(write).toEqual([
      'attendance-shift-create',
      'attendance-shift-update',
      'attendance-shift-remove',
    ])
  })

  it('update 的参数是 id + 四个时间 + 名称，且 id 在第一位（先读当前值的引导写在这里）', () => {
    const definition = attendanceShiftCapabilities.find((item) => item.id === 'attendance-shift-update')
    expect(definition?.params.map((param) => param.name)).toEqual([
      'id',
      'name',
      'morningStartTime',
      'morningEndTime',
      'afternoonStartTime',
      'afternoonEndTime',
    ])
  })
})

describe('基准文件自身：写链路那三条不能夹带真实业务数据', () => {
  it('三条写请求的名字都是 SDK-TEST- 前缀（抓完就删掉了）', () => {
    for (const request of [CREATE, UPDATE]) {
      const body = JSON.parse(request.body ?? '{}') as { name?: string }
      expect(body.name).toMatch(/^SDK-TEST-/)
    }
  })

  it('token 是脱敏的', () => {
    for (const request of baseline.requests) {
      expect(request.headers.token).toBe('<redacted>')
    }
  })
})

describe('buildShiftPayload 的键顺序就是契约（qs / JSON 序列化都按它来）', () => {
  it('键顺序固定，不随实参的书写顺序变化', () => {
    const payload = buildShiftPayload({
      afternoonEndTime: '17:00:00',
      afternoonStartTime: '13:00:00',
      morningEndTime: '11:30:00',
      morningStartTime: '08:00:00',
      name: '班',
    } as AttendanceShiftDraft)

    expect(Object.keys(payload)).toEqual([
      'name',
      'morningStartTime',
      'morningEndTime',
      'afternoonStartTime',
      'afternoonEndTime',
    ])
  })
})
