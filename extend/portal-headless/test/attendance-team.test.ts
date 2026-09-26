import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import {
  assertIsoDate,
  ATTENDANCE_TEAM_MODULE_TYPE,
  ATTENDANCE_TEAM_PAGE_PATH,
  ATTENDANCE_TEAM_PERMISSION,
  attendanceTeamCapabilities,
  buildGroupPayload,
  buildSchedulePayload,
  createAttendanceTeamCapability,
  DEFAULT_PAGE_SIZE,
  GROUP_NAME_MAX_LENGTH,
  STANDARD_WORKING_HOURS,
  type AttendanceTeamDraft,
  type AttendanceTeamScheduleDraft,
} from '../src/capabilities/attendance-team.js'
import { resolveHttpInstance } from '../src/context/http-instance.js'
import { createPortalHeadless } from '../src/index.js'

/**
 * 排班管理（`/dashboard/attendance/attendance-team/list`）的回归测试。
 *
 * 分工与前面几条线一致：这份管«载荷构造、参数契约、与浏览器基准的逐字段一致性»；
 * 真实环境的读写验证在 `smoke/read-attendance-team.mjs` 与
 * `smoke/attendance-team-crud.mjs`（后者会真的建记录、排班、再清理）。
 *
 * 基准：`baseline/attendance-team.browser.json` —— 外层（考勤组 CRUD）与内层（排班读写）
 * 在同一份文件里，按「能力」字段取用。
 */

type BaselineRequest = {
  name: string
  能力: string
  method: string
  url: string
  headers: Record<string, string> | null
  body: string | null
}

const here = dirname(fileURLToPath(import.meta.url))
const baseline = JSON.parse(
  readFileSync(join(here, '../baseline/attendance-team.browser.json'), 'utf8'),
) as { requests: BaselineRequest[] }

const LIST = baseline.requests[0]!
const LIST_FILTERED = baseline.requests[1]!
const CREATE = baseline.requests[2]!
const GET_DETAIL = baseline.requests[3]!
const UPDATE = baseline.requests[4]!
const REMOVE = baseline.requests[5]!
const SCHEDULE_GET = baseline.requests[6]!
const SCHEDULE_SAVE = baseline.requests[7]!

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

/** 解析成 JSON 后按键**有序**比对 —— 只比 `toEqual` 会漏掉键顺序的差异 */
function bodyEntries (raw: string | null | undefined): Array<[string, unknown]> {
  return Object.entries(JSON.parse(String(raw)) as Record<string, unknown>)
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
  const capability = createAttendanceTeamCapability((config) =>
    sdk.call(ATTENDANCE_TEAM_PAGE_PATH, config),
  )
  return { sdk, calls, capability }
}

/**
 * 与写基准同一份填写值。**写死**而不是从基准里读：基准是「浏览器发出去的」，
 * 拿它反推载荷就等于用答案验答案。
 */
const DRAFT: AttendanceTeamDraft = {
  name: 'SDK-TEST-组-030131',
  type: STANDARD_WORKING_HOURS,
  shiftId: '6',
}

const SCHEDULE_DRAFT: AttendanceTeamScheduleDraft = {
  groupId: '7',
  startDate: '2026-09-01',
}

describe('考勤组列表 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选条件时的 URL：path 与 query 与基准完全相同（含键顺序）', async () => {
    const { capability, calls } = makeSdk()

    await capability.list()

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(LIST.url))
    expect(queryPairs(actual)).toEqual(queryPairs(LIST.url))
  })

  it('按名称 + 类型筛选时的 URL 与基准一致（name、type 落在 orderField 之后、pageNo 之前）', async () => {
    const { capability, calls } = makeSdk()

    await capability.list({ name: '考勤', type: STANDARD_WORKING_HOURS })

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(LIST_FILTERED.url))
    expect(queryPairs(actual)).toEqual(queryPairs(LIST_FILTERED.url))
  })

  it('表单初值为 null 的 name / type 不发（qs 的 skipNulls）——浏览器在没填时也不发', async () => {
    const { capability, calls } = makeSdk()

    await capability.list()

    const actual = String(calls[0]?.url)
    expect(actual).not.toContain('name=')
    expect(actual).not.toContain('type=')
  })

  it('参数顺序由契约决定，不随调用方实参的书写顺序改变', async () => {
    const { capability, calls } = makeSdk()

    // 故意倒着写实参
    await capability.list({ type: 1, name: '考勤', pageNo: 1, pageSize: DEFAULT_PAGE_SIZE })

    expect(queryPairs(String(calls[0]?.url)).map(([key]) => key)).toEqual([
      'order',
      'orderField',
      'name',
      'type',
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
    const resolved = sdk.resolveModuleType(ATTENDANCE_TEAM_PAGE_PATH)
    expect(resolved.moduleType).toBe(ATTENDANCE_TEAM_MODULE_TYPE)
    expect(resolved.moduleType).toBe(11)
    expect(resolved.label).toBe('组织管理')
  })

  it('该页只声明了默认实例，http 实例推导到 platform（浏览器列表请求走的就是它）', () => {
    // list.vue 没把 http 传给 useListPageModule，走 main.js 注入的全局默认 = platform.js
    const resolved = resolveHttpInstance({ pagePath: ATTENDANCE_TEAM_PAGE_PATH })
    expect(resolved.kind).toBe('resolved')
    if (resolved.kind !== 'resolved') return
    expect(resolved.instance.id).toBe('platform')
    expect(resolved.matchedBy).toBe('global-default')
  })

  it('GET 请求没有 body', async () => {
    const { capability, calls } = makeSdk()
    await capability.list()
    expect(calls[0]?.data).toBeUndefined()
  })
})

describe('考勤组详情', () => {
  it('URL 与基准一致（编辑页 customLoad 真的会打这个接口）', async () => {
    const { capability, calls } = makeSdk()

    await capability.get(7)

    // 基准那一条本轮只打印到 path（抓取时用的是 `r.url.split('?')[0]`），query 没记录下来，
    // 所以这里只比 path —— 空着一个字段也不能拿"按构造应该是"去填（baseline 里的「头部缺失」同理）。
    expect(normalizeUrl(String(calls[0]?.url)).split('?')[0]).toBe(
      normalizeUrl(GET_DETAIL.url).split('?')[0],
    )
    expect(String(calls[0]?.method).toUpperCase()).toBe('GET')
  })

  it('数字 id 被归一成字符串（后端把 Long 序列化成字符串）', async () => {
    const { capability, calls } = makeSdk()
    await capability.get(7)
    expect(String(calls[0]?.url)).toContain('/hrAttendanceGroup/7')
    expect(String(calls[0]?.url)).not.toContain('/hrAttendanceGroup/7.0')
  })

  it('空 id 被拒，且一个请求都不发', async () => {
    const { capability, calls } = makeSdk()
    await expect(capability.get('  ')).rejects.toThrow(/不能为空/)
    expect(calls).toHaveLength(0)
  })
})

describe('新建 / 修改的载荷构造', () => {
  it('键顺序与基准新建 body 逐字节一致', () => {
    expect(JSON.stringify(buildGroupPayload(DRAFT))).toBe(CREATE.body)
  })

  it('type 不传时补 1（那是表单初值 form.type = 1，不是 SDK 发明的默认值）', () => {
    const payload = buildGroupPayload({ name: 'SDK-TEST-无类型', shiftId: '6' })
    expect(payload.type).toBe(STANDARD_WORKING_HOURS)
    expect(Object.keys(payload)).toEqual(['name', 'type', 'shiftId'])
  })

  it('shiftId 被归一成字符串：浏览器发的也是 "6" 而不是 6', () => {
    expect(buildGroupPayload({ ...DRAFT, shiftId: 6 }).shiftId).toBe('6')
  })

  it('名称必填、且不超过页面规则的 20 字', () => {
    expect(() => buildGroupPayload({ ...DRAFT, name: '   ' })).toThrow(/必填/)
    expect(() => buildGroupPayload({ ...DRAFT, name: 'x'.repeat(GROUP_NAME_MAX_LENGTH) })).not.toThrow()
    expect(() => buildGroupPayload({ ...DRAFT, name: 'x'.repeat(GROUP_NAME_MAX_LENGTH + 1) })).toThrow(/20 字/)
  })

  it('shiftId 缺失被拒：页面在 customSubmit 里手写了一条「请选择班次」，它不是表单规则', () => {
    expect(() => buildGroupPayload({ name: 'SDK-TEST-无班次' } as AttendanceTeamDraft)).toThrow(/班次必填/)
    expect(() => buildGroupPayload({ ...DRAFT, shiftId: '' })).toThrow(/班次必填/)
    expect(() => buildGroupPayload({ ...DRAFT, shiftId: '   ' })).toThrow(/班次必填/)
  })
})

describe('新建考勤组（写能力）', () => {
  it('POST 到 /org/hrAttendanceGroup，body 与基准逐字节相同', async () => {
    const { capability, calls } = makeSdk()

    await capability.create(DRAFT)

    expect(String(calls[0]?.method).toUpperCase()).toBe('POST')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(CREATE.url))
    expect(rawBodyOf(calls[0])).toBe(CREATE.body)
  })

  it('非法载荷一个请求都不发（校验发生在本地）', async () => {
    const { capability, calls } = makeSdk()

    await expect(capability.create({ ...DRAFT, name: '' })).rejects.toThrow(/必填/)
    expect(calls).toHaveLength(0)
  })
})

describe('修改考勤组（写能力，整单替换）', () => {
  it('PUT 到与新建**同一个** URL（浏览器那两行三元表达式的两侧写的是同一个字符串）', async () => {
    const { capability, calls } = makeSdk()

    await capability.update({ ...DRAFT, id: '7' })

    expect(String(calls[0]?.method).toUpperCase()).toBe('PUT')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(UPDATE.url))
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(CREATE.url))
  })

  it('实际发出去的 body 就是「三个业务键 + id」，多出来的一个都不发', async () => {
    const { capability, calls } = makeSdk()

    await capability.update({ ...DRAFT, id: '7' })

    expect(rawBodyOf(calls[0])).toBe('{"name":"SDK-TEST-组-030131","type":1,"shiftId":"6","id":"7"}')
  })

  it('浏览器多带的正好是那九个服务端字段 —— 少发的就是它们，不是「差不多」', async () => {
    const { capability, calls } = makeSdk()
    await capability.update({ ...DRAFT, id: '7' })

    const browserKeys = bodyEntries(UPDATE.body).map(([key]) => key)
    const oursKeys = bodyEntries(rawBodyOf(calls[0])).map(([key]) => key)

    expect(oursKeys.every((key) => browserKeys.includes(key))).toBe(true)
    expect(browserKeys.filter((key) => !oursKeys.includes(key))).toEqual([
      'status',
      'isDel',
      'creator',
      'createTime',
      'updater',
      'updateTime',
      'shiftName',
      'workShift',
      'sheetUserRelDTOS',
    ])
  })

  it('id 是字符串（后端就是这么给的：PUT body 里是 "id":"7"）', async () => {
    const { capability, calls } = makeSdk()
    await capability.update({ ...DRAFT, id: 7 })
    expect(JSON.parse(rawBodyOf(calls[0])).id).toBe('7')
  })
})

describe('删除考勤组（写能力，逻辑删除）', () => {
  it('DELETE /org/hrAttendanceGroup/{id}，与基准一致且没有请求体', async () => {
    const { capability, calls } = makeSdk()

    await capability.remove(7)

    expect(String(calls[0]?.method).toUpperCase()).toBe('DELETE')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(REMOVE.url))
    expect(calls[0]?.data).toBeUndefined()
  })

  it('空 id 被拒，且一个请求都不发', async () => {
    const { capability, calls } = makeSdk()
    await expect(capability.remove('')).rejects.toThrow(/不能为空/)
    expect(calls).toHaveLength(0)
  })
})

describe('读考勤组的排班', () => {
  it('URL 与基准一致（只有 groupId 一个参数）', async () => {
    const { capability, calls } = makeSdk()

    await capability.scheduleGet(7)

    const actual = String(calls[0]?.url)
    expect(normalizeUrl(actual)).toBe(normalizeUrl(SCHEDULE_GET.url))
    expect(queryPairs(actual).filter(([key]) => key !== '_t')).toEqual([['groupId', '7']])
  })

  it('把后端返回的 null 列表原样透传（没排过班的组就是 null，不是 []）', async () => {
    const { capability } = makeSdk({ groupId: '7', type: 1, startDate: null, hrGroupUserRelEntityList: null })

    const schedule = await capability.scheduleGet(7)

    expect(schedule.hrGroupUserRelEntityList).toBeNull()
    expect(schedule.startDate).toBeNull()
  })
})

describe('存考勤组的排班（写能力，整组覆盖）', () => {
  it('POST 到 /org/hrWorkSchedule，body 的键顺序与基准逐字节相同', async () => {
    const { capability, calls } = makeSdk()

    await capability.scheduleSave(SCHEDULE_DRAFT)

    expect(String(calls[0]?.method).toUpperCase()).toBe('POST')
    expect(normalizeUrl(String(calls[0]?.url))).toBe(normalizeUrl(SCHEDULE_SAVE.url))
    expect(rawBodyOf(calls[0])).toBe(SCHEDULE_SAVE.body)
  })

  it('键顺序照抄浏览器：duty 排在 organization 前面（schedual.vue 里 reactive 的书写顺序）', () => {
    expect(Object.keys(buildSchedulePayload(SCHEDULE_DRAFT))).toEqual([
      'groupId',
      'startDate',
      'dutyIdList',
      'organizationIdList',
      'postIdList',
      'userIdList',
    ])
  })

  it('四个列表永远发出去 —— 空的就是 []，不做 skipNulls（后端靠「四个都空」判清空分支）', async () => {
    const { capability, calls } = makeSdk()

    await capability.scheduleSave(SCHEDULE_DRAFT)

    const body = JSON.parse(rawBodyOf(calls[0])) as Record<string, unknown>
    for (const key of ['dutyIdList', 'organizationIdList', 'postIdList', 'userIdList']) {
      expect(body[key], `${key} 必须是 []`).toEqual([])
    }
  })

  it('四个列表全空 = 清空该组排班，这是删组之前的必要一步', async () => {
    const { capability, calls } = makeSdk()

    await capability.scheduleSave({ groupId: '7', startDate: '2026-09-01' })

    expect(rawBodyOf(calls[0])).toBe(SCHEDULE_SAVE.body)
  })

  it('列表里的 id 被归一成字符串；userIdList 装的是工号', async () => {
    const { capability, calls } = makeSdk()

    await capability.scheduleSave({
      groupId: 7,
      startDate: '2026-09-01',
      organizationIdList: [70669],
      postIdList: [],
      dutyIdList: [12],
      userIdList: [2026050801],
    })

    const body = JSON.parse(rawBodyOf(calls[0])) as Record<string, unknown>
    expect(body.groupId).toBe('7')
    expect(body.organizationIdList).toEqual(['70669'])
    expect(body.dutyIdList).toEqual(['12'])
    expect(body.userIdList).toEqual(['2026050801'])
  })

  it('startDate 必填（页面 rules.startDate 是 required），缺失时一个请求都不发', async () => {
    const { capability, calls } = makeSdk()

    await expect(
      capability.scheduleSave({ groupId: '7' } as AttendanceTeamScheduleDraft),
    ).rejects.toThrow(/排班日期必填/)
    expect(calls).toHaveLength(0)
  })

  it('startDate 格式必须是 YYYY-MM-DD（页面 value-format），错格式挡在本地', async () => {
    const { capability, calls } = makeSdk()

    await expect(
      capability.scheduleSave({ groupId: '7', startDate: '2026/09/01' }),
    ).rejects.toThrow(/YYYY-MM-DD/)
    await expect(
      capability.scheduleSave({ groupId: '7', startDate: '2026-9-1' }),
    ).rejects.toThrow(/YYYY-MM-DD/)
    expect(calls).toHaveLength(0)
  })

  it('assertIsoDate 只认形状，不判「这天存不存在」（后端会给出明确错误）', () => {
    expect(() => assertIsoDate('排班日期', '2026-02-31')).not.toThrow()
    expect(() => assertIsoDate('排班日期', '2026-13-01')).toThrow(/YYYY-MM-DD/)
    expect(() => assertIsoDate('排班日期', '')).toThrow(/YYYY-MM-DD/)
    expect(() => assertIsoDate('排班日期', 20260901)).toThrow(/YYYY-MM-DD/)
  })
})

describe('能力定义', () => {
  /**
   * 这两条看着像废话，但少了它们，改坏 `ATTENDANCE_TEAM_PAGE_PATH` 是**测不出来**的：
   * 下面那条「都绑在这一页上」比的是 `item.pagePath === ATTENDANCE_TEAM_PAGE_PATH`，
   * 两边同源；module-type 的推导是按菜单前缀匹配的，路径改成 `/attendance-team/other`
   * 照样算出 11。**存活变异 M14 就是这么发现的**（改了常量、39 条全绿）。
   * 所以这里把字面量钉死一次。
   */
  it('页面路径与权限码是字面量，不是"自洽就行"', () => {
    expect(ATTENDANCE_TEAM_PAGE_PATH).toBe('/dashboard/attendance/attendance-team/list')
    expect(ATTENDANCE_TEAM_PERMISSION).toBe('/dashboard/attendance/attendance-team')
    // 与 generated/page-catalog.json 的 290bc1 行、app/portal/menus/hr.js:89 同源
  })

  it('七个能力都绑在这一页上，权限码一致，写标志标对', () => {
    expect(attendanceTeamCapabilities.map((item) => item.id)).toEqual([
      'attendance-team-list',
      'attendance-team-get',
      'attendance-team-create',
      'attendance-team-update',
      'attendance-team-remove',
      'attendance-team-schedule-get',
      'attendance-team-schedule-save',
    ])
    expect(attendanceTeamCapabilities.map((item) => item.write)).toEqual([
      false,
      false,
      true,
      true,
      true,
      false,
      true,
    ])
    for (const item of attendanceTeamCapabilities) {
      expect(item.pagePath).toBe(ATTENDANCE_TEAM_PAGE_PATH)
      expect(item.permission).toBe(ATTENDANCE_TEAM_PERMISSION)
    }
  })

  it('列表的参数契约带 type（它是真参数：页面上有控件绑着它），且不含 status', () => {
    const definition = attendanceTeamCapabilities.find((item) => item.id === 'attendance-team-list')
    expect(definition?.params.map((param) => param.name)).toEqual(['name', 'type', 'pageNo', 'pageSize'])
    expect(definition?.params.find((param) => param.name === 'type')?.options).toEqual([
      { label: '标准工时', value: STANDARD_WORKING_HOURS },
    ])
  })

  it('schedule-save 的四个列表参数齐全，groupId 与 startDate 必填', () => {
    const definition = attendanceTeamCapabilities.find(
      (item) => item.id === 'attendance-team-schedule-save',
    )
    expect(definition?.params.map((param) => param.name)).toEqual([
      'groupId',
      'startDate',
      'organizationIdList',
      'postIdList',
      'dutyIdList',
      'userIdList',
    ])
    expect(definition?.params.filter((param) => param.required).map((param) => param.name)).toEqual([
      'groupId',
      'startDate',
    ])
  })

  /**
   * 这条锁的是**边界**，不是功能：`/org/organization/getUserByType` 是页面上真实存在的一个请求
   * （「添加/查看人员」弹窗拉人用的），但它的响应里对每个用户带 `password` / `password2` / `salt`
   * 三个字段（实测，见 `docs/pages/排班管理.md`）。把它做成能力 = 把密码散列塞进 AI 的上下文。
   * 它也不参与任何写载荷。所以这一页**一个 /org/organization/ 的能力都没有**。
   */
  it('不暴露 getUserByType：这一页没有任何指向 /org/organization 的能力', () => {
    for (const item of attendanceTeamCapabilities) {
      expect(item.id).not.toContain('user-by-type')
      expect(item.title).not.toContain('人员候选')
      for (const param of item.params) {
        expect(param.lookup?.capabilityId ?? '').not.toContain('getUserByType')
      }
    }
  })

  it('每个能力的 impl 都存在（定义与实现不许对不上）', () => {
    const { capability } = makeSdk()
    const implKeys = new Set(Object.keys(capability))
    for (const item of attendanceTeamCapabilities) {
      const camel = item.id.replace(/^attendance-team-/, '').replace(/-(\w)/g, (_m, c: string) => c.toUpperCase())
      expect(implKeys.has(camel), `缺少实现 ${camel}（能力 ${item.id}）`).toBe(true)
    }
  })
})
