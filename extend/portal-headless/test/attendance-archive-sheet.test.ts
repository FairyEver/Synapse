import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import {
  assertYearMonth,
  ATTENDANCE_ARCHIVE_SHEET_PAGE_PATH,
  ATTENDANCE_ARCHIVE_SHEET_PERMISSION,
  attendanceArchiveSheetCapabilities,
  ORGANIZATION_SEARCH_MAX,
} from '../src/capabilities/attendance-archive-sheet.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { createPortalHeadless } from '../src/index.js'

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number }

const here = dirname(fileURLToPath(import.meta.url))
const baseline = JSON.parse(
  readFileSync(join(here, '../baseline/attendance-archive-sheet.browser.json'), 'utf8'),
) as {
  requests: Array<{ name: string; method: string; url: string; headers: Record<string, string> }>
  对照组: { url: string; 页面: string }
}

const LIST_BASELINE = baseline.requests[0]!
const MONTH_BASELINE = baseline.requests[1]!
const ORG_BASELINE = baseline.requests[2]!
const SHEET_PAGE_BASELINE = baseline.对照组.url

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

function makeSdk (data: unknown = { list: [], total: 0 }) {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  return { sdk, calls }
}

/** 某个能力的参数名（按契约声明顺序） */
function paramNames (id: string): string[] {
  const definition = attendanceArchiveSheetCapabilities.find((item) => item.id === id)
  return definition === undefined ? [] : definition.params.map((param) => param.name)
}

describe('考勤档案列表 —— 与浏览器基准逐字段一致（D20）', () => {
  it('列表与候选能力使用Portal档案菜单权限', () => {
    expect(attendanceArchiveSheetCapabilities.every(item => item.permission === ATTENDANCE_ARCHIVE_SHEET_PERMISSION)).toBe(true)
  })

  it('无筛选条件时的 URL：path 与 query 与基准完全相同（含键顺序）', async () => {
    const { sdk, calls } = makeSdk()

    await sdk.attendanceArchive.list()

    const actual = String(calls[0]?.url)
    expect(queryPairs(actual)).toEqual(queryPairs(LIST_BASELINE.url))
    expect(normalizeUrl(actual)).toBe(normalizeUrl(LIST_BASELINE.url))
  })

  it('表单里初值为 null 的三项一律不发（qs 的 skipNulls）——浏览器也不发', async () => {
    const { sdk, calls } = makeSdk()

    await sdk.attendanceArchive.list()

    const actual = String(calls[0]?.url)
    expect(actual).not.toContain('yearMonth=')
    expect(actual).not.toContain('departmentId=')
    expect(actual).not.toContain('organizationId=')
  })

  it('带月份时的 URL 与基准一致', async () => {
    const { sdk, calls } = makeSdk()

    await sdk.attendanceArchive.list({ yearMonth: '2026-08' })

    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(MONTH_BASELINE.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(MONTH_BASELINE.url))
  })

  it('参数顺序由契约决定，不随调用方实参的书写顺序改变', async () => {
    const { sdk, calls } = makeSdk()

    // 故意倒着写实参：pageSize 在最前
    await sdk.attendanceArchive.list({ pageSize: 20, pageNo: 1, departmentId: 3, yearMonth: '2026-08' })

    expect(queryPairs(String(calls[0]?.url)).map(([key]) => key)).toEqual([
      'order',
      'orderField',
      'isArchived',
      'yearMonth',
      'departmentId',
      'pageNo',
      'pageSize',
      '_t',
    ])
  })

  it('方法、请求头与基准一致（module-type 由页面推导出 11，浏览器这一页发的也是 11）', async () => {
    const { sdk, calls } = makeSdk()

    await sdk.attendanceArchive.list()

    expect(String(calls[0]?.method).toUpperCase()).toBe(LIST_BASELINE.method)

    // axios 的 header bag 里会多带一个值为 undefined 的 `Content-Type` 槽位
    // （own key 里有，但不会发出去——实测线路上 GET 没有 Content-Type，见
    // `test/http-wire-headers.test.ts`）。要比对的是**真正发出去的那一组**，所以走 toJSON()。
    const bag = calls[0]?.headers as unknown as {
      toJSON: () => Record<string, string>
      [key: string]: unknown
    }
    const sent: Record<string, string> = { ...bag.toJSON(), token: '<redacted>' }
    expect(sent).toEqual(LIST_BASELINE.headers)
    expect(sent['module-type']).toBe('11')
    // 多出来的槽位必须是空值 —— 否则就是真的多发了一个头（同样是"与浏览器不等价"）
    for (const key of Object.keys(bag)) {
      if (key in sent) continue
      expect(bag[key], `多余的头 ${key} 有值，会真的发出去`).toBeUndefined()
    }
  })

  it('页面在规则表里算得出 module-type（与会议室列表那页相反）', () => {
    const { sdk } = makeSdk()
    const resolved = sdk.resolveModuleType(ATTENDANCE_ARCHIVE_SHEET_PAGE_PATH)
    expect(resolved.moduleType).toBe(11)
    expect(resolved.label).toBe('组织管理')
  })

  it('GET 请求没有 body', async () => {
    const { sdk, calls } = makeSdk()
    await sdk.attendanceArchive.list()
    expect(calls[0]?.data).toBeUndefined()
  })
})

describe('isArchived 不是筛选条件，是「这一页是哪一页」的定义', () => {
  it('参数契约里没有 isArchived —— 调用方看不见它，也就改不了它', () => {
    expect(paramNames('attendance-archive-sheet-list')).toEqual([
      'yearMonth',
      'departmentId',
      'organizationId',
      'pageNo',
      'pageSize',
    ])
  })

  it('即使硬传 isArchived 也无效：请求里永远是 1，拿不到考勤表页的数据', async () => {
    const { sdk, calls } = makeSdk()

    // 类型上不允许，运行时硬塞进去
    await sdk.attendanceArchive.list({ isArchived: 0 } as never)

    const url = String(calls[0]?.url)
    expect(url).toContain('isArchived=1')
    expect(url).not.toContain('isArchived=0')
    // 与另一个页面（考勤表）的请求不是同一条：那条根本不发 isArchived
    expect(queryPairs(url)).not.toEqual(queryPairs(SHEET_PAGE_BASELINE))
  })
})

describe('yearMonth 的格式由页面的月份选择器决定，传错要挡在本地', () => {
  it('合法格式直接放行', () => {
    expect(() => assertYearMonth('2026-08')).not.toThrow()
    expect(() => assertYearMonth('2026-01')).not.toThrow()
    expect(() => assertYearMonth('2026-12')).not.toThrow()
  })

  it.each(['2026-8', '2026/08', '2026-13', '2026-00', '202608', '2026-08-15', ''])(
    '非法格式「%s」抛错（后端照收，只会静默查不到数据）',
    (bad) => {
      expect(() => assertYearMonth(bad)).toThrow(/YYYY-MM/)
    },
  )

  it('list() 传非法月份时不发请求，返回 rejected promise', async () => {
    const { sdk, calls } = makeSdk()

    await expect(sdk.attendanceArchive.list({ yearMonth: '2026/08' })).rejects.toThrow(/YYYY-MM/)
    expect(calls).toHaveLength(0)
  })
})

describe('部门 / 班组候选：长选项参数必须先要关键字（设计 D6 / H35）', () => {
  const ORGS = [
    { id: 1, name: '办公室' },
    { id: 2, name: '行政部' },
    { id: 3, name: '财务中心' },
    { id: 4, name: '思玛特财务中心' },
  ]

  it('候选来源就是页面自己打的接口（与基准逐字段一致）', async () => {
    const { sdk, calls } = makeSdk(ORGS)

    await sdk.attendanceArchive.searchOrganizations({ keyword: '办公', type: 1 })

    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(ORG_BASELINE.url))
    expect(String(calls[0]?.method).toUpperCase()).toBe('GET')
  })

  it('无关键字直接拒绝，且不发请求 —— 班组那一侧实测近千条，不能全量拉', async () => {
    const { sdk, calls } = makeSdk(ORGS)

    await expect(sdk.attendanceArchive.searchOrganizations({ type: 2 } as never)).rejects.toThrow(/keyword/)
    await expect(
      sdk.attendanceArchive.searchOrganizations({ keyword: '   ', type: 2 }),
    ).rejects.toThrow(/keyword/)
    expect(calls).toHaveLength(0)
  })

  it('type 必填且只能是 1 或 2', async () => {
    const { sdk, calls } = makeSdk(ORGS)

    await expect(
      sdk.attendanceArchive.searchOrganizations({ keyword: '办公', type: 3 } as never),
    ).rejects.toThrow(/type/)
    expect(calls).toHaveLength(0)
  })

  it('按名称做包含匹配，并如实回报「命中多少 / 总共有多少」', async () => {
    const { sdk } = makeSdk(ORGS)

    const result = await sdk.attendanceArchive.searchOrganizations({ keyword: '财务', type: 1 })

    expect(result.total).toBe(ORGS.length)
    expect(result.matched).toBe(2)
    expect(result.list.map((item) => item.name)).toEqual(['财务中心', '思玛特财务中心'])
  })

  it('limit 默认 20、上限 50：候选再多也不会一次冲进调用方上下文', async () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ id: index + 1, name: `班组${index + 1}` }))
    const { sdk } = makeSdk(many)

    const byDefault = await sdk.attendanceArchive.searchOrganizations({ keyword: '班组', type: 2 })
    expect(byDefault.matched).toBe(200)
    expect(byDefault.list).toHaveLength(20)

    const capped = await sdk.attendanceArchive.searchOrganizations({ keyword: '班组', type: 2, limit: 999 })
    expect(capped.list).toHaveLength(ORGANIZATION_SEARCH_MAX)
  })
})

describe('接线：能力进目录、进绑定表、能从 invoke 调到', () => {
  it('两个能力都在目录里，departmentId / organizationId 的 lookup 指向候选入口', () => {
    const { sdk } = makeSdk()

    const described = sdk.catalog.describe('attendance-archive-sheet-list')
    expect(described.ok).toBe(true)
    if (!described.ok) return

    for (const name of ['departmentId', 'organizationId']) {
      expect(described.params.find((param) => param.name === name)?.lookup, name).toMatchObject({
        capabilityId: 'attendance-org-search',
        keywordParam: 'keyword',
      })
    }

    // lookup 指向的能力必须真的在目录里、且真的有关键字参数（否则那条引导走不通）
    expect(sdk.catalog.validate().lookups).toEqual([])
  })

  it('没有登记候选入口的参数不会被说成"有入口"', () => {
    const { sdk } = makeSdk()
    const described = sdk.catalog.describe('attendance-archive-sheet-list')
    expect(described.ok).toBe(true)
    if (!described.ok) return

    expect(described.params.find((param) => param.name === 'yearMonth')?.lookup).toBeUndefined()
  })

  it('sdk.capabilities.invoke 能调到列表能力，请求真的发出去且带对页面上下文', async () => {
    const { sdk, calls } = makeSdk()

    await sdk.capabilities.invoke('attendance-archive-sheet-list', { yearMonth: '2026-08' })

    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(MONTH_BASELINE.url))
    expect((calls[0]?.headers as unknown as Record<string, string>)['module-type']).toBe('11')
  })

  it('sdk.capabilities.invoke 能调到候选查询能力', async () => {
    const { sdk, calls } = makeSdk([{ id: 9, name: '生产部' }])

    const out = await sdk.capabilities.invoke<{ list: Array<{ name: string }> }>('attendance-org-search', {
      keyword: '生产',
      type: 1,
    })

    expect(out.list.map((item) => item.name)).toEqual(['生产部'])
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(ORG_BASELINE.url))
  })

  it('绑定表与门面上的能力数组一一对应（不多不少）', () => {
    const { sdk } = makeSdk()
    const bound = CAPABILITY_BINDINGS.map((binding) => binding.capabilityId)

    for (const id of ['attendance-archive-sheet-list', 'attendance-org-search']) {
      expect(bound).toContain(id)
    }
    expect(bound.sort()).toEqual(sdk.capabilities.map((capability) => capability.id).sort())
  })
})
