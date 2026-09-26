import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import {
  assertDateTime,
  BACKLOG_TASK_EXAMINE_PAGE_PATH,
  BACKLOG_TASK_EXAMINE_PERMISSION,
  backlogTaskExamineCapabilities,
  createBacklogTaskExamineCapability,
  FINISHED_OPTIONS,
  SELECT_TYPE_OPTIONS,
  type BacklogTaskExamineCapability,
} from '../src/capabilities/backlog-task-examine.js'
import { createPortalHeadless } from '../src/index.js'

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number }

const here = dirname(fileURLToPath(import.meta.url))
const baseline = JSON.parse(
  readFileSync(join(here, '../baseline/backlog-task-examine.browser.json'), 'utf8'),
) as {
  requests: Array<{ name: string; method: string; url: string; headers: Record<string, string> }>
  对照组: { 复用方: Array<{ 页面: string; finished: number; componentMode: boolean }> }
}

const MOUNT = baseline.requests[0]!
const DONE_TAB = baseline.requests[1]!
const ALL_RANGE = baseline.requests[2]!
const DATE_RANGE = baseline.requests[3]!
const NAME_FILTER = baseline.requests[4]!
const DEEP_LINK = baseline.requests[5]!
const AFTER_RESET = baseline.requests[6]!
/** 2026-09-20 复核时补抓的一条：三个文本筛选一起填（上一版基准把 title / startUserName 列为「没抓到」） */
const THREE_TEXT = baseline.requests[7]!

/** 取 path + query，并把一次性时间戳参数归一化（基准里存的是带 host 的完整 URL） */
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
 * 门面上还没有 `backlogTaskExamine`（接线由派单方统一做，不在本任务范围），
 * 所以这里自己用公开的 `sdk.call(pagePath, config)` 组装一次请求函数 ——
 * 好处是它照样走「页面上下文」那条唯一实现，module-type 与 http 实例都不是绕过去的。
 */
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
  const capability: BacklogTaskExamineCapability = createBacklogTaskExamineCapability(
    (config) => sdk.call(BACKLOG_TASK_EXAMINE_PAGE_PATH, config),
  )
  return { sdk, calls, capability }
}

/** 某个能力的参数名（按契约声明顺序） */
function paramNames (id: string): string[] {
  const definition = backlogTaskExamineCapabilities.find((item) => item.id === id)
  return definition === undefined ? [] : definition.params.map((param) => param.name)
}

describe('待办事项列表 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选条件时的 URL：path 与 query 与基准完全相同（含键顺序）', async () => {
    const { calls, capability } = makeSdk()

    await capability.list()

    const actual = String(calls[0]?.url)
    expect(queryPairs(actual)).toEqual(queryPairs(MOUNT.url))
    expect(normalizeUrl(actual)).toBe(normalizeUrl(MOUNT.url))
  })

  it('方法、请求头与基准一致；module-type 这个头**不存在**（本页算不出，与浏览器一致）', async () => {
    const { calls, capability } = makeSdk()

    await capability.list()

    expect(String(calls[0]?.method).toUpperCase()).toBe(MOUNT.method)

    // axios 的 header bag 里会多带一个值为 undefined 的 `Content-Type` 槽位
    // （own key 里有，但不会发出去——见 `test/http-wire-headers.test.ts`），所以走 toJSON()。
    const bag = calls[0]?.headers as unknown as {
      toJSON: () => Record<string, string>
      [key: string]: unknown
    }
    const sent: Record<string, string> = { ...bag.toJSON(), token: '<redacted>' }
    expect(sent).toEqual(MOUNT.headers)
    // 这条是本页与考勤档案（11）/ 作业管理（12）最要紧的差别：不是"发了个别的值"，是**根本不发**
    expect(sent['module-type']).toBeUndefined()
    expect('module-type' in sent).toBe(false)
    for (const key of Object.keys(bag)) {
      if (key in sent) continue
      expect(bag[key], `多余的头 ${key} 有值，会真的发出去`).toBeUndefined()
    }
  })

  it('页面在规则表里算不出 module-type —— 与浏览器在同页面上「不发这个头」是同一个结论', () => {
    const { sdk } = makeSdk()
    const resolved = sdk.resolveModuleType(BACKLOG_TASK_EXAMINE_PAGE_PATH)
    expect(resolved.moduleType).toBeNull()
    expect(resolved.matchedBy).toBe('none')
  })

  it('请求落到全局默认的 platform 实例：路径带 /admin-api 前缀（这是实例推导的另一半）', async () => {
    const { calls, capability } = makeSdk()

    await capability.list()

    // platform.js 的补前缀发生在 baseURL 拼接**之前**（`platform.js:18-20`），
    // 所以 url 上必须已经有 /admin-api，而不是靠 baseURL 里带
    expect(String(calls[0]?.url)).toMatch(/^\/admin-api\/bpm\/hr\/task\/list-by-category-web\?/)
    expect(String((calls[0] as unknown as { baseURL?: string })?.baseURL)).toBe(
      'https://biz-api-test.wodecorp.cn',
    )
  })

  it('GET 请求没有 body', async () => {
    const { calls, capability } = makeSdk()
    await capability.list()
    expect(calls[0]?.data).toBeUndefined()
  })
})

describe('待办 / 已办（finished）——与浏览器基准一致', () => {
  it('finished=2（已办事项标签）的 URL 与基准一致', async () => {
    const { calls, capability } = makeSdk()

    await capability.list({ finished: 2 })

    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(DONE_TAB.url))
  })

  it('完成不存在别的默认值：不写 finished 时发的是 1（页面 props.finished 的默认值）', async () => {
    const { calls, capability } = makeSdk()

    await capability.list({ pageSize: 20 })

    expect(String(calls[0]?.url)).toContain('finished=1')
  })

  it('待办事项下也照样发 selectType=1 —— 控件没渲染不等于参数不存在', async () => {
    const { calls, capability } = makeSdk()

    await capability.list({ finished: 1 })

    const url = String(calls[0]?.url)
    expect(url).toContain('selectType=1')
    expect(queryPairs(url)).toEqual(queryPairs(MOUNT.url))
  })

  it('selectType=2（时间范围=全部）的 URL 与基准一致', async () => {
    const { calls, capability } = makeSdk()

    await capability.list({ finished: 2, selectType: 2 })

    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(ALL_RANGE.url))
  })

  it('两个枚举的候选值就是页面上能点到的那些', () => {
    const finished = backlogTaskExamineCapabilities[0]?.params.find((p) => p.name === 'finished')
    const selectType = backlogTaskExamineCapabilities[0]?.params.find((p) => p.name === 'selectType')

    expect(finished?.kind).toBe('enum')
    expect(finished?.options).toEqual([
      { label: '待办事项', value: 1 },
      { label: '已办事项', value: 2 },
    ])
    expect(selectType?.kind).toBe('enum')
    expect(selectType?.options).toEqual([
      { label: '近30天内', value: 1 },
      { label: '全部', value: 2 },
    ])
    expect(FINISHED_OPTIONS.map((o) => o.value)).toEqual([1, 2])
    expect(SELECT_TYPE_OPTIONS.map((o) => o.value)).toEqual([1, 2])
  })
})

describe('发起时间区间：原样的两个值，序列化成 createTime[0] / createTime[1]', () => {
  it('成对给时与基准逐字节一致（含 %5B/%5D 与 %20 编码）', async () => {
    const { calls, capability } = makeSdk()

    await capability.list({
      finished: 2,
      selectType: 2,
      createTimeStart: '2026-09-01 00:00:00',
      createTimeEnd: '2026-09-10 00:00:00',
    })

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(DATE_RANGE.url))
    expect(queryPairs(actual)).toEqual(queryPairs(DATE_RANGE.url))
  })

  it('没有 +1 天的开区间改写：给到 2026-09-10 就是字面的这一天', async () => {
    const { calls, capability } = makeSdk()

    await capability.list({ createTimeStart: '2026-09-01 00:00:00', createTimeEnd: '2026-09-10 00:00:00' })

    const url = String(calls[0]?.url)
    expect(url).toContain('createTime%5B1%5D=2026-09-10%2000%3A00%3A00')
    // 作业管理那条线会把它改写成 2026-09-11 00:00:00；本页不能出现
    expect(url).not.toContain('2026-09-11')
  })

  it('不给区间时 createTime 整项不发（空数组被 qs 丢掉）——浏览器也不发', async () => {
    const { calls, capability } = makeSdk()

    await capability.list()

    const url = String(calls[0]?.url)
    expect(url).not.toContain('createTime')
    expect(queryPairs(url)).toEqual(queryPairs(MOUNT.url))
  })

  it.each([['2026-09-01 00:00:00']] as const)('只给起点不给终点会被拒，且不发请求', async (start) => {
    const { calls, capability } = makeSdk()

    await expect(capability.list({ createTimeStart: start })).rejects.toThrow(/成对/)
    await expect(capability.list({ createTimeEnd: start })).rejects.toThrow(/成对/)
    expect(calls).toHaveLength(0)
  })

  it.each(['2026-9-1 00:00:00', '2026/09/01 00:00:00', '2026-09-01', '2026-09-01 00:00', '', 'abc'])(
    '非法时间格式「%s」抛错（后端照收，只会查不到或查错范围）',
    async (bad) => {
      const { calls, capability } = makeSdk()

      await expect(
        capability.list({ createTimeStart: bad, createTimeEnd: '2026-09-10 00:00:00' }),
      ).rejects.toThrow(/YYYY-MM-DD HH:mm:ss/)
      expect(calls).toHaveLength(0)
    },
  )

  it('合法格式直接放行（分钟/秒不限 00，与会议室那条线的 assertTimeSlot 不同）', () => {
    expect(() => assertDateTime('2026-09-01 00:00:00', 'f')).not.toThrow()
    expect(() => assertDateTime('2026-09-01 09:37:42', 'f')).not.toThrow()
    expect(() => assertDateTime('2026-12-31 23:59:59', 'f')).not.toThrow()
  })
})

describe('文本筛选与深链分类', () => {
  it('流程名称走 name（与基准逐字节一致，含中文编码）', async () => {
    const { calls, capability } = makeSdk()

    await capability.list({
      name: '通用',
      finished: 2,
      selectType: 2,
      createTimeStart: '2026-09-01 00:00:00',
      createTimeEnd: '2026-09-10 00:00:00',
    })

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(NAME_FILTER.url))
    expect(queryPairs(actual)).toEqual(queryPairs(NAME_FILTER.url))
  })

  it('三个文本筛选（name / title / startUserName）一起给时与基准逐字节一致（含中文编码）', async () => {
    const { calls, capability } = makeSdk()

    await capability.list({ name: '通用', title: '资产', startUserName: '姚', finished: 1, selectType: 1 })

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(THREE_TEXT.url))
    expect(queryPairs(actual)).toEqual(queryPairs(THREE_TEXT.url))
    // 三个都是**纯文本**模糊匹配，页面上没有一个是人员/部门选择器（所以本页没有长选项参数）
    expect(actual).toContain('startUserName=%E5%A7%9A')
  })

  it('深链 ?taskKey= 在请求里叫 processCategory，且排在 selectType 之后', async () => {
    const { calls, capability } = makeSdk()

    await capability.list({ processCategory: 'Task_month' })

    const actual = String(calls[0]?.url)
    expect(queryPairs(actual)).toEqual(queryPairs(DEEP_LINK.url))
    expect(queryPairs(actual).map(([key]) => key).indexOf('processCategory')).toBeGreaterThan(
      queryPairs(actual).map(([key]) => key).indexOf('selectType'),
    )
  })

  it('processCategory 声明成 text 而不是 enum，且说明里留着「真实分类 / 500」这两件事', () => {
    const param = backlogTaskExamineCapabilities[0]?.params.find((p) => p.name === 'processCategory')

    expect(param?.kind).toBe('text')
    // 为什么不是 enum：页面上这个参数的取值来自 `route.query.taskKey`（深链），
    // 而深链那四个值（Task_month / Protocol_year / Protocol_month / protocolMonthScore）
    // 在测试环境**一律让后端 500**——后端 `modelMapGroupCategory.get(processCategory).stream()`
    // 取不到就是空指针。把一组注定 500 的值列成 enum 候选，等于把错误当契约发出去。
    expect(param?.options).toBeUndefined()
    // 说明里必须同时留着这两件事，否则调用方会照抄深链的 taskKey
    expect(param?.description).toContain('human_process')
    expect(param?.description).toContain('500')
  })

  it('不传 processCategory 时整项不发（null 被 skipNulls 丢掉）——与浏览器初值一致', async () => {
    const { calls, capability } = makeSdk()

    await capability.list()

    expect(String(calls[0]?.url)).not.toContain('processCategory')
  })

  it('「重置」之后 selectType 会消失，但契约里那条永久发默认值 1 —— 两种状态都是浏览器真的发过的', async () => {
    const { calls, capability } = makeSdk()

    // 这条是能力固定发出去的样子（= 浏览器打开页面的样子）
    await capability.list({ processCategory: 'Task_month' })
    expect(String(calls[0]?.url)).not.toBe(normalizeUrl(AFTER_RESET.url))

    // 基准里第 7 条（点重置之后）少一个 selectType，契约刻意**不**复刻它：
    // 重置是页面内部的一次性状态，能力每次调用都等价于"重新打开这一页"。
    const pairs = queryPairs(String(calls[0]?.url)).map(([key]) => key)
    expect(pairs).toContain('selectType')
    expect(queryPairs(AFTER_RESET.url).map(([key]) => key)).not.toContain('selectType')
  })
})

describe('参数顺序由契约决定，不随调用方实参的书写顺序改变', () => {
  it('倒着写实参也得到同一串 query', async () => {
    const { calls, capability } = makeSdk()

    await capability.list({
      pageSize: 20,
      pageNo: 1,
      processCategory: 'Task_month',
      selectType: 1,
      finished: 1,
      startUserName: '',
      createTimeEnd: '2026-09-10 00:00:00',
      createTimeStart: '2026-09-01 00:00:00',
      title: '',
      name: '',
    })

    expect(queryPairs(String(calls[0]?.url)).map(([key]) => key)).toEqual([
      'order',
      'orderField',
      'name',
      'title',
      'createTime%5B0%5D',
      'createTime%5B1%5D',
      'startUserName',
      'finished',
      'selectType',
      'processCategory',
      'pageNo',
      'pageSize',
      '_t',
    ])
  })

  it('调用方硬塞 contract 里没有的字段不会进请求（页面定义不放出去）', async () => {
    const { calls, capability } = makeSdk()

    await capability.list({ selectable: true, componentMode: true } as never)

    const url = String(calls[0]?.url)
    expect(url).not.toContain('selectable')
    expect(url).not.toContain('componentMode')
  })
})

describe('已办标签撤销审批 —— 与共享 Portal 组件的写请求一致', () => {
  it('PUT /bpm/task/withdraw 只用历史 task id，空原因发送「无」', async () => {
    const { calls, capability } = makeSdk(true)

    await capability.withdraw({ taskId: ' done-task-1 ', reason: ' 重新确认审批意见 ' })
    expect(calls[0]).toMatchObject({
      url: '/admin-api/bpm/task/withdraw',
      method: 'put',
    })
    expect(JSON.parse(String(calls[0]?.data))).toEqual({
      id: 'done-task-1',
      reason: '重新确认审批意见',
    })
    expect(calls[0]?.headers).not.toHaveProperty('module-type')

    await capability.withdraw({ taskId: 'done-task-2' })
    expect(JSON.parse(String(calls[1]?.data))).toEqual({ id: 'done-task-2', reason: '无' })

    const before = calls.length
    await expect(capability.withdraw({ taskId: '   ' })).rejects.toThrow(/taskId/)
    expect(calls).toHaveLength(before)
  })
})

describe('接线（能力定义这一侧）', () => {
  it('pagePath 与菜单路径逐字一致，permission 与菜单里的权限码一致', () => {
    const definition = backlogTaskExamineCapabilities[0]!
    expect(definition.pagePath).toBe('/dashboard/backlog/task-examine/list')
    expect(definition.permission).toBe('/dashboard/backlog/task-examine')
    expect(definition.write).toBe(false)
    expect(BACKLOG_TASK_EXAMINE_PERMISSION).toBe('/dashboard/backlog/task-examine')
    const withdraw = backlogTaskExamineCapabilities.find((item) => item.id === 'backlog-task-examine-withdraw')
    expect(withdraw).toMatchObject({
      pagePath: '/dashboard/backlog/task-examine/list',
      permission: '/dashboard/backlog/task-examine',
      write: true,
    })
  })

  it('参数契约就是「页面上真的有的输入」这一组，不多不少', () => {
    expect(paramNames('backlog-task-examine-list')).toEqual([
      'name',
      'title',
      'startUserName',
      'createTimeStart',
      'createTimeEnd',
      'finished',
      'selectType',
      'processCategory',
      'pageNo',
      'pageSize',
    ])
  })

  it('本页没有长选项参数：没有任何参数声明 lookup（与考勤档案的部门/班组相反）', () => {
    const withLookup = backlogTaskExamineCapabilities.flatMap((definition) =>
      definition.params.filter((param) => param.lookup !== undefined).map((param) => param.name),
    )
    expect(withLookup).toEqual([])
  })

  it('被另外两条菜单复用是一个事实，不是本页多出来的能力面', () => {
    // 基准里记着复用方；列表与共享组件上的撤销动作是两个能力，
    // 三条菜单共用同一个组件不代表把固定 finished 的复用方重复注册。
    expect(backlogTaskExamineCapabilities).toHaveLength(2)
    expect(baseline.对照组.复用方.map((item) => `${item.页面}#${item.finished}`)).toEqual([
      '/dashboard/flow/task/todo/list#1',
      '/dashboard/flow/task/done/list#2',
    ])
  })
})
