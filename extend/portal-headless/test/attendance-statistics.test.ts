import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import {
  assertNoArchivedFlag,
  ATTENDANCE_STATISTICS_PAGE_PATH,
  ATTENDANCE_STATISTICS_PERMISSION,
  attendanceStatisticsCapabilities,
  createAttendanceStatisticsCapability,
  ORGANIZATION_SEARCH_CAPABILITY_ID,
} from '../src/capabilities/attendance-statistics.js'
import { attendanceArchiveSheetCapabilities } from '../src/capabilities/attendance-archive-sheet.js'
import { createPortalHeadless } from '../src/index.js'

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number }

const here = dirname(fileURLToPath(import.meta.url))
const baseline = JSON.parse(
  readFileSync(join(here, '../baseline/attendance-statistics.browser.json'), 'utf8'),
) as {
  requests: Array<{
    name: string
    method: string
    url: string
    headers: Record<string, string>
    body: null
    [key: string]: unknown
  }>
  对照组: { url: string; 页面: string }
}

const LIST_BASELINE = baseline.requests[0]!
/** 带 departmentId / organizationId 的那条：参数顺序以它为准（它的 module-type 被并行任务带偏了，只看 URL） */
const FILTERED_BASELINE = baseline.requests[3]!
const ORG_BASELINE = baseline.requests[1]!
const ARCHIVE_PAGE_URL = baseline.对照组.url

const catalog = JSON.parse(
  readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
) as {
  items: Array<{ menuPath: string; title: string; routeFile: string; kind: string; permission: string }>
}

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

/**
 * 能力**还没有**接线进 `src/capabilities/index.ts`（本次任务刻意不动门面），
 * 所以这里像 `smoke/read-attendance-statistics.mjs` 那样手工注入 `request`：
 * 用的仍是真实的 `sdk.call(页面路径, …)`，页面上下文（module-type / http 实例）
 * 走的还是同一条路，能力实现也是同一份。
 */
function makeCapability (data: unknown = { list: [], total: 0 }) {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    return { data: { ret: 'SUCCESS', code: 0, msg: '', data }, status: 200, statusText: 'OK', headers: {}, config }
  }
  const capability = createAttendanceStatisticsCapability((config) =>
    sdk.call(ATTENDANCE_STATISTICS_PAGE_PATH, config),
  )
  return { sdk, capability, calls }
}

/** 某个能力的参数名（按契约声明顺序） */
function paramNames (id: string): string[] {
  const definition = attendanceStatisticsCapabilities.find((item) => item.id === id)
  return definition === undefined ? [] : definition.params.map((param) => param.name)
}

describe('考勤统计列表 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选条件时的 URL：path 与 query 与基准完全相同（含键顺序）', async () => {
    const { capability, calls } = makeCapability()

    await capability.list()

    const actual = String(calls[0]?.url)
    expect(queryPairs(actual)).toEqual(queryPairs(LIST_BASELINE.url))
    expect(normalizeUrl(actual)).toBe(normalizeUrl(LIST_BASELINE.url))
  })

  it('表单里初值为 null 的两项一律不发（qs 的 skipNulls）——浏览器也不发', async () => {
    const { capability, calls } = makeCapability()

    await capability.list()

    const actual = String(calls[0]?.url)
    expect(actual).not.toContain('departmentId=')
    expect(actual).not.toContain('organizationId=')
    // 显式传 undefined 与不传等价（`buildListParams` 会退回初值 null，再被 skipNulls 丢掉）
    const explicit = makeCapability()
    await explicit.capability.list({ departmentId: undefined, organizationId: undefined })
    expect(String(explicit.calls[0]?.url)).not.toContain('departmentId=')
  })

  it('带部门 / 班组时的 URL 与基准一致（参数顺序也一致）', async () => {
    const { capability, calls } = makeCapability()

    await capability.list({ departmentId: 38, organizationId: 46 })

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(FILTERED_BASELINE.url))
    expect(queryPairs(actual)).toEqual(queryPairs(FILTERED_BASELINE.url))
  })

  it('参数顺序由契约决定，不随调用方实参的书写顺序改变', async () => {
    const { capability, calls } = makeCapability()

    // 故意倒着写实参：pageSize 在最前
    await capability.list({ pageSize: 20, pageNo: 1, organizationId: 46, departmentId: 38 })

    expect(queryPairs(String(calls[0]?.url)).map(([key]) => key)).toEqual([
      'order',
      'orderField',
      'departmentId',
      'organizationId',
      'pageNo',
      'pageSize',
      '_t',
    ])
  })

  it('方法、请求头与基准一致（module-type 由页面推导出 11）', async () => {
    const { capability, calls } = makeCapability()

    await capability.list()

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

  it('页面在规则表里算得出 module-type = 11 组织管理', () => {
    const { sdk } = makeCapability()
    const resolved = sdk.resolveModuleType(ATTENDANCE_STATISTICS_PAGE_PATH)
    expect(resolved.moduleType).toBe(11)
    expect(resolved.label).toBe('组织管理')
  })

  it('GET 请求没有 body', async () => {
    const { capability, calls } = makeCapability()
    await capability.list()
    expect(calls[0]?.data).toBeUndefined()
  })
})

describe('isArchived 是「这一页是哪一页」的定义，不是筛选条件', () => {
  it('pagePath 与页面清单逐字一致（pnpm next 靠它判定这一页完成了）', () => {
    const item = catalog.items.find((row) => row.menuPath === ATTENDANCE_STATISTICS_PAGE_PATH)
    expect(item, '清单里没有这一页，说明 pagePath 写错了').toBeDefined()
    expect(item?.title).toBe('考勤统计')
    expect(item?.routeFile).toBe('app/portal/views/dashboard/hr/attendance/attendance-sheet/list.vue')
    // 形态与源码一致：useListPageModule + getDataListURL（不是 customLoad）
    expect(item?.kind).toContain('声明式')
  })

  it('权限码与页面清单一致（清单给的那个值是菜单树的同源副本）', () => {
    const item = catalog.items.find((row) => row.menuPath === ATTENDANCE_STATISTICS_PAGE_PATH)
    expect(item?.permission).toBe(ATTENDANCE_STATISTICS_PERMISSION)
    expect(attendanceStatisticsCapabilities[0]?.permission).toBe(ATTENDANCE_STATISTICS_PERMISSION)
  })

  it('参数契约里既没有 isArchived 也没有 yearMonth', () => {
    expect(paramNames('attendance-statistics-list')).toEqual([
      'departmentId',
      'organizationId',
      'pageNo',
      'pageSize',
    ])
  })

  it('请求里一个字都不提 isArchived —— 与考勤档案页那条请求的分界就在这一个参数', async () => {
    const { capability, calls } = makeCapability()

    await capability.list({ departmentId: 38 })

    const url = String(calls[0]?.url)
    expect(url).not.toContain('isArchived')
    // 与档案页的请求不是同一条（那条钉死 isArchived=1）
    expect(queryPairs(url)).not.toEqual(queryPairs(ARCHIVE_PAGE_URL))
    expect(normalizeUrl(ARCHIVE_PAGE_URL)).toContain('isArchived=1')
  })

  it('硬传 isArchived 被拒绝，且不发请求 —— 返回 rejected promise，不是同步抛', async () => {
    const { capability, calls } = makeCapability()

    const pending = capability.list({ isArchived: 1 } as never)
    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).rejects.toThrow(/isArchived/)
    await expect(capability.list({ isArchived: 0 } as never)).rejects.toThrow(/attendance-archive-sheet-list/)
    expect(calls).toHaveLength(0)
  })

  it('守卫本身：只在真的带了 isArchived 这个键时才拒绝', () => {
    expect(() => assertNoArchivedFlag({ departmentId: 1 })).not.toThrow()
    expect(() => assertNoArchivedFlag({})).not.toThrow()
    expect(() => assertNoArchivedFlag(undefined)).not.toThrow()
    expect(() => assertNoArchivedFlag({ isArchived: undefined })).toThrow(/isArchived/)
  })
})

describe('部门 / 班组候选：复用档案页那条长选项入口（D6 / H35）', () => {
  it('两个 search 参数的 lookup 都指向 attendance-org-search 的 keyword', () => {
    const definition = attendanceStatisticsCapabilities.find(
      (item) => item.id === 'attendance-statistics-list',
    )
    for (const name of ['departmentId', 'organizationId']) {
      expect(definition?.params.find((param) => param.name === name)?.lookup, name).toMatchObject({
        capabilityId: ORGANIZATION_SEARCH_CAPABILITY_ID,
        keywordParam: 'keyword',
      })
    }
  })

  it('跨文件复用是真的：被指向的候选入口存在，且真的有关键字参数', () => {
    // 本文件不另建候选入口，所以这条断言是"复用没有落空"的唯一证据
    const target = attendanceArchiveSheetCapabilities.find(
      (item) => item.id === ORGANIZATION_SEARCH_CAPABILITY_ID,
    )
    expect(target, '引用了不存在的候选能力').toBeDefined()
    expect(target?.write).toBe(false)
    const keyword = target?.params.find((param) => param.name === 'keyword')
    expect(keyword?.required).toBe(true)
    // 候选入口的页面上下文必须与本页同域同 module-type（否则复用的前提不成立）
    expect(target?.pagePath).toBe('/dashboard/attendance/attendance-archive-sheet/list')
  })

  it('本文件不重复定义候选能力（重复定义会让调用方猜该用哪个）', () => {
    expect(attendanceStatisticsCapabilities.map((item) => item.id)).toEqual([
      'attendance-statistics-list',
    ])
  })

  it('没有登记候选入口的参数不会被说成"有入口"', () => {
    const definition = attendanceStatisticsCapabilities[0]
    expect(definition?.params.find((param) => param.name === 'pageNo')?.lookup).toBeUndefined()
  })
})

describe('能力定义本身', () => {
  it('pagePath 常量就是本页，且能力挂在同一个路径上', () => {
    expect(ATTENDANCE_STATISTICS_PAGE_PATH).toBe('/dashboard/attendance/attendance-sheet/list')
    expect(attendanceStatisticsCapabilities[0]?.pagePath).toBe(ATTENDANCE_STATISTICS_PAGE_PATH)
  })

  it('这一页只读：能力声明 write=false（页面本身的写入口见能力文件头的说明）', () => {
    expect(attendanceStatisticsCapabilities[0]?.write).toBe(false)
  })
})
